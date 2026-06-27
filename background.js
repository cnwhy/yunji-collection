// 监听标签页切换
chrome.tabs.onActivated.addListener((activeInfo) => {
  updateIconStatus(activeInfo.tabId);
});

// 监听网页加载/刷新
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete') {
    updateIconStatus(tabId);
  }
});

// 核心函数：根据当前网页域名，动态修改图标上的 Badge
async function updateIconStatus(tabId) {
  try {
    const tab = await chrome.tabs.get(tabId);
    if (!tab || !tab.url) return;

    const url = tab.url;
    // 过滤系统特权页面
    if (url.startsWith('chrome://') || url.startsWith('chrome-extension://')) {
      chrome.action.setBadgeText({ text: '', tabId: tabId }); // 清空
      return;
    }

    // 提取纯域名
    const urlObj = new URL(url);
    const pureDomain = urlObj.hostname.toLowerCase();

    // 从存储中检查是否已开启跨域
    const data = await chrome.storage.local.get({ domains: [] });
    const isAdded = data.domains.includes(pureDomain);

    if (isAdded) {
      // ✅ 已开启：显示绿底白字 "ON"
      chrome.action.setBadgeText({ text: 'ON', tabId: tabId });
      chrome.action.setBadgeBackgroundColor({ color: '#52c41a', tabId: tabId });
    } else {
      // ❌ 未开启：不显示，或者显示灰底 "OFF" (这里推荐不显示，界面更清爽)
      chrome.action.setBadgeText({ text: '', tabId: tabId });
    }
  } catch (e) {
    console.error("更新图标状态失败:", e);
  }
}

// 接收来自 popup.js 的通知，当用户点击切换时立刻刷新当前图标
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'refreshBadge') {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]) updateIconStatus(tabs[0].id);
    });
  }
});