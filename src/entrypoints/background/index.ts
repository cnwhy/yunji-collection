import { getDomains } from '../../utils/storage';
import { decodeQRCodeFromImageUrl } from './qr-decode';

export default defineBackground(() => {
  // 1. 插件安装或更新时，创建右键菜单
  chrome.runtime.onInstalled.addListener(() => {
    chrome.contextMenus.create({
      id: 'scanQRCode',
      title: '🔍 识别图中的二维码',
      contexts: ['image'],
    });
  });

  // 2. 监听右键菜单点击，执行三级解码兜底链
  chrome.contextMenus.onClicked.addListener(async (info, tab) => {
    if (info.menuItemId !== 'scanQRCode' || !tab?.id || !info.srcUrl) return;
    const imageUrl = info.srcUrl;

    // 图标上显示加载状态
    chrome.action.setBadgeText({ text: '...', tabId: tab.id });
    chrome.action.setBadgeBackgroundColor({ color: '#1890ff', tabId: tab.id });

    try {
      const qrCodeText = await decodeQRCodeFromImageUrl(imageUrl);

      // 成功：注入脚本通知用户并复制到剪贴板
      chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: (text: string) => {
          navigator.clipboard
            .writeText(text)
            .then(() => {
              alert(`🎉 二维码识别成功！内容已复制到剪贴板：\n\n${text}`);
            })
            .catch(() => {
              alert(`🎉 二维码识别成功！内容如下：\n\n${text}`);
            });
        },
        args: [qrCodeText],
      });
    } catch (error) {
      // 失败：弹窗提示失败原因
      const message = error instanceof Error ? error.message : String(error);
      chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: (errMessage: string) => {
          alert(`❌ 识别失败！${errMessage}`);
        },
        args: [message],
      });
    } finally {
      // 恢复图标状态
      chrome.action.setBadgeText({ text: '', tabId: tab.id });
    }
  });

  // 3. Badge 状态管理：根据当前网页域名是否在白名单中显示 ON
  const updateIconStatus = async (tabId: number) => {
    try {
      const tab = await chrome.tabs.get(tabId);
      if (!tab?.url) return;

      // 过滤系统特权页面
      if (tab.url.startsWith('chrome://') || tab.url.startsWith('chrome-extension://')) {
        chrome.action.setBadgeText({ text: '', tabId });
        return;
      }

      // 提取纯域名并检查白名单
      const pureDomain = new URL(tab.url).hostname.toLowerCase();
      const domains = await getDomains();
      if (domains.includes(pureDomain)) {
        chrome.action.setBadgeText({ text: 'ON', tabId });
        chrome.action.setBadgeBackgroundColor({ color: '#52c41a', tabId });
      } else {
        chrome.action.setBadgeText({ text: '', tabId });
      }
    } catch (e) {
      console.error('更新图标状态失败:', e);
    }
  };

  chrome.tabs.onActivated.addListener((activeInfo) => updateIconStatus(activeInfo.tabId));
  chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
    if (changeInfo.status === 'complete') updateIconStatus(tabId);
  });

  // 接收 popup 通知，点击切换后立即刷新 badge
  chrome.runtime.onMessage.addListener((message) => {
    if (message.action === 'refreshBadge') {
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (tabs[0]?.id) updateIconStatus(tabs[0].id);
      });
    }
  });
});
