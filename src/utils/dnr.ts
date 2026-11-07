// DNR（declarativeNetRequest）规则生成与同步
// 云笈跨域开关依赖此规则，放行云笈站点发起的跨域请求

type DnrRule = {
  id: number;
  priority: number;
  action: {
    type: 'modifyHeaders';
    responseHeaders: { header: string; operation: 'set' | 'remove'; value?: string }[];
  };
  condition: {
    initiatorDomains: string[];
    urlFilter: string;
    resourceTypes: string[];
  };
};

type DnrApi = {
  getDynamicRules(): Promise<{ id: number }[]>;
  updateDynamicRules(options: { removeRuleIds: number[]; addRules?: DnrRule[] }): Promise<void>;
};

/**
 * 根据白名单域名数组同步浏览器底层 DNR 动态规则。
 * 每个域名对应一条 modifyHeaders 规则，为该域名发起方放行 CORS 响应头。
 */
export async function updateNetRules(domains: string[]): Promise<void> {
  const dnr = (globalThis as unknown as { chrome: { declarativeNetRequest: DnrApi } }).chrome.declarativeNetRequest;
  const oldRules = await dnr.getDynamicRules();
  const oldIds = oldRules.map((rule) => rule.id);

  if (domains.length === 0) {
    await dnr.updateDynamicRules({ removeRuleIds: oldIds });
    return;
  }

  const newRules: DnrRule[] = domains.map((pureDomain, index) => {
    console.log(pureDomain);
    return {
      id: index + 1,
      priority: 1,
      action: {
        type: 'modifyHeaders',
        responseHeaders: [
          { header: 'Access-Control-Allow-Origin', operation: 'set', value: '*' },
          { header: 'Access-Control-Allow-Methods', operation: 'set', value: 'GET, POST, PUT, DELETE, OPTIONS' },
          { header: 'Access-Control-Allow-Headers', operation: 'set', value: '*' },
          // no-cors 子资源加载会被 CORP 拦截，随同放行
          { header: 'Cross-Origin-Embedder-Policy', operation: 'remove' },
          { header: 'Cross-Origin-Opener-Policy', operation: 'remove' },
          { header: 'Cross-Origin-Resource-Policy', operation: 'remove' },
        ],
      },
      condition: {
        initiatorDomains: [pureDomain],
        urlFilter: '|http*',
        resourceTypes: ['xmlhttprequest', 'ping', 'other', 'script', 'image', 'media', 'font', 'object'],
      },
    };
  });

  await dnr.updateDynamicRules({
    removeRuleIds: oldIds,
    addRules: newRules,
  });
}
