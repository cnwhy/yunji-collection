import { extractPureDomain } from '../../utils/domain';
import { getDomains, setDomains } from '../../utils/storage';
import { updateNetRules } from '../../utils/dnr';
import {
  addTabToYunji,
  BROWSER_CATEGORY_NAME,
  detectYunjiOrigin,
  fetchYunjiIdentity,
  getBrowserYunjiSession,
  getYunjiCategories,
  getYunjiEnvironments,
  listYunjiInstances,
  loginToYunji,
  patchYunjiSpace,
  removeYunjiInstance,
  removeYunjiSpace,
  resolveTabName,
  selectYunjiSpace,
  setYunjiBaseUrl,
  syncBrowserYunjiSession,
  upsertYunjiSpace,
  YunjiAuthError,
  type YunjiInstance,
  type YunjiSpace,
} from '../../utils/yunji';

let yunjiTab: chrome.tabs.Tab | null = null;
let spaceFormMode: 'add' | 'relogin' = 'add';
/** 模态表单（空间登录 / 自定义收藏）作用的目标实例 */
let currentBaseUrl: string | null = null;

// 本次弹窗生命周期内已验证过的会话（按 token 记忆，避免每次刷新都请求）
const verifiedTokens = new Set<string>();
const verifyingTokens = new Set<string>();

document.addEventListener('DOMContentLoaded', initPopup);

function $<T extends HTMLElement>(id: string): T {
  return document.getElementById(id) as T;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function stripProtocol(url: string): string {
  return url.replace(/^https?:\/\//, '');
}

function isHttpUrl(url: string | undefined): boolean {
  return !!url && /^https?:\/\//i.test(url);
}

/** 任意协议的可收藏网址（chrome://、file://、about: 等内部页面也可） */
function isCollectableUrl(url: string | undefined): boolean {
  if (!url) return false;
  try {
    new URL(url);
    return true;
  } catch {
    return false;
  }
}

function spaceLabel(space: YunjiSpace): string {
  return space.siteName ? `${space.siteName}（${space.username}）` : space.username;
}

function canCollectCurrentPage(baseUrl: string): boolean {
  if (!isCollectableUrl(yunjiTab?.url)) return false;
  try {
    return new URL(yunjiTab!.url!).origin !== baseUrl;
  } catch {
    return false;
  }
}

function setYunjiMessage(
  text: string,
  type: 'info' | 'success' | 'error' = 'info',
  useHtml = false
) {
  const el = $('yunjiMessage');
  if (useHtml) el.innerHTML = text;
  else el.textContent = text;
  el.className = `yunji-message ${type}`;
}

async function findInstance(baseUrl: string): Promise<YunjiInstance | null> {
  const instances = await listYunjiInstances();
  return instances.find((item) => item.baseUrl === baseUrl) ?? null;
}

function selectedSpaceOf(instance: YunjiInstance): YunjiSpace | null {
  return (
    instance.spaces.find((item) => item.username === instance.selectedUsername) ?? null
  );
}

async function initPopup() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab) yunjiTab = tab;
  else {
    setYunjiMessage('无法获取当前标签页', 'error');
  }

  // 添加实例表单
  $('yunjiAddInstanceBtn').addEventListener('click', (event) => {
    event.preventDefault();
    void openConfigForm();
  });
  $('yunjiSaveBaseUrlBtn').addEventListener('click', () => void saveBaseUrl());
  $('yunjiBindBtn').addEventListener('click', () => void bindYunji());
  $('yunjiCancelBaseUrlBtn').addEventListener('click', cancelConfigForm);
  $<HTMLInputElement>('yunjiBaseUrlInput').addEventListener('keydown', (event) => {
    if (event.key === 'Enter') void saveBaseUrl();
  });

  // 空间登录表单
  $('yunjiSpaceCancelBtn').addEventListener('click', closeSpaceForm);
  $('yunjiSpaceSubmitBtn').addEventListener('click', () => void submitSpaceForm());
  $<HTMLInputElement>('yunjiPassword').addEventListener('keydown', (event) => {
    if (event.key === 'Enter') void submitSpaceForm();
  });

  // 自定义收藏表单
  $('yunjiCancelBtn').addEventListener('click', closeCollectForm);
  $('yunjiSubmitBtn').addEventListener('click', () => void submitCollectForm());

  // 卡片内动作：事件委托，按 data-action 分发
  const list = $('yunjiInstanceList');
  list.addEventListener('click', (event) => {
    const link = (event.target as HTMLElement | null)?.closest?.(
      '[data-action]'
    ) as HTMLElement | null;
    if (!link) return;
    event.preventDefault();
    const card = link.closest('.instance-card') as HTMLElement | null;
    const baseUrl = card?.dataset.baseUrl ?? '';
    switch (link.dataset.action) {
      case 'remove-instance':
        void removeInstance(baseUrl);
        break;
      case 'toggle-cross':
        void toggleCross(baseUrl);
        break;
      case 'add-space':
        void openSpaceForm('add', baseUrl);
        break;
      case 'sync-login':
        void syncBrowserLogin(baseUrl);
        break;
      case 'remove-space':
        void removeSelectedSpace(baseUrl);
        break;
      case 'quick-add':
        void quickAdd(baseUrl);
        break;
      case 'open-collect':
        void openCollectForm(baseUrl);
        break;
      case 'relogin':
        void openSpaceForm('relogin', baseUrl);
        break;
    }
  });
  list.addEventListener('change', (event) => {
    const target = event.target as HTMLSelectElement | null;
    if (!target?.classList.contains('space-select')) return;
    const card = target.closest('.instance-card') as HTMLElement | null;
    const baseUrl = card?.dataset.baseUrl ?? '';
    const username = target.value;
    if (!baseUrl || !username) return;
    void selectSpace(baseUrl, username);
  });

  await initYunjiView();
}

/** 打开弹窗时：卡片先渲染避免首屏空白，同时后台探测当前页是否为未添加的云笈实例，命中再切到添加表单 */
async function initYunjiView() {
  const detectedPromise = isHttpUrl(yunjiTab?.url)
    ? (async () => {
        let origin = '';
        try {
          origin = new URL(yunjiTab!.url!).origin;
        } catch {
          return null;
        }
        const instances = await listYunjiInstances();
        if (instances.some((item) => item.baseUrl === origin)) return null;
        const detected = await detectYunjiOrigin(yunjiTab!.url!);
        if (detected && !instances.some((item) => item.baseUrl === detected)) return detected;
        return null;
      })()
    : Promise.resolve(null);

  await renderInstanceCards();

  const detected = await detectedPromise;
  if (detected) await openConfigForm(detected);
}

// ===== 实例卡片渲染 =====

function buildInstanceCard(instance: YunjiInstance, domains: string[]): HTMLElement {
  const card = document.createElement('div');
  card.className = 'instance-card';
  card.dataset.baseUrl = instance.baseUrl;

  const selected = selectedSpaceOf(instance);

  // 头部：实例名 + 状态 + 删除
  const head = document.createElement('div');
  head.className = 'instance-card-head';

  const title = document.createElement('div');
  title.className = 'instance-card-title';
  const nameEl = document.createElement('span');
  nameEl.className = 'instance-name';
  nameEl.textContent = instance.siteName;
  const originEl = document.createElement('a');
  originEl.className = 'instance-origin';
  originEl.href = instance.baseUrl;
  originEl.target = '_blank';
  originEl.rel = 'noopener';
  originEl.textContent = stripProtocol(instance.baseUrl);
  title.append(nameEl, originEl);

  const statusEl = document.createElement('span');
  statusEl.className = 'instance-status';
  if (instance.spaces.length === 0) {
    statusEl.classList.add('warn');
    statusEl.textContent = '还没有空间';
  } else if (selected?.expired) {
    statusEl.classList.add('warn');
    statusEl.innerHTML =
      '登录已过期，<a href="#" class="yunji-inline-link" data-action="relogin">重新登录</a>';
  } else if (selected && verifiedTokens.has(selected.sessionId)) {
    statusEl.classList.add('ok');
    statusEl.textContent = '已连接';
  } else {
    statusEl.textContent = '检查中...';
  }

  const removeEl = document.createElement('a');
  removeEl.href = '#';
  removeEl.className = 'instance-remove';
  removeEl.title = '删除此云笈实例及其空间凭证';
  removeEl.dataset.action = 'remove-instance';
  removeEl.textContent = '✕';

  head.append(title, statusEl, removeEl);

  // 操作链接：跨域开关 / 添加空间 / 同步浏览器登录
  const links = document.createElement('div');
  links.className = 'instance-links';

  const crossEl = document.createElement('a');
  crossEl.href = '#';
  crossEl.dataset.action = 'toggle-cross';
  crossEl.title = '开启后，才能正常在浏览器端获取站点图标（放开云笈站点跨域限制）';
  const crossOn = domains.includes(extractPureDomain(instance.baseUrl));
  crossEl.classList.toggle('on', crossOn);
  crossEl.textContent = crossOn ? '✓ 已放开跨域' : '放开跨域';

  const addSpaceEl = document.createElement('a');
  addSpaceEl.href = '#';
  addSpaceEl.dataset.action = 'add-space';
  addSpaceEl.title = '添加空间：输入空间ID和密码登录';
  addSpaceEl.textContent = '＋ 添加空间';

  const syncEl = document.createElement('a');
  syncEl.href = '#';
  syncEl.dataset.action = 'sync-login';
  syncEl.title = '把浏览器当前登录的云笈会话同步为空间凭证';
  syncEl.textContent = '⇄ 同步浏览器登录';

  links.append(crossEl, addSpaceEl, syncEl);

  // 空间选择行
  const spaceRow = document.createElement('div');
  spaceRow.className = 'instance-space-row';
  const select = document.createElement('select');
  select.className = 'space-select';
  select.setAttribute('aria-label', '保存到空间');
  if (instance.spaces.length === 0) {
    select.disabled = true;
    const option = document.createElement('option');
    option.value = '';
    option.textContent = '还没有保存的空间';
    select.appendChild(option);
  } else {
    for (const space of instance.spaces) {
      const option = document.createElement('option');
      option.value = space.username;
      option.textContent = `${spaceLabel(space)}${space.expired ? '（已过期）' : ''}`;
      select.appendChild(option);
    }
    select.value = selected?.username ?? '';
  }
  const removeSpaceBtn = document.createElement('button');
  removeSpaceBtn.className = 'icon-btn';
  removeSpaceBtn.title = '删除当前空间凭证';
  removeSpaceBtn.dataset.action = 'remove-space';
  removeSpaceBtn.textContent = '×';
  removeSpaceBtn.style.display = instance.spaces.length > 0 ? 'block' : 'none';
  spaceRow.append(select, removeSpaceBtn);

  // 收藏行
  const collectRow = document.createElement('div');
  collectRow.className = 'instance-collect-row';
  const quickAddBtn = document.createElement('button');
  quickAddBtn.className = 'btn-yunji quick-add';
  quickAddBtn.dataset.action = 'quick-add';
  quickAddBtn.textContent = '一键添加';
  const openCollectBtn = document.createElement('button');
  openCollectBtn.className = 'btn-yunji';
  openCollectBtn.dataset.action = 'open-collect';
  openCollectBtn.textContent = '收藏到云笈';
  collectRow.append(quickAddBtn, openCollectBtn);
  collectRow.style.display =
    canCollectCurrentPage(instance.baseUrl) && instance.spaces.length > 0
      ? 'flex'
      : 'none';

  card.append(head, links, spaceRow, collectRow);
  return card;
}

async function renderInstanceCards() {
  const [instances, domains] = await Promise.all([listYunjiInstances(), getDomains()]);
  const list = $('yunjiInstanceList');
  list.innerHTML = '';
  list.style.display = '';
  for (const instance of instances) {
    list.appendChild(buildInstanceCard(instance, domains));
  }

  for (const instance of instances) {
    const selected = selectedSpaceOf(instance);
    if (
      selected &&
      !selected.expired &&
      !verifiedTokens.has(selected.sessionId) &&
      !verifyingTokens.has(selected.sessionId)
    ) {
      void verifyInstance(instance.baseUrl, selected);
    }
  }
}

/** 校验某个实例的选中空间；token 失效则标记过期并重渲染 */
async function verifyInstance(baseUrl: string, space: YunjiSpace) {
  if (space.expired) return;
  if (verifiedTokens.has(space.sessionId) || verifyingTokens.has(space.sessionId)) return;

  verifyingTokens.add(space.sessionId);
  try {
    const identity = await fetchYunjiIdentity(baseUrl, space.sessionId);
    verifiedTokens.add(space.sessionId);
    await patchYunjiSpace(baseUrl, space.username, {
      expired: false,
      siteName: identity.siteName || space.siteName,
    });
    // 表单打开时跳过重渲染，避免遮住表单；关闭表单时自然会重渲染
    if ($('yunjiInstanceList').style.display !== 'none') await renderInstanceCards();
  } catch (error) {
    if (error instanceof YunjiAuthError) {
      verifiedTokens.delete(space.sessionId);
      await patchYunjiSpace(baseUrl, space.username, { expired: true });
      setYunjiMessage('登录已过期，请重新登录或同步浏览器登录', 'error');
      if ($('yunjiInstanceList').style.display !== 'none') await renderInstanceCards();
    } else {
      const statusEl = document.querySelector(
        `.instance-card[data-base-url="${CSS.escape(baseUrl)}"] .instance-status`
      );
      if (statusEl) {
        statusEl.classList.add('warn');
        statusEl.textContent = errorMessage(error);
      }
    }
  } finally {
    verifyingTokens.delete(space.sessionId);
  }
}

// ===== 实例管理 =====

/** 打开添加实例表单；presetOrigin 为已识别到的云笈地址（跳过再次探测） */
async function openConfigForm(presetOrigin?: string) {
  $('yunjiInstanceList').style.display = 'none';
  $<HTMLDivElement>('yunjiConfigForm').style.display = 'flex';
  $('yunjiMessage').textContent = '';
  $('yunjiCancelBaseUrlBtn').style.display = 'block';
  $('yunjiSaveBaseUrlBtn').style.display = 'block';
  $('yunjiBindBtn').style.display = 'none';

  const input = $<HTMLInputElement>('yunjiBaseUrlInput');
  input.value = '';
  if (isHttpUrl(yunjiTab?.url)) {
    let detected = presetOrigin ?? null;
    if (!detected) {
      $('yunjiMessage').textContent = '正在识别云笈站点...';
      detected = await detectYunjiOrigin(yunjiTab!.url!);
    }
    input.value = detected ?? '';
    if (detected && (await getBrowserYunjiSession(detected))) {
      $('yunjiSaveBaseUrlBtn').style.display = 'none';
      $('yunjiBindBtn').style.display = 'block';
      $('yunjiMessage').textContent = '';
    }
  }
  input.focus();
}

function cancelConfigForm() {
  $<HTMLDivElement>('yunjiConfigForm').style.display = 'none';
  void renderInstanceCards();
}

/** 保存地址：只存实例不登录；已存在的地址切换到对应实例 */
async function saveBaseUrl() {
  const input = $<HTMLInputElement>('yunjiBaseUrlInput');
  try {
    await setYunjiBaseUrl(input.value);
    input.value = '';
    $<HTMLDivElement>('yunjiConfigForm').style.display = 'none';
    setYunjiMessage('云笈实例已保存', 'success');
    await renderInstanceCards();
  } catch (error) {
    setYunjiMessage(errorMessage(error), 'error');
  }
}

/** 一键绑定：保存地址并把浏览器当前登录会话同步为空间凭证 */
async function bindYunji() {
  const input = $<HTMLInputElement>('yunjiBaseUrlInput');
  try {
    const baseUrl = await setYunjiBaseUrl(input.value);
    const identity = await syncBrowserYunjiSession(baseUrl);
    verifiedTokens.add(identity.sessionId);
    await upsertYunjiSpace(baseUrl, identity, { select: true });
    input.value = '';
    $<HTMLDivElement>('yunjiConfigForm').style.display = 'none';
    setYunjiMessage(
      `已绑定云笈：${identity.siteName ? `${identity.siteName}（${identity.username}）` : baseUrl}`,
      'success'
    );
    await renderInstanceCards();
  } catch (error) {
    setYunjiMessage(errorMessage(error), 'error');
  }
}

async function removeInstance(baseUrl: string) {
  if (!confirm(`删除云笈实例 ${stripProtocol(baseUrl)}？其空间凭证与跨域放行将一并移除。`)) {
    return;
  }
  try {
    const pureDomain = extractPureDomain(baseUrl);
    const domains = await getDomains();
    const remaining = domains.filter((domain) => domain !== pureDomain);
    await setDomains(remaining);
    await updateNetRules(remaining);
    await removeYunjiInstance(baseUrl);
    verifiedTokens.clear();
    setYunjiMessage('已删除云笈实例', 'success');
    await renderInstanceCards();
  } catch (error) {
    setYunjiMessage(errorMessage(error), 'error');
  }
}

async function toggleCross(baseUrl: string) {
  const pureDomain = extractPureDomain(baseUrl);
  const domains = await getDomains();
  const index = domains.indexOf(pureDomain);

  if (index > -1) domains.splice(index, 1);
  else domains.push(pureDomain);

  await setDomains(domains);
  await updateNetRules(domains);
  chrome.runtime.sendMessage({ action: 'refreshBadge' });
  await renderInstanceCards();
}

// ===== 空间管理 =====

async function selectSpace(baseUrl: string, username: string) {
  await selectYunjiSpace(baseUrl, username);
  await renderInstanceCards();
}

/** 打开空间登录表单：add=添加空间，relogin=给当前空间重新登录 */
async function openSpaceForm(mode: 'add' | 'relogin', baseUrl: string) {
  const instance = await findInstance(baseUrl);
  if (!instance) return;
  const selected = selectedSpaceOf(instance);
  if (mode === 'relogin' && !selected) return;

  currentBaseUrl = baseUrl;
  spaceFormMode = mode;
  $('yunjiSpaceFormTitle').textContent =
    mode === 'relogin' && selected
      ? `重新登录：${spaceLabel(selected)}`
      : `添加空间：${stripProtocol(baseUrl)}`;

  const usernameInput = $<HTMLInputElement>('yunjiUsername');
  usernameInput.disabled = mode === 'relogin';
  usernameInput.value = mode === 'relogin' && selected ? selected.username : '';
  ($<HTMLInputElement>('yunjiPassword')).value = '';

  $('yunjiInstanceList').style.display = 'none';
  $<HTMLDivElement>('yunjiSpaceForm').style.display = 'flex';
  setYunjiMessage('');
  (mode === 'relogin' ? $<HTMLInputElement>('yunjiPassword') : usernameInput).focus();
}

function closeSpaceForm() {
  $<HTMLDivElement>('yunjiSpaceForm').style.display = 'none';
  $<HTMLInputElement>('yunjiPassword').value = '';
  void renderInstanceCards();
}

async function submitSpaceForm() {
  if (!currentBaseUrl) return;

  const usernameInput = $<HTMLInputElement>('yunjiUsername');
  const passwordInput = $<HTMLInputElement>('yunjiPassword');
  const username = usernameInput.value.trim();
  const password = passwordInput.value;

  if (!username) {
    setYunjiMessage('请输入空间ID', 'error');
    return;
  }
  if (!password) {
    setYunjiMessage('请输入密码', 'error');
    return;
  }

  const submitBtn = $<HTMLButtonElement>('yunjiSpaceSubmitBtn');
  const cancelBtn = $<HTMLButtonElement>('yunjiSpaceCancelBtn');
  submitBtn.disabled = true;
  cancelBtn.disabled = true;
  setYunjiMessage('正在登录...');

  try {
    const identity = await loginToYunji(currentBaseUrl, username, password);
    verifiedTokens.add(identity.sessionId);
    await upsertYunjiSpace(currentBaseUrl, identity, { select: true });
    passwordInput.value = '';
    $<HTMLDivElement>('yunjiSpaceForm').style.display = 'none';
    setYunjiMessage(
      `已保存空间：${identity.siteName ? `${identity.siteName}（${identity.username}）` : identity.username}`,
      'success'
    );
    await renderInstanceCards();
  } catch (error) {
    setYunjiMessage(errorMessage(error), 'error');
  } finally {
    submitBtn.disabled = false;
    cancelBtn.disabled = false;
  }
}

async function syncBrowserLogin(baseUrl: string) {
  setYunjiMessage('正在同步浏览器登录...');
  try {
    const identity = await syncBrowserYunjiSession(baseUrl);
    verifiedTokens.add(identity.sessionId);
    await upsertYunjiSpace(baseUrl, identity, { select: true });
    $<HTMLDivElement>('yunjiSpaceForm').style.display = 'none';
    setYunjiMessage(
      `已同步空间：${identity.siteName ? `${identity.siteName}（${identity.username}）` : identity.username}`,
      'success'
    );
    await renderInstanceCards();
  } catch (error) {
    setYunjiMessage(errorMessage(error), 'error');
  }
}

async function removeSelectedSpace(baseUrl: string) {
  const instance = await findInstance(baseUrl);
  if (!instance) return;
  const space = selectedSpaceOf(instance);
  if (!space) return;

  if (!confirm(`删除空间「${spaceLabel(space)}」的登录凭证？`)) return;

  verifiedTokens.delete(space.sessionId);
  await removeYunjiSpace(baseUrl, space.username);
  setYunjiMessage('已删除空间凭证', 'success');
  await renderInstanceCards();
}

// ===== 收藏 =====

async function loadCollectFormOptions(baseUrl: string, sessionId: string) {
  const categories = await getYunjiCategories(baseUrl, sessionId);
  const environments = await getYunjiEnvironments(baseUrl, sessionId);

  const categorySelect = $<HTMLSelectElement>('yunjiCategory');
  categorySelect.innerHTML = '';
  if (categories.length === 0) {
    const option = document.createElement('option');
    option.value = '';
    option.textContent = '（暂无分类，将自动创建「浏览器收藏」）';
    categorySelect.appendChild(option);
  }
  const browserCategory = categories.find((cat) => cat.name === BROWSER_CATEGORY_NAME);
  for (const cat of categories) {
    const option = document.createElement('option');
    option.value = cat.id;
    option.textContent = cat.name;
    if (cat.id === browserCategory?.id) option.selected = true;
    categorySelect.appendChild(option);
  }

  const envSelect = $<HTMLSelectElement>('yunjiEnvironment');
  envSelect.innerHTML = '';
  if (environments.length === 0) {
    const option = document.createElement('option');
    option.value = '';
    option.textContent = '自动创建默认环境';
    envSelect.appendChild(option);
  } else {
    const first = environments[0]!;
    for (const env of environments) {
      const option = document.createElement('option');
      option.value = env.id;
      option.textContent = env.name;
      if (env.id === first.id) option.selected = true;
      envSelect.appendChild(option);
    }
  }
}

async function openCollectForm(baseUrl: string) {
  const instance = await findInstance(baseUrl);
  if (!instance) return;
  const selected = selectedSpaceOf(instance);

  if (!isCollectableUrl(yunjiTab?.url)) {
    setYunjiMessage('当前页面不支持收藏', 'error');
    return;
  }
  if (!selected) {
    setYunjiMessage('请先添加或同步一个空间', 'error');
    return;
  }
  if (selected.expired) {
    setYunjiMessage('登录已过期，请先重新登录', 'error');
    void openSpaceForm('relogin', baseUrl);
    return;
  }

  let optionsError = '';
  try {
    await loadCollectFormOptions(baseUrl, selected.sessionId);
  } catch (error) {
    if (error instanceof YunjiAuthError) {
      verifiedTokens.delete(selected.sessionId);
      await patchYunjiSpace(baseUrl, selected.username, { expired: true });
      setYunjiMessage('登录已过期，请先重新登录', 'error');
      void openSpaceForm('relogin', baseUrl);
      await renderInstanceCards();
      return;
    }
    optionsError = errorMessage(error);
  }

  currentBaseUrl = baseUrl;
  const nameInput = $<HTMLInputElement>('yunjiName');
  const urlInput = $<HTMLInputElement>('yunjiUrl');
  nameInput.value = resolveTabName(yunjiTab!);
  urlInput.value = yunjiTab!.url!;

  $('yunjiInstanceList').style.display = 'none';
  $<HTMLDivElement>('yunjiSpaceForm').style.display = 'none';
  $<HTMLDivElement>('yunjiForm').style.display = 'flex';
  setYunjiMessage(optionsError, optionsError ? 'error' : 'info');
  nameInput.focus();
  nameInput.select();
}

async function closeCollectForm() {
  $<HTMLDivElement>('yunjiForm').style.display = 'none';
  await renderInstanceCards();
}

/** 一键添加：用默认分类与环境直接收藏当前页，不打开表单 */
async function quickAdd(baseUrl: string) {
  const instance = await findInstance(baseUrl);
  if (!instance) return;
  const selected = selectedSpaceOf(instance);

  if (!isCollectableUrl(yunjiTab?.url)) {
    setYunjiMessage('当前页面不支持收藏', 'error');
    return;
  }
  if (!selected) {
    setYunjiMessage('请先添加或同步一个空间', 'error');
    return;
  }
  if (selected.expired) {
    setYunjiMessage('登录已过期，请先重新登录', 'error');
    void openSpaceForm('relogin', baseUrl);
    return;
  }

  const quickBtn = document.querySelector(
    `.instance-card[data-base-url="${CSS.escape(baseUrl)}"] .quick-add`
  ) as HTMLButtonElement | null;
  if (quickBtn) quickBtn.disabled = true;
  setYunjiMessage('正在添加...');

  try {
    const result = await addTabToYunji(
      baseUrl,
      selected,
      yunjiTab!,
      resolveTabName(yunjiTab!),
      yunjiTab!.url!
    );
    setYunjiMessage(`已收藏到云笈：${result.name}（${spaceLabel(selected)}）`, 'success');
  } catch (error) {
    if (error instanceof YunjiAuthError) {
      verifiedTokens.delete(selected.sessionId);
      await patchYunjiSpace(baseUrl, selected.username, { expired: true });
      setYunjiMessage('登录已过期，请先重新登录', 'error');
      void openSpaceForm('relogin', baseUrl);
      await renderInstanceCards();
    } else {
      setYunjiMessage(errorMessage(error), 'error');
    }
  } finally {
    if (quickBtn) quickBtn.disabled = false;
  }
}

async function submitCollectForm() {
  if (!currentBaseUrl) return;
  const instance = await findInstance(currentBaseUrl);
  if (!instance) return;
  const selected = selectedSpaceOf(instance);
  if (!selected || !isCollectableUrl(yunjiTab?.url)) return;

  const nameInput = $<HTMLInputElement>('yunjiName');
  const submitBtn = $<HTMLButtonElement>('yunjiSubmitBtn');
  const cancelBtn = $<HTMLButtonElement>('yunjiCancelBtn');
  submitBtn.disabled = true;
  cancelBtn.disabled = true;
  setYunjiMessage('正在添加...');

  try {
    const url = $<HTMLInputElement>('yunjiUrl').value.trim();
    const categoryId = $<HTMLSelectElement>('yunjiCategory').value || undefined;
    const environmentId = $<HTMLSelectElement>('yunjiEnvironment').value || undefined;
    const result = await addTabToYunji(
      currentBaseUrl,
      selected,
      yunjiTab!,
      nameInput.value,
      url,
      { categoryId, environmentId }
    );
    $<HTMLDivElement>('yunjiForm').style.display = 'none';
    setYunjiMessage(`已收藏到云笈：${result.name}（${spaceLabel(selected)}）`, 'success');
    await renderInstanceCards();
  } catch (error) {
    if (error instanceof YunjiAuthError) {
      verifiedTokens.delete(selected.sessionId);
      await patchYunjiSpace(currentBaseUrl, selected.username, { expired: true });
      $<HTMLDivElement>('yunjiForm').style.display = 'none';
      setYunjiMessage('登录已过期，请先重新登录', 'error');
      void openSpaceForm('relogin', currentBaseUrl);
      await renderInstanceCards();
    } else {
      setYunjiMessage(errorMessage(error), 'error');
    }
  } finally {
    submitBtn.disabled = false;
    cancelBtn.disabled = false;
  }
}
