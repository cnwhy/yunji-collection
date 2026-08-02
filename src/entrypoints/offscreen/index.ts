// Offscreen 文档：拥有完整 DOM 和 Worker 环境，可运行 QrScanner
import QrScanner from 'qr-scanner';

// 显式指定 worker 的绝对路径（扩展环境中需通过 runtime.getURL 解析静态资源）
QrScanner.WORKER_PATH = chrome.runtime.getURL('qr-scanner-worker.min.js');

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type !== 'SCAN_IMAGE') return;

  QrScanner.scanImage(msg.dataUrl as string, { returnDetailedScanResult: true })
    .then((result) => {
      sendResponse({ success: true, data: result });
    })
    .catch((err: unknown) => {
      const message = err instanceof Error ? err.message : String(err);
      sendResponse({ success: false, error: message });
    });
  return true; // 保持异步响应
});
