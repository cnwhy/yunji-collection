// DNR（declarativeNetRequest）规则生成与同步
// 由 popup / options 共享，确保两处对底层规则的操作完全一致

/**
 * 根据白名单域名数组同步浏览器底层 DNR 动态规则。
 * 每个域名对应一条 modifyHeaders 规则，为该域名发起方放行 CORS 响应头。
 */
export async function updateNetRules(domains: string[]): Promise<void> {
  const oldRules = await chrome.declarativeNetRequest.getDynamicRules();
  const oldIds = oldRules.map((rule) => rule.id);

  if (domains.length === 0) {
    await chrome.declarativeNetRequest.updateDynamicRules({ removeRuleIds: oldIds });
    return;
  }

  const newRules: chrome.declarativeNetRequest.Rule[] = domains.map((pureDomain, index) => {
    return {
      id: index + 1,
      priority: 1,
      action: {
        type: 'modifyHeaders' as chrome.declarativeNetRequest.RuleActionType,
        responseHeaders: [
          { header: 'Access-Control-Allow-Origin', operation: 'set' as chrome.declarativeNetRequest.HeaderOperation, value: '*' },
          { header: 'Access-Control-Allow-Methods', operation: 'set' as chrome.declarativeNetRequest.HeaderOperation, value: 'GET, POST, PUT, DELETE, OPTIONS' },
          { header: 'Access-Control-Allow-Headers', operation: 'set' as chrome.declarativeNetRequest.HeaderOperation, value: '*' },
        ],
      },
      condition: {
        initiatorDomains: [pureDomain],
        urlFilter: '|http*',
        resourceTypes: ['xmlhttprequest', 'ping'] as chrome.declarativeNetRequest.ResourceType[],
      },
    };
  });

  await chrome.declarativeNetRequest.updateDynamicRules({
    removeRuleIds: oldIds,
    addRules: newRules,
  });
}
