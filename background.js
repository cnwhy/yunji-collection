// 导入本地的二维码识别库
import './libs/jsQR.js';
import './libs/qr-decode.umd.js';
import * as utils from './libs/utils.js';

const debug = 0;
// console.log('qrDecode', qrDecode);
// 1. 当插件安装或更新时，创建右键菜单
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: "scanQRCode",
    title: "🔍 识别图中的二维码",
    contexts: ["image"] // 👈 只在用户右键点击“图片”时才显示此菜单
  });
});

const runTime = async function (run, name) {
  let now = Date.now();
  const d = await run();
  debug && console.log(name, '->', d, ' : ', Date.now() - now);
  return d
}

// 2. 监听右键菜单的点击事件
chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId === "scanQRCode") {
    // console.log('info', info);
    const imageUrl = info.srcUrl; // 获取被右键点击的图片绝对路径

    // 在图标上显示加载状态，提示用户正在识别
    chrome.action.setBadgeText({ text: '...', tabId: tab.id });
    chrome.action.setBadgeBackgroundColor({ color: '#1890ff', tabId: tab.id });
    // console.log('QrScanner', QrScanner);
    let qrCodeText = '';
    const imageData = await utils.getImageDataFromUrlServiceWorker(imageUrl);
    try {

      if (!qrCodeText) {
        try {
          qrCodeText = await runTime(async () => {
            return (await jsQR(imageData.data, imageData.width, imageData.height))?.data;
          }, 'jsQR');
        } catch (error) {
          console.log('jsQR', error);
        }
      }

      if (!qrCodeText || debug) {
        try {
          qrCodeText = await runTime(async () => qrDecode(imageData), 'qrDecode');
        } catch (error) {
          console.log('qrDecode', error);
        }
      }

      if (!qrCodeText || debug) {
        try {
          qrCodeText = await runTime(() => (utils.scanQRCode(imageUrl).then((res) => {
            if (res.success) return res.data?.data;
            throw Error(res.error);
          })), 'QrScanner');
        } catch (error) {
          console.log('scanQRCode', error);
        }
      }

      if (!qrCodeText) {
        throw new Error("识别失败!");
      }

      // 成功识别：通过注入脚本在网页上弹窗通知用户，并自动复制到剪贴板
      chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: (text) => {
          // 自动复制到剪贴板
          navigator.clipboard.writeText(text).then(() => {
            alert(`🎉 二维码识别成功！内容已复制到剪贴板：\n\n${text}`);
          }).catch(() => {
            alert(`🎉 二维码识别成功！内容如下：\n\n${text}`);
          });
        },
        args: [qrCodeText]
      });

    } catch (error) {
      // 识别失败：弹窗提示原因
      chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: (errMessage) => { alert(`❌ 识别失败！`); },
        args: [error.message]
      });
    } finally {
      // 恢复原有图标状态（调用我们之前写的函数）
      if (typeof updateIconStatus === 'function') {
        updateIconStatus(tab.id);
      } else {
        chrome.action.setBadgeText({ text: '', tabId: tab.id });
      }
    }
  }
});

// 3. 核心黑科技：通过图片 URL 提取像素并交给 jsQR 解析
async function decodeQRCodeFromUrl(url) {
  // 注意：部分外链图片可能会触发跨域限制，但由于我们在写跨域插件，这正好是我们的强项！
  // const response = await fetch(url);
  // const blob = await response.blob();

  // // 将 Blob 转换为可以提取 ImageData 的数据源
  // const bitmap = await createImageBitmap(blob);

  // // 利用 OffscreenCanvas（离屏画布）在后台偷偷绘制图片并提取像素
  // // 这是 MV3 Background 中没有 DOM（没有 document.createElement）时唯一的绘图手段
  // const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
  // const ctx = canvas.getContext('2d');
  // ctx.drawImage(bitmap, 0, 0);

  // const imageData = ctx.getImageData(0, 0, bitmap.width, bitmap.height);

  const imageData = await getImageDataFromUrlServiceWorker(url);
  const code = jsQR(imageData.data, imageData.width, imageData.height);

  if (code && code.data) {
    return code.data; // 返回识别出的字符串
  } else {
    throw new Error("图片中未检测到清晰的二维码");
  }
}

// 监听标签页切换
chrome.tabs.onActivated.addListener((activeInfo) => {
  if (typeof updateIconStatus === 'function') updateIconStatus(activeInfo.tabId);
});

// 监听网页加载/刷新
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete' && typeof updateIconStatus === 'function') updateIconStatus(tabId);
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