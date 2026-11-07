// 白名单域名存储封装
// 统一管理 chrome.storage.local 中的 domains 列表

const STORAGE_KEY = 'domains';

/** 读取全部白名单域名 */
export async function getDomains(): Promise<string[]> {
  const data = await chrome.storage.local.get({ [STORAGE_KEY]: [] as string[] });
  return data[STORAGE_KEY] ?? [];
}

/** 覆盖写入白名单域名列表 */
export async function setDomains(domains: string[]): Promise<void> {
  await chrome.storage.local.set({ [STORAGE_KEY]: domains });
}
