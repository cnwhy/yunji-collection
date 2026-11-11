// 云笈（yunji）导航站对接
// 多空间：同一云笈地址下可保存多个空间的会话 token，按 token 通过 Bearer 调用 API
// token 只保存在 chrome.storage.local，密码仅用于换取 token，不落盘

const CONFIG_KEY = 'yunjiConfig';
const LEGACY_BASE_URL_KEY = 'yunjiBaseUrl';
export const BROWSER_CATEGORY_NAME = '浏览器收藏';

export class YunjiError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'YunjiError';
  }
}

/** 会话失效（401 或 /api/auth/me 返回空 sessionUser） */
export class YunjiAuthError extends YunjiError {
  constructor(message = '云笈登录已过期，请重新登录') {
    super(message);
    this.name = 'YunjiAuthError';
  }
}

export interface YunjiSpace {
  username: string;
  siteName: string;
  sessionId: string;
  savedAt: number;
  expired: boolean;
}

export interface YunjiOriginState {
  baseUrl: string;
  spaces: YunjiSpace[];
  selectedUsername: string | null;
}

interface OriginBucket {
  spaces: YunjiSpace[];
  selectedUsername: string | null;
}

interface YunjiConfig {
  /** 当前选中实例的地址；origins 中的桶才是实例本体 */
  baseUrl: string;
  origins: Record<string, OriginBucket>;
}

export interface YunjiInstance {
  baseUrl: string;
  siteName: string;
  spaces: YunjiSpace[];
  selectedUsername: string | null;
}

export interface YunjiCategory {
  id: string;
  name: string;
  sort_order: number;
}

export interface YunjiEnvironment {
  id: string;
  name: string;
  color: string;
  sort_order: number;
}

export interface YunjiSiteUrl {
  environment_id: string;
  url: string;
}

export interface YunjiSite {
  id: string;
  name: string;
  icon: string | null;
  category_id: string | null;
  site_urls: YunjiSiteUrl[];
}

export interface AddSiteResult {
  name: string;
  icon: string;
}

export interface YunjiIdentity {
  username: string;
  siteName: string;
}

/** 规范化用户输入的云笈地址，只保留 origin */
export function normalizeYunjiBaseUrl(input: string): string {
  const raw = input.trim();
  if (!raw) throw new YunjiError('云笈地址不能为空');

  let candidate = raw;
  if (!/^https?:\/\//i.test(candidate)) {
    // 本地地址默认 http，其余默认 https
    const isLocal = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?(\/|$)/i.test(candidate);
    candidate = `${isLocal ? 'http' : 'https'}://${candidate}`;
  }

  let parsed: URL;
  try {
    parsed = new URL(candidate);
  } catch {
    throw new YunjiError('云笈地址格式不正确');
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new YunjiError('云笈地址必须以 http 或 https 开头');
  }
  return parsed.origin;
}

async function readConfig(): Promise<YunjiConfig> {
  const data = await chrome.storage.local.get({
    [CONFIG_KEY]: null,
    [LEGACY_BASE_URL_KEY]: '',
  });

  const stored = data[CONFIG_KEY] as YunjiConfig | null;
  if (stored && typeof stored.baseUrl === 'string') {
    return { baseUrl: stored.baseUrl, origins: stored.origins || {} };
  }

  // 兼容早期只存地址的版本
  const legacy = String(data[LEGACY_BASE_URL_KEY] || '');
  return { baseUrl: legacy, origins: {} };
}

async function writeConfig(config: YunjiConfig): Promise<void> {
  await chrome.storage.local.set({ [CONFIG_KEY]: config });
  await chrome.storage.local.remove(LEGACY_BASE_URL_KEY);
}

function bucketOf(config: YunjiConfig, baseUrl: string): OriginBucket {
  if (!baseUrl) return { spaces: [], selectedUsername: null };
  return config.origins[baseUrl] || { spaces: [], selectedUsername: null };
}

/** 全部已保存的云笈实例（按地址分桶），空地址的空桶也算一个实例 */
export async function listYunjiInstances(): Promise<YunjiInstance[]> {
  const config = await readConfig();
  const urls = new Set<string>();
  for (const key of Object.keys(config.origins)) urls.add(key);
  if (config.baseUrl) urls.add(config.baseUrl);

  return Array.from(urls).map((baseUrl) => {
    const bucket = bucketOf(config, baseUrl);
    const first = bucket.spaces[0];
    return {
      baseUrl,
      siteName: first?.siteName || baseUrl,
      spaces: bucket.spaces,
      selectedUsername: bucket.selectedUsername,
    };
  });
}

export async function selectYunjiInstance(baseUrl: string): Promise<void> {
  const config = await readConfig();
  if (config.baseUrl !== baseUrl && config.origins[baseUrl] === undefined) {
    throw new YunjiError('该云笈实例不存在');
  }
  config.baseUrl = baseUrl;
  await writeConfig(config);
}

/** 删除一个云笈实例；若删的是当前选中实例，回落到剩余第一个 */
export async function removeYunjiInstance(baseUrl: string): Promise<void> {
  const config = await readConfig();
  delete config.origins[baseUrl];
  if (config.baseUrl === baseUrl) {
    config.baseUrl = Object.keys(config.origins)[0] ?? '';
  }
  await writeConfig(config);
}

export async function getYunjiBaseUrl(): Promise<string> {
  return (await readConfig()).baseUrl;
}

export async function setYunjiBaseUrl(input: string): Promise<string> {
  const baseUrl = normalizeYunjiBaseUrl(input);
  const config = await readConfig();
  config.origins[baseUrl] ??= { spaces: [], selectedUsername: null };
  config.baseUrl = baseUrl;
  await writeConfig(config);
  return baseUrl;
}

/** 新增或更新某个空间的 token（登录/同步后调用） */
export async function upsertYunjiSpace(
  baseUrl: string,
  identity: YunjiIdentity & { sessionId: string },
  options: { select?: boolean } = {}
): Promise<void> {
  const config = await readConfig();
  if (!baseUrl) throw new YunjiError('尚未配置云笈地址');

  const bucket = bucketOf(config, baseUrl);
  const existing = bucket.spaces.find((item) => item.username === identity.username);
  if (existing) {
    existing.sessionId = identity.sessionId;
    existing.siteName = identity.siteName || existing.siteName;
    existing.savedAt = Date.now();
    existing.expired = false;
  } else {
    bucket.spaces.push({
      username: identity.username,
      siteName: identity.siteName,
      sessionId: identity.sessionId,
      savedAt: Date.now(),
      expired: false,
    });
  }

  if (options.select !== false || !bucket.selectedUsername) {
    bucket.selectedUsername = identity.username;
  }
  if (!bucket.spaces.some((item) => item.username === bucket.selectedUsername)) {
    bucket.selectedUsername = bucket.spaces[0]?.username ?? null;
  }

  config.origins[baseUrl] = bucket;
  await writeConfig(config);
}

export async function selectYunjiSpace(baseUrl: string, username: string): Promise<void> {
  const config = await readConfig();
  const bucket = bucketOf(config, baseUrl);
  if (!bucket.spaces.some((item) => item.username === username)) return;
  bucket.selectedUsername = username;
  config.origins[baseUrl] = bucket;
  await writeConfig(config);
}

export async function removeYunjiSpace(baseUrl: string, username: string): Promise<void> {
  const config = await readConfig();
  const bucket = bucketOf(config, baseUrl);
  bucket.spaces = bucket.spaces.filter((item) => item.username !== username);
  if (bucket.selectedUsername === username) {
    bucket.selectedUsername = bucket.spaces[0]?.username ?? null;
  }
  config.origins[baseUrl] = bucket;
  await writeConfig(config);
}

export async function patchYunjiSpace(
  baseUrl: string,
  username: string,
  patch: Partial<Pick<YunjiSpace, 'siteName' | 'expired'>>
): Promise<void> {
  const config = await readConfig();
  const bucket = bucketOf(config, baseUrl);
  const space = bucket.spaces.find((item) => item.username === username);
  if (!space) return;
  Object.assign(space, patch);
  config.origins[baseUrl] = bucket;
  await writeConfig(config);
}

/** 探测某个页面所属的站点是否为云笈 */
export async function detectYunjiOrigin(pageUrl: string): Promise<string | null> {
  let origin: string;
  try {
    const parsed = new URL(pageUrl);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
    origin = parsed.origin;
  } catch {
    return null;
  }

  // 云笈部署在 Serverless 时冷启动可能达 5s，探测只发生一次，放宽到 8s
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetch(`${origin}/api/setup/status`, {
      credentials: 'omit',
      signal: controller.signal,
      headers: { Accept: 'application/json' },
    });
    if (!response.ok) return null;

    const data = (await response.json().catch(() => null)) as
      | { needsSetup?: unknown; isNewDatabase?: unknown }
      | null;
    if (typeof data?.needsSetup !== 'boolean') return null;
    if (typeof data.isNewDatabase !== 'boolean') return null;
    return origin;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

const REQUEST_TIMEOUT_MS = 10000;

/** 带超时的 fetch：超时或网络失败统一抛「无法连接云笈」 */
async function fetchWithTimeout(url: string, init: RequestInit = {}): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new YunjiError('连接云笈超时，请检查地址和网络');
    }
    throw new YunjiError('无法连接云笈，请检查地址和网络');
  } finally {
    clearTimeout(timer);
  }
}

interface YunjiErrorBody {
  message?: string;
  error?: string;
}

async function parseError(response: Response): Promise<YunjiError> {
  const body = (await response.json().catch(() => null)) as YunjiErrorBody | null;
  const message = body?.message || body?.error || `云笈请求失败（${response.status}）`;
  if (response.status === 401) return new YunjiAuthError(message);
  return new YunjiError(message);
}

async function requestWithToken<T>(
  baseUrl: string,
  sessionId: string,
  path: string,
  init: RequestInit = {}
): Promise<T> {
  const headers: Record<string, string> = { Authorization: `Bearer ${sessionId}` };
  if (init.body) headers['Content-Type'] = 'application/json';

  let response: Response;
  try {
    response = await fetchWithTimeout(`${baseUrl}${path}`, {
      ...init,
      credentials: 'omit',
      headers,
    });
  } catch (error) {
    throw error instanceof YunjiError ? error : new YunjiError('无法连接云笈，请检查地址和网络');
  }

  if (!response.ok) throw await parseError(response);

  const data = (await response.json().catch(() => null)) as T;
  return data;
}

interface MeResponse {
  sessionUser: { username?: string; site_name?: string } | null;
}

/** 用 token 读取当前会话身份；sessionUser 为空表示 token 已失效 */
export async function fetchYunjiIdentity(baseUrl: string, sessionId: string): Promise<YunjiIdentity> {
  const data = await requestWithToken<MeResponse>(baseUrl, sessionId, '/api/auth/me');
  if (!data?.sessionUser) {
    throw new YunjiAuthError();
  }
  return {
    username: data.sessionUser.username || '',
    siteName: data.sessionUser.site_name || '',
  };
}

interface TokenLoginResponse {
  sessionId: string;
  maxAge: number;
  user: { username: string };
  siteName: string;
}

/**
 * 用空间ID和密码换取 token。
 * 请求不带 credentials，避免覆盖浏览器里当前登录的云笈会话。
 */
export async function loginToYunji(
  baseUrl: string,
  username: string,
  password: string
): Promise<YunjiIdentity & { sessionId: string }> {
  let response: Response;
  try {
    response = await fetchWithTimeout(`${baseUrl}/api/auth/token`, {
      method: 'POST',
      credentials: 'omit',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: username.trim(), password, keepLoggedIn: true }),
    });
  } catch (error) {
    throw error instanceof YunjiError ? error : new YunjiError('无法连接云笈，请检查地址和网络');
  }

  if (!response.ok) throw await parseError(response);

  const data = (await response.json()) as TokenLoginResponse;
  if (!data?.sessionId) throw new YunjiError('云笈未返回登录凭证');

  return {
    sessionId: data.sessionId,
    username: data.user?.username || username.trim(),
    siteName: data.siteName || '',
  };
}

/** 读取浏览器里云笈站点的登录会话（httpOnly cookie 也可通过 cookies API 读取） */
export async function getBrowserYunjiSession(baseUrl: string): Promise<string | null> {
  if (!baseUrl) return null;
  const cookie = await chrome.cookies.get({ url: `${baseUrl}/`, name: 'sessionid' });
  return cookie?.value || null;
}

/** 把浏览器当前登录的云笈会话同步为某个空间 token */
export async function syncBrowserYunjiSession(
  baseUrl: string
): Promise<YunjiIdentity & { sessionId: string }> {
  const sessionId = await getBrowserYunjiSession(baseUrl);
  if (!sessionId) {
    throw new YunjiError('当前浏览器未登录云笈，请先在云笈登录');
  }
  const identity = await fetchYunjiIdentity(baseUrl, sessionId);
  return { ...identity, sessionId };
}

export async function getYunjiEnvironments(
  baseUrl: string,
  sessionId: string
): Promise<YunjiEnvironment[]> {
  return requestWithToken<YunjiEnvironment[]>(baseUrl, sessionId, '/api/environments');
}

export async function getYunjiSites(baseUrl: string, sessionId: string): Promise<YunjiSite[]> {
  return requestWithToken<YunjiSite[]>(baseUrl, sessionId, '/api/sites');
}

export async function getYunjiCategories(
  baseUrl: string,
  sessionId: string
): Promise<YunjiCategory[]> {
  return requestWithToken<YunjiCategory[]>(baseUrl, sessionId, '/api/categories');
}

/** 找到（或自动创建）「浏览器收藏」分类 */
async function getOrCreateBrowserCategoryId(baseUrl: string, sessionId: string): Promise<string> {
  const categories = await getYunjiCategories(baseUrl, sessionId);
  const existing = categories.find((item) => item.name === BROWSER_CATEGORY_NAME);
  if (existing) return existing.id;

  const maxSort = categories.reduce((max, item) => Math.max(max, item.sort_order ?? 0), 0);
  const created = await requestWithToken<{ id: string }>(baseUrl, sessionId, '/api/categories', {
    method: 'POST',
    body: JSON.stringify({ name: BROWSER_CATEGORY_NAME, sort_order: maxSort + 100 }),
  });
  return created.id;
}

/** 云笈中排序第一个的环境；空间还没有环境时自动创建一个「默认」环境 */
async function getDefaultEnvironment(
  baseUrl: string,
  sessionId: string
): Promise<YunjiEnvironment> {
  let environments = await getYunjiEnvironments(baseUrl, sessionId);
  if (environments.length === 0) {
    const created = await requestWithToken<{ id: string }>(baseUrl, sessionId, '/api/environments', {
      method: 'POST',
      body: JSON.stringify({ name: '默认', sort_order: 100, color: '#2ea6fc' }),
    });
    environments = await getYunjiEnvironments(baseUrl, sessionId);
    const fresh = environments.find((env) => env.id === created.id);
    if (fresh) return fresh;
  }
  const first = environments[0];
  if (!first) throw new YunjiError('云笈中还没有环境，请先创建一个环境');
  return first;
}

async function findSiteByUrl(
  baseUrl: string,
  sessionId: string,
  url: string
): Promise<YunjiSite | null> {
  const sites = await getYunjiSites(baseUrl, sessionId);
  return sites.find((site) => site.site_urls?.some((item) => item.url === url)) ?? null;
}

/** 优先使用标签页的 favicon；http(s) 页面取不到时回退到站点根目录的 favicon.ico */
export function resolveTabIcon(tab: chrome.tabs.Tab): string {
  const favicon = tab.favIconUrl?.trim() ?? '';
  if (/^(https?:|data:)/i.test(favicon)) return favicon;

  if (tab.url && /^https?:\/\//i.test(tab.url)) {
    try {
      return `${new URL(tab.url).origin}/favicon.ico`;
    } catch {
      // ignore
    }
  }
  return '';
}

export function resolveTabName(tab: chrome.tabs.Tab): string {
  const title = tab.title?.trim();
  if (title) return title;

  if (tab.url) {
    try {
      return new URL(tab.url).hostname;
    } catch {
      // ignore
    }
  }
  return '';
}

/**
 * 把标签页收藏到指定空间：
 * 名称与网址由调用方传入（可在弹窗中二次编辑）；不指定分类/环境时，
 * 自动写入「浏览器收藏」分类 + 云笈第一个环境（无环境时自动创建默认）。
 * 开头先校验 token，避免 token 失效时被匿名公开空间兜底而读到错误数据。
 */
export async function addTabToYunji(
  baseUrl: string,
  space: YunjiSpace,
  tab: chrome.tabs.Tab,
  name: string,
  url: string,
  options: { categoryId?: string; environmentId?: string } = {}
): Promise<AddSiteResult> {
  const targetUrl = url.trim();
  if (!targetUrl) {
    throw new YunjiError('网址不能为空');
  }
  try {
    new URL(targetUrl);
  } catch {
    throw new YunjiError('网址格式不正确，请输入完整地址（如 https://…、chrome://…）');
  }

  const siteName = name.trim();
  if (!siteName) throw new YunjiError('站点名称不能为空');

  await fetchYunjiIdentity(baseUrl, space.sessionId);

  const existing = await findSiteByUrl(baseUrl, space.sessionId, targetUrl);
  if (existing) throw new YunjiError(`该网址已收藏到云笈：${existing.name}`);

  const categoryId =
    options.categoryId ||
    (await getOrCreateBrowserCategoryId(baseUrl, space.sessionId));

  let environment: YunjiEnvironment;
  if (options.environmentId) {
    const environments = await getYunjiEnvironments(baseUrl, space.sessionId);
    const found = environments.find((env) => env.id === options.environmentId);
    if (!found) throw new YunjiError('所选环境不存在，请刷新后重试');
    environment = found;
  } else {
    environment = await getDefaultEnvironment(baseUrl, space.sessionId);
  }
  const icon = resolveTabIcon(tab);

  await requestWithToken<{ id: string }>(baseUrl, space.sessionId, '/api/sites', {
    method: 'POST',
    body: JSON.stringify({
      name: siteName,
      categoryId,
      icon,
      remark: '',
      urls: [{ environment_id: environment.id, url: targetUrl }],
    }),
  });

  return { name: siteName, icon };
}
