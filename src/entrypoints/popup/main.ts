import { extractPureDomain } from '../../utils/domain';
import { getDomains, setDomains } from '../../utils/storage';
import { updateNetRules } from '../../utils/dnr';
import {
  addTabToYunji,
  clearYunjiBinding,
  detectYunjiOrigin,
  fetchYunjiIdentity,
  getBrowserYunjiSession,
  getYunjiState,
  loginToYunji,
  patchYunjiSpace,
  removeYunjiSpace,
  resolveTabName,
  selectYunjiSpace,
  setYunjiBaseUrl,
  syncBrowserYunjiSession,
  upsertYunjiSpace,
  YunjiAuthError,
  type YunjiSpace,
} from '../../utils/yunji';

let currentPureDomain = '';
let yunjiTab: chrome.tabs.Tab | null = null;
let spaceFormMode: 'add' | 'relogin' = 'add';
let editingBaseUrl = false;

// 本次弹窗生命周期内已验证过的会话（按 token 记忆，避免每次刷新都请求）
const verifiedTokens = new Set<string>();
const verifyingTokens = new Set<string>();

document.addEventListener('DOMContentLoaded', initPopup);

async function initPopup() {
  const actionBtn = document.getElementById('actionBtn') as HTMLButtonElement;
  const openOptions = document.getElementById('openOptions') as HTMLAnchorElement;

  // 提示文案里的内联动作链接（data-action）统一走委托分发
  document.addEventListener('click', (event) => {
    const link = (event.target as HTMLElement | null)?.closest?.(
      'a[data-action]'
    ) as HTMLAnchorElement | null;
    if (!link) return;
    event.preventDefault();
    if (link.dataset.action === 'relogin') void openSpaceForm('relogin');
  });

  // 点击跳转到高级管理页
  openOptions.addEventListener('click', () => {
    chrome.runtime.openOptionsPage();
  });

  // 1. 获取当前活跃的标签页 URL
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

  // 2. 云笈收藏区块独立初始化，不影响跨域开关
  if (tab) initYunjiSection(tab);
  else setYunjiStatus('无法获取当前标签页', 'warn');

  if (!tab?.url) {
    showSystemPage('无法获取当前标签页');
    return;
  }

  // 3. 过滤掉 Chrome 内部特权页面
  if (tab.url.startsWith('chrome://') || tab.url.startsWith('chrome-extension://')) {
    showSystemPage('Chrome 系统页面（禁止跨域修改）');
    return;
  }

  // 4. 智能清洗出纯域名/Host
  currentPureDomain = extractPureDomain(tab.url);
  if (!currentPureDomain) {
    showSystemPage('无法解析的网址格式');
    return;
  }
  document.getElementById('currentDomain')!.textContent = currentPureDomain;

  // 5. 检查当前域名是否已存在，并刷新 UI
  await checkAndUpdateUI();

  // 5.1 初始化云笈跨域开关状态（控制云笈站点域名）
  await refreshYunjiCrossToggle();

  // 6. 绑定一键添加/删除按钮事件
  actionBtn.addEventListener('click', toggleDomainStatus);
}

// 检查状态并刷新 UI 样式
async function checkAndUpdateUI() {
  const statusText = document.getElementById('statusText')!;
  const actionBtn = document.getElementById('actionBtn') as HTMLButtonElement;

  const domains = await getDomains();
  const isAdded = domains.includes(currentPureDomain);

  actionBtn.style.display = 'block';
  if (isAdded) {
    statusText.textContent = '已开启泛域名跨域放行';
    statusText.className = 'status active';
    actionBtn.textContent = '一键移除白名单';
    actionBtn.className = 'btn-remove';
  } else {
    statusText.textContent = '当前域名未开启跨域';
    statusText.className = 'status inactive';
    actionBtn.textContent = '一键允许此网站跨域';
    actionBtn.className = 'btn-add';
  }
}

// 按钮点击：切换添加/删除状态
async function toggleDomainStatus() {
  const domains = await getDomains();
  const index = domains.indexOf(currentPureDomain);

  if (index > -1) {
    domains.splice(index, 1);
  } else {
    domains.push(currentPureDomain);
  }

  await setDomains(domains);
  // 同步 DNR 规则，保证弹窗与配置页完全一致
  await updateNetRules(domains);
  // 通知 background 立刻刷新图标 Badge
  chrome.runtime.sendMessage({ action: 'refreshBadge' });

  await checkAndUpdateUI();
  await refreshYunjiCrossToggle();
}

// 云笈内的跨域开关：控制绑定的云笈站点域名是否跨域放行
async function refreshYunjiCrossToggle() {
  const link = $<HTMLAnchorElement>('yunjiCrossToggleLink');
  const state = await getYunjiState();
  if (!state.baseUrl) {
    link.style.display = 'none';
    return;
  }
  link.style.display = '';
  const pureDomain = extractPureDomain(state.baseUrl);
  const domains = await getDomains();
  const enabled = domains.includes(pureDomain);
  link.classList.toggle('on', enabled);
  link.textContent = enabled ? '✓ 已放开跨域' : '点击放开跨域';
}

async function toggleYunjiCross() {
  const state = await getYunjiState();
  if (!state.baseUrl) return;
  const pureDomain = extractPureDomain(state.baseUrl);
  const domains = await getDomains();
  const index = domains.indexOf(pureDomain);

  if (index > -1) domains.splice(index, 1);
  else domains.push(pureDomain);

  await setDomains(domains);
  await updateNetRules(domains);
  chrome.runtime.sendMessage({ action: 'refreshBadge' });
  await refreshYunjiCrossToggle();
}

// 针对系统特权页面的置灰显示
function showSystemPage(msg: string) {
  document.getElementById('currentDomain')!.textContent = 'N/A';
  const statusText = document.getElementById('statusText')!;
  statusText.textContent = msg;
  statusText.className = 'status system';
  (document.getElementById('actionBtn') as HTMLButtonElement).style.display = 'none';
}

// ===== 云笈收藏 =====

function $<T extends HTMLElement>(id: string): T {
  return document.getElementById(id) as T;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** 渲染提示文本；useHtml 时按 HTML 渲染（调用方保证内容可信） */
function renderYunjiText(el: HTMLElement, text: string, useHtml: boolean) {
  if (useHtml) el.innerHTML = text;
  else el.textContent = text;
}

function setYunjiStatus(
  text: string,
  type: 'ok' | 'warn' | 'info' = 'info',
  useHtml = false
) {
  const el = $('yunjiStatus');
  renderYunjiText(el, text, useHtml);
  el.className = `yunji-status ${type}`;
}

function setYunjiMessage(
  text: string,
  type: 'info' | 'success' | 'error' = 'info',
  useHtml = false
) {
  const el = $('yunjiMessage');
  renderYunjiText(el, text, useHtml);
  el.className = `yunji-message ${type}`;
}

function stripProtocol(url: string): string {
  return url.replace(/^https?:\/\//, '');
}

function isHttpUrl(url: string | undefined): boolean {
  return !!url && /^https?:\/\//i.test(url);
}

function spaceLabel(space: YunjiSpace): string {
  return space.siteName ? `${space.siteName}（${space.username}）` : space.username;
}

function canCollectCurrentPage(baseUrl: string): boolean {
  if (!isHttpUrl(yunjiTab?.url)) return false;
  try {
    return new URL(yunjiTab!.url!).origin !== baseUrl;
  } catch {
    return false;
  }
}

async function selectedYunjiSpace(): Promise<YunjiSpace | null> {
  const state = await getYunjiState();
  return (
    state.spaces.find((item) => item.username === state.selectedUsername) ?? null
  );
}

async function initYunjiSection(tab: chrome.tabs.Tab) {
  yunjiTab = tab;

  // 地址配置
  $('yunjiSaveBaseUrlBtn').addEventListener('click', saveYunjiBaseUrl);
  $('yunjiBindBtn').addEventListener('click', () => void bindYunji());
  $('yunjiCancelBaseUrlBtn').addEventListener('click', async () => {
    editingBaseUrl = false;
    ($('yunjiBaseUrlInput') as HTMLInputElement).value = '';
    await refreshYunjiSection();
  });
  $('yunjiChangeBaseUrlIcon').addEventListener('click', (event) => {
    event.preventDefault();
    void (async () => {
      const state = await getYunjiState();
      editingBaseUrl = true;
      const input = $<HTMLInputElement>('yunjiBaseUrlInput');
      input.value = state.baseUrl;
      await refreshYunjiSection();
      input.focus();
      input.select();
    })();
  });
  $<HTMLInputElement>('yunjiBaseUrlInput').addEventListener('keydown', (event) => {
    if (event.key === 'Enter') void saveYunjiBaseUrl();
  });

  // 空间管理
  $<HTMLSelectElement>('yunjiSpaceSelect').addEventListener('change', async () => {
    const username = $<HTMLSelectElement>('yunjiSpaceSelect').value;
    if (!username) return;
    await selectYunjiSpace(username);
    setYunjiMessage('');
    await refreshYunjiSection();
  });
  $('yunjiAddSpaceLink').addEventListener('click', (event) => {
    event.preventDefault();
    void openSpaceForm('add');
  });
  $('yunjiSyncLink').addEventListener('click', (event) => {
    event.preventDefault();
    void syncBrowserLogin();
  });
  $('yunjiRemoveSpaceBtn').addEventListener('click', () => void removeSelectedSpace());
  $('yunjiCrossToggleLink').addEventListener('click', (event) => {
    event.preventDefault();
    void toggleYunjiCross();
  });
  $('yunjiClearBindIcon').addEventListener('click', (event) => {
    event.preventDefault();
    void clearYunjiBindingFromPopup();
  });

  // 空间登录表单
  $('yunjiSpaceCancelBtn').addEventListener('click', closeSpaceForm);
  $('yunjiSpaceSubmitBtn').addEventListener('click', () => void submitSpaceForm());
  $<HTMLInputElement>('yunjiPassword').addEventListener('keydown', (event) => {
    if (event.key === 'Enter') void submitSpaceForm();
  });

  // 收藏确认表单
  $('yunjiStartBtn').addEventListener('click', () => void openCollectForm());
  $('yunjiCancelBtn').addEventListener('click', () => void closeCollectForm());
  $('yunjiSubmitBtn').addEventListener('click', () => void submitCollectForm());

  setYunjiMessage('');
  await refreshYunjiSection();
}

async function refreshYunjiSection() {
  const statusEl = $('yunjiStatus');
  const state = await getYunjiState();
  const baseUrl = state.baseUrl;

  const originEl = $<HTMLAnchorElement>('yunjiOrigin');
  originEl.href = baseUrl ? baseUrl : '#';
  originEl.textContent = baseUrl ? stripProtocol(baseUrl) : '';
  originEl.style.pointerEvents = baseUrl ? 'auto' : 'none';
  $<HTMLDivElement>('yunjiConfigForm').style.display = 'none';
  $<HTMLDivElement>('yunjiPanel').style.display = 'none';
  $<HTMLButtonElement>('yunjiStartBtn').style.display = 'none';
  $('yunjiRemoveSpaceBtn').style.display = 'none';
  $('yunjiChangeBaseUrlIcon').style.display = 'none';
  $('yunjiClearBindIcon').style.display = 'none';
  void refreshYunjiCrossToggle();

  // 未配置地址，或正在更换地址：显示地址表单
  if (!baseUrl || editingBaseUrl) {
    $('yunjiLinks').style.display = 'none';
    const bindBtn = $<HTMLButtonElement>('yunjiBindBtn');
    const saveBtn = $<HTMLButtonElement>('yunjiSaveBaseUrlBtn');
    $<HTMLDivElement>('yunjiConfigForm').style.display = 'flex';
    $<HTMLButtonElement>('yunjiCancelBaseUrlBtn').style.display = editingBaseUrl ? 'block' : 'none';

    if (editingBaseUrl) {
      bindBtn.style.display = 'none';
      saveBtn.style.display = 'block';
      const input = $<HTMLInputElement>('yunjiBaseUrlInput');
      if (!input.value) input.value = baseUrl;
      setYunjiStatus('保存后生效，不同地址的空间凭证会分别保留');
      return;
    }

    if (!isHttpUrl(yunjiTab?.url)) {
      bindBtn.style.display = 'none';
      saveBtn.style.display = 'block';
      setYunjiStatus('填写云笈地址，或打开云笈站点自动识别');
      return;
    }

    setYunjiStatus('正在识别云笈站点...');
    const detected = await detectYunjiOrigin(yunjiTab!.url!);
    const input = $<HTMLInputElement>('yunjiBaseUrlInput');
    if (document.activeElement !== input) input.value = detected ?? '';

    const loggedIn = detected ? await getBrowserYunjiSession(detected) : null;
    if (detected && loggedIn) {
      bindBtn.style.display = 'block';
      saveBtn.style.display = 'none';
      setYunjiStatus('检测到云笈登录，点击「绑定云笈」即可使用', 'ok');
    } else {
      bindBtn.style.display = 'none';
      saveBtn.style.display = 'block';
      setYunjiStatus(
        detected
          ? `识别到云笈站点：${stripProtocol(detected)}，确认后保存`
          : '填写云笈地址，或打开云笈站点自动识别'
      );
    }
    return;
  }

  // 已配置地址：空间选择与管理
  $<HTMLDivElement>('yunjiPanel').style.display = 'block';
  $('yunjiLinks').style.display = 'flex';
  $('yunjiChangeBaseUrlIcon').style.display = 'inline';
  $('yunjiClearBindIcon').style.display = 'inline';
  const select = $<HTMLSelectElement>('yunjiSpaceSelect');
  select.innerHTML = '';

  if (state.spaces.length === 0) {
    select.disabled = true;
    const option = document.createElement('option');
    option.value = '';
    option.textContent = '还没有保存的空间';
    select.appendChild(option);
    setYunjiStatus('还没有保存的空间，请添加或同步浏览器登录', 'warn');
    return;
  }

  select.disabled = false;
  for (const space of state.spaces) {
    const option = document.createElement('option');
    option.value = space.username;
    option.textContent = `${spaceLabel(space)}${space.expired ? '（已过期）' : ''}`;
    select.appendChild(option);
  }

  const selected =
    state.spaces.find((item) => item.username === state.selectedUsername) ??
    state.spaces[0]!;
  select.value = selected.username;
  $('yunjiRemoveSpaceBtn').style.display = 'block';

  if (selected.expired) {
    setYunjiStatus(
      '登录已过期，请<a href="#" class="yunji-inline-link" data-action="relogin">重新登录</a>或同步浏览器登录',
      'warn',
      true
    );
    return;
  }

  if (verifiedTokens.has(selected.sessionId)) {
    setYunjiStatus(`已连接：${spaceLabel(selected)}`, 'ok');
    if (canCollectCurrentPage(baseUrl)) {
      $<HTMLButtonElement>('yunjiStartBtn').style.display = 'block';
    }
    return;
  }

  setYunjiStatus('正在检查登录状态...');
  void verifySelectedSpace();
}

/** 用 token 校验当前选中空间，失效则标记过期 */
async function verifySelectedSpace() {
  const state = await getYunjiState();
  const space =
    state.spaces.find((item) => item.username === state.selectedUsername) ?? null;
  if (!space || !state.baseUrl || space.expired) return;
  if (verifiedTokens.has(space.sessionId) || verifyingTokens.has(space.sessionId)) return;

  verifyingTokens.add(space.sessionId);
  try {
    const identity = await fetchYunjiIdentity(state.baseUrl, space.sessionId);
    verifiedTokens.add(space.sessionId);
    await patchYunjiSpace(space.username, {
      expired: false,
      siteName: identity.siteName || space.siteName,
    });
    await refreshYunjiSection();
  } catch (error) {
    if (error instanceof YunjiAuthError) {
      verifiedTokens.delete(space.sessionId);
      await patchYunjiSpace(space.username, { expired: true });
      setYunjiMessage(
        '登录已过期，请<a href="#" class="yunji-inline-link" data-action="relogin">重新登录</a>或同步浏览器登录',
        'error',
        true
      );
      await refreshYunjiSection();
    } else {
      setYunjiStatus(errorMessage(error), 'warn');
    }
  } finally {
    verifyingTokens.delete(space.sessionId);
  }
}

async function saveYunjiBaseUrl() {
  const input = $<HTMLInputElement>('yunjiBaseUrlInput');
  try {
    const baseUrl = await setYunjiBaseUrl(input.value);
    input.value = baseUrl;
    editingBaseUrl = false;
    verifiedTokens.clear();
    setYunjiMessage('云笈地址已保存', 'success');
    await refreshYunjiSection();
  } catch (error) {
    setYunjiMessage(errorMessage(error), 'error');
  }
}

async function clearYunjiBindingFromPopup() {
  if (!confirm('清除云笈绑定？当前地址下的空间凭证将一并删除。')) return;
  try {
    await clearYunjiBinding();
    verifiedTokens.clear();
    editingBaseUrl = false;
    ($('yunjiBaseUrlInput') as HTMLInputElement).value = '';
    setYunjiMessage('已清除云笈绑定', 'success');
    await refreshYunjiSection();
  } catch (error) {
    setYunjiMessage(errorMessage(error), 'error');
  }
}

/** 一键绑定：保存识别到的云笈地址，并把浏览器当前登录会话同步为空间凭证 */
async function bindYunji() {
  try {
    const baseUrl = await setYunjiBaseUrl($<HTMLInputElement>('yunjiBaseUrlInput').value);
    const identity = await syncBrowserYunjiSession(baseUrl);
    verifiedTokens.add(identity.sessionId);
    await upsertYunjiSpace(identity, { select: true });
    editingBaseUrl = false;
    setYunjiMessage(
      `已绑定云笈：${identity.siteName ? `${identity.siteName}（${identity.username}）` : baseUrl}`,
      'success'
    );
    await refreshYunjiSection();
  } catch (error) {
    setYunjiMessage(errorMessage(error), 'error');
    await refreshYunjiSection();
  }
}

/** 打开空间登录表单：add=添加空间，relogin=给当前空间重新登录 */
async function openSpaceForm(mode: 'add' | 'relogin') {
  const state = await getYunjiState();
  const selected =
    state.spaces.find((item) => item.username === state.selectedUsername) ?? null;
  if (mode === 'relogin' && !selected) return;

  spaceFormMode = mode;
  $('yunjiSpaceFormTitle').textContent =
    mode === 'relogin' && selected ? `重新登录：${spaceLabel(selected)}` : '添加空间';

  const usernameInput = $<HTMLInputElement>('yunjiUsername');
  usernameInput.disabled = mode === 'relogin';
  usernameInput.value = mode === 'relogin' && selected ? selected.username : '';
  ($<HTMLInputElement>('yunjiPassword')).value = '';

  $<HTMLDivElement>('yunjiSpaceForm').style.display = 'flex';
  $<HTMLButtonElement>('yunjiStartBtn').style.display = 'none';
  $<HTMLDivElement>('yunjiForm').style.display = 'none';
  setYunjiMessage('');
  (mode === 'relogin' ? $<HTMLInputElement>('yunjiPassword') : usernameInput).focus();
}

function closeSpaceForm() {
  $<HTMLDivElement>('yunjiSpaceForm').style.display = 'none';
  $<HTMLInputElement>('yunjiPassword').value = '';
  void refreshYunjiSection();
}

async function submitSpaceForm() {
  const state = await getYunjiState();
  if (!state.baseUrl) return;

  const usernameInput = $<HTMLInputElement>('yunjiUsername');
  const passwordInput = $<HTMLInputElement>('yunjiPassword');
  const username = spaceFormMode === 'relogin' ? usernameInput.value.trim() : usernameInput.value.trim();
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
    const identity = await loginToYunji(state.baseUrl, username, password);
    verifiedTokens.add(identity.sessionId);
    await upsertYunjiSpace(identity, { select: true });
    passwordInput.value = '';
    $<HTMLDivElement>('yunjiSpaceForm').style.display = 'none';
    setYunjiMessage(
      `已保存空间：${identity.siteName ? `${identity.siteName}（${identity.username}）` : identity.username}`,
      'success'
    );
    await refreshYunjiSection();
  } catch (error) {
    setYunjiMessage(errorMessage(error), 'error');
  } finally {
    submitBtn.disabled = false;
    cancelBtn.disabled = false;
  }
}

async function syncBrowserLogin() {
  const state = await getYunjiState();
  if (!state.baseUrl) return;

  setYunjiMessage('正在同步浏览器登录...');
  try {
    const identity = await syncBrowserYunjiSession(state.baseUrl);
    verifiedTokens.add(identity.sessionId);
    await upsertYunjiSpace(identity, { select: true });
    $<HTMLDivElement>('yunjiSpaceForm').style.display = 'none';
    setYunjiMessage(
      `已同步空间：${identity.siteName ? `${identity.siteName}（${identity.username}）` : identity.username}`,
      'success'
    );
    await refreshYunjiSection();
  } catch (error) {
    setYunjiMessage(errorMessage(error), 'error');
  }
}

async function removeSelectedSpace() {
  const space = await selectedYunjiSpace();
  if (!space) return;

  if (!confirm(`删除空间「${spaceLabel(space)}」的登录凭证？`)) return;

  verifiedTokens.delete(space.sessionId);
  await removeYunjiSpace(space.username);
  setYunjiMessage('已删除空间凭证', 'success');
  await refreshYunjiSection();
}

async function openCollectForm() {
  const state = await getYunjiState();
  const selected =
    state.spaces.find((item) => item.username === state.selectedUsername) ?? null;

  if (!isHttpUrl(yunjiTab?.url)) {
    setYunjiMessage('当前页面不支持收藏', 'error');
    return;
  }
  if (!selected) {
    setYunjiMessage('请先添加或同步一个空间', 'error');
    return;
  }
  if (selected.expired) {
    setYunjiMessage(
      '登录已过期，请<a href="#" class="yunji-inline-link" data-action="relogin">重新登录</a>',
      'error',
      true
    );
    void openSpaceForm('relogin');
    return;
  }

  const nameInput = $<HTMLInputElement>('yunjiName');
  const urlInput = $<HTMLInputElement>('yunjiUrl');

  nameInput.value = resolveTabName(yunjiTab!);
  urlInput.value = yunjiTab!.url!;

  $<HTMLDivElement>('yunjiSpaceForm').style.display = 'none';
  $<HTMLDivElement>('yunjiForm').style.display = 'flex';
  $<HTMLButtonElement>('yunjiStartBtn').style.display = 'none';
  setYunjiMessage('');
  nameInput.focus();
  nameInput.select();
}

async function closeCollectForm() {
  $<HTMLDivElement>('yunjiForm').style.display = 'none';
  await refreshYunjiSection();
}

async function submitCollectForm() {
  const state = await getYunjiState();
  const selected =
    state.spaces.find((item) => item.username === state.selectedUsername) ?? null;
  if (!selected || !isHttpUrl(yunjiTab?.url)) return;

  const nameInput = $<HTMLInputElement>('yunjiName');
  const submitBtn = $<HTMLButtonElement>('yunjiSubmitBtn');
  const cancelBtn = $<HTMLButtonElement>('yunjiCancelBtn');
  submitBtn.disabled = true;
  cancelBtn.disabled = true;
  setYunjiMessage('正在添加...');

  try {
    const url = $<HTMLInputElement>('yunjiUrl').value.trim();
    const result = await addTabToYunji(state.baseUrl, selected, yunjiTab!, nameInput.value, url);
    $<HTMLDivElement>('yunjiForm').style.display = 'none';
    setYunjiMessage(`已收藏到云笈：${result.name}（${spaceLabel(selected)}）`, 'success');
    await refreshYunjiSection();
  } catch (error) {
    if (error instanceof YunjiAuthError) {
      verifiedTokens.delete(selected.sessionId);
      await patchYunjiSpace(selected.username, { expired: true });
      $<HTMLDivElement>('yunjiForm').style.display = 'none';
      await openSpaceForm('relogin');
      setYunjiMessage(
        '登录已过期，请<a href="#" class="yunji-inline-link" data-action="relogin">重新登录</a>',
        'error',
        true
      );
      await refreshYunjiSection();
    } else {
      setYunjiMessage(errorMessage(error), 'error');
    }
  } finally {
    submitBtn.disabled = false;
    cancelBtn.disabled = false;
  }
}
