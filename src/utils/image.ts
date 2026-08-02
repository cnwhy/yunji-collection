// 图片处理：Service Worker 环境下的像素提取与离屏文档管理

const OFFSCREEN_URL = 'offscreen.html';

/**
 * 通过图片 URL 提取像素 ImageData。
 * 适用于 MV3 Background Service Worker（无 DOM，使用 OffscreenCanvas）。
 */
export async function getImageDataFromUrlServiceWorker(url: string): Promise<ImageData> {
  const response = await fetch(url);
  const blob = await response.blob();
  const imageBitmap = await createImageBitmap(blob);
  const canvas = new OffscreenCanvas(imageBitmap.width, imageBitmap.height);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('无法创建 OffscreenCanvas 2D 上下文');
  ctx.drawImage(imageBitmap, 0, 0);
  return ctx.getImageData(0, 0, canvas.width, canvas.height);
}

/**
 * 确保离屏文档已创建（Chrome 116+ 使用 runtime.getContexts 检测）。
 */
export async function ensureOffscreenDocument(): Promise<void> {
  const offscreenUrl = chrome.runtime.getURL(OFFSCREEN_URL);
  const existingContexts = await chrome.runtime.getContexts({
    contextTypes: [chrome.runtime.ContextType.OFFSCREEN_DOCUMENT],
    documentUrls: [offscreenUrl],
  });
  if (existingContexts.length > 0) return;

  await chrome.offscreen.createDocument({
    url: OFFSCREEN_URL,
    reasons: [chrome.offscreen.Reason.BLOBS],
    justification: '解码二维码图片',
  });
}

/**
 * 通过离屏文档调用 QrScanner 解码。
 * 返回 offscreen 的响应；失败时返回 { success: false, error }。
 */
export async function scanQRCodeWithOffscreen(dataUrl: string): Promise<
  { success: true; data: unknown } | { success: false; error: string }
> {
  await ensureOffscreenDocument();
  const response = (await chrome.runtime.sendMessage({
    type: 'SCAN_IMAGE',
    dataUrl,
  })) as { success: true; data: unknown } | { success: false; error: string };

  return response;
}
