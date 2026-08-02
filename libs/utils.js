export async function getImageDataFromUrlServiceWorker(url) {
  // 1. 获取图片 Blob
  const response = await fetch(url);
  const blob = await response.blob();
  
  // 2. 创建 ImageBitmap
  const imageBitmap = await createImageBitmap(blob);
  
  // 3. 使用 OffscreenCanvas 获取 ImageData
  const canvas = new OffscreenCanvas(imageBitmap.width, imageBitmap.height);
  const ctx = canvas.getContext('2d');
  ctx.drawImage(imageBitmap, 0, 0);
  
  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  return imageData;
}

export async function scanQRCode(dataUrl) {
  // 确保 offscreen 页面已建立
  if (!await chrome.offscreen.hasDocument()) {
    await chrome.offscreen.createDocument({
      url: 'offscreen.html',
      reasons: ['BLOBS'],
      justification: '解码二维码图片'
    });
  }

  // 发送给 offscreen 解码
  const response = await chrome.runtime.sendMessage({
    type: 'SCAN_IMAGE',
    dataUrl: dataUrl
  });

  return response;
}