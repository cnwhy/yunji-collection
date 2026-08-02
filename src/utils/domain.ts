// 域名清洗与校验工具

// 支持：localhost、127.0.0.1、标准线上域名(example.com)
const DOMAIN_REGEX =
  /^(localhost|((25[0-5]|2[0-4]\d|[01]?\d\d?)\.){3}(25[0-5]|2[0-4]\d|[01]?\d\d?)|([a-zA-Z0-9][-a-zA-Z0-9]{0,62}\.)+[a-zA-Z]{2,})$/;

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

/**
 * 智能清洗域名输入并校验合法性：
 * - 若输入完整 URL（http/https），提取其 hostname
 * - 去掉端口，只留纯域名
 *
 * 返回清洗后的纯域名；输入为空或非法时返回 null。
 */
export function sanitizeAndValidateDomain(input: string): string | null {
  const raw = input.trim();
  if (!raw) return null;

  let candidate = raw;
  if (/^https?:\/\//i.test(candidate)) {
    const host = extractPureDomain(candidate);
    if (!host) return null;
    candidate = host;
  }

  const pureDomain = candidate.split(':')[0]?.toLowerCase() ?? '';
  return DOMAIN_REGEX.test(pureDomain) ? pureDomain : null;
}
