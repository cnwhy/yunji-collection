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

/** 添加域名（自动查重），返回是否实际新增 */
export async function addDomain(domain: string): Promise<boolean> {
  const domains = await getDomains();
  if (domains.includes(domain)) return false;
  domains.push(domain);
  await setDomains(domains);
  return true;
}

/** 移除域名，返回是否实际移除 */
export async function removeDomain(domain: string): Promise<boolean> {
  const domains = await getDomains();
  const index = domains.indexOf(domain);
  if (index === -1) return false;
  domains.splice(index, 1);
  await setDomains(domains);
  return true;
}
