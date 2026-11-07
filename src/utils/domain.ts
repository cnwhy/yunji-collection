// 域名清洗与校验工具

/**
 * 从完整 URL 中提取纯 Host（如 `https://a.com:8080/path` -> `a.com`）。
 * 解析失败返回空字符串。
 */
export function extractPureDomain(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return '';
  }
}
