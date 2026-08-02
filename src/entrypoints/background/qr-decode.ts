// 二维码解码兜底链：jsQR（主）→ qrDecode（备）→ offscreen QrScanner（最后兜底）
import jsQR from 'jsqr';
import qrDecode from 'qr-decode';
import { getImageDataFromUrlServiceWorker, scanQRCodeWithOffscreen } from '../../utils/image';

/** 第一层：jsQR 解码（接收 ImageData 像素） */
export function decodeWithJsQR(imageData: ImageData): string | null {
  const code = jsQR(imageData.data, imageData.width, imageData.height);
  return code?.data ?? null;
}

/** 第二层：qrDecode 解码（接收 ImageData 像素） */
export function decodeWithQrDecode(imageData: ImageData): string | null {
  if (typeof qrDecode !== 'function') return null;
  return qrDecode(imageData) ?? null;
}

/** 第三层：离屏文档 QrScanner 解码（接收图片 URL） */
export async function decodeWithOffscreenQrScanner(imageUrl: string): Promise<string | null> {
  const res = await scanQRCodeWithOffscreen(imageUrl);
  if (!res.success && 'error' in res) {
    throw new Error(res.error);
  }
  const data = res.data as { data?: string };
  return data?.data ?? null;
}

/**
 * 三级解码兜底链。按序尝试，任一成功即返回文本。
 * 全部失败时抛出错误。
 */
export async function decodeQRCodeFromImageUrl(imageUrl: string): Promise<string> {
  // 先统一获取一次图片像素，供 jsQR / qrDecode 两层共用
  let imageData: ImageData | null = null;
  try {
    imageData = await getImageDataFromUrlServiceWorker(imageUrl);
  } catch (error) {
    console.log('getImageData', error);
  }

  // 第一层：jsQR
  if (imageData) {
    try {
      const text = decodeWithJsQR(imageData);
      if (text) return text;
    } catch (error) {
      console.log('jsQR', error);
    }

    // 第二层：qrDecode
    try {
      const text = decodeWithQrDecode(imageData);
      if (text) return text;
    } catch (error) {
      console.log('qrDecode', error);
    }
  }

  // 第三层：offscreen QrScanner（离屏文档内自行加载图片，与像素层无关）
  try {
    const text = await decodeWithOffscreenQrScanner(imageUrl);
    if (text) return text;
  } catch (error) {
    console.log('scanQRCode', error);
  }

  throw new Error('识别失败!');
}
