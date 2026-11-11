import { getDomains } from '../../utils/storage';

export default defineBackground(() => {
  const iconSizes = [16, 32, 48, 96, 128] as const;
  const iconPaths = Object.fromEntries(iconSizes.map((size) => [size, `icon/${size}.png`]));
  let checkedIconData: Record<number, ImageData> | undefined;
  const iconUpdateIds = new Map<number, number>();

  const getCheckedIconData = async (): Promise<Record<number, ImageData>> => {
    if (checkedIconData) return checkedIconData;

    const result: Record<number, ImageData> = {};
    for (const size of iconSizes) {
      const response = await fetch(chrome.runtime.getURL(`icon/${size}.png`));
      if (!response.ok) throw new Error(`无法加载扩展图标: ${size}.png`);

      const bitmap = await createImageBitmap(await response.blob());
      const canvas = new OffscreenCanvas(size, size);
      const context = canvas.getContext('2d');
      if (!context) {
        bitmap.close();
        throw new Error('无法创建扩展图标绘制上下文');
      }

      context.drawImage(bitmap, 0, 0, size, size);
      bitmap.close();

      const points = [
        [size * 0.62, size * 0.68],
        [size * 0.72, size * 0.77],
        [size * 0.88, size * 0.56],
      ] as const;
      context.lineCap = 'round';
      context.lineJoin = 'round';
      context.lineWidth = Math.max(1.5, size * 0.12);
      context.strokeStyle = '#fff';
      context.beginPath();
      context.moveTo(...points[0]);
      context.lineTo(...points[1]);
      context.lineTo(...points[2]);
      context.stroke();

      context.lineWidth = Math.max(0.8, size * 0.07);
      context.strokeStyle = '#52c41a';
      context.beginPath();
      context.moveTo(...points[0]);
      context.lineTo(...points[1]);
      context.lineTo(...points[2]);
      context.stroke();

      result[size] = context.getImageData(0, 0, size, size);
    }

    checkedIconData = result;
    return result;
  };

  // 云笈跨域开关放行后，在原图标右下角动态绘制绿色勾号。
  const updateIconStatus = async (tabId: number) => {
    const updateId = (iconUpdateIds.get(tabId) ?? 0) + 1;
    iconUpdateIds.set(tabId, updateId);
    try {
      const tab = await chrome.tabs.get(tabId);
      if (iconUpdateIds.get(tabId) !== updateId) return;
      if (!tab?.url) {
        await chrome.action.setIcon({ path: iconPaths, tabId });
        return;
      }

      // 过滤系统特权页面
      if (tab.url.startsWith('chrome://') || tab.url.startsWith('chrome-extension://')) {
        chrome.action.setBadgeText({ text: '', tabId });
        if (iconUpdateIds.get(tabId) !== updateId) return;
        await chrome.action.setIcon({ path: iconPaths, tabId });
        return;
      }

      // 提取纯域名并检查白名单
      const pureDomain = new URL(tab.url).hostname.toLowerCase();
      const domains = await getDomains();
      if (iconUpdateIds.get(tabId) !== updateId) return;
      chrome.action.setBadgeText({ text: '', tabId });
      if (domains.includes(pureDomain)) {
        const imageData = await getCheckedIconData();
        if (iconUpdateIds.get(tabId) !== updateId) return;
        await chrome.action.setIcon({ imageData, tabId });
      } else {
        await chrome.action.setIcon({ path: iconPaths, tabId });
      }
    } catch (e) {
      // 标签页在异步更新期间被关闭属正常情况，无需告警
      if (e instanceof Error && /No tab with id/.test(e.message)) return;
      console.error('更新图标状态失败:', e);
    }
  };

  chrome.tabs.onRemoved.addListener((tabId) => iconUpdateIds.delete(tabId));
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
