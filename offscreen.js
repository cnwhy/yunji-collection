// Offscreen 拥有完整的 DOM 和 Worker 环境，qr-scanner 可以完美运行
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.type === 'SCAN_IMAGE') {
        QrScanner.scanImage
            ? QrScanner.scanImage(msg.dataUrl, { returnDetailedScanResult: true })
                .then(result => sendResponse({ success: true, data: result }))
                .catch(err => sendResponse({ success: false, error: err }))
            : sendResponse({ success: false, error: 'QrScanner is not available' });
        return true; // 保持异步
    }
});