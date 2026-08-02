/**
 * qr-decode npm 包的类型声明。
 * 该包为 CommonJS（`module.exports = decode`）且不携带类型，此处补充声明。
 * 在 `moduleResolution: bundler`（隐含 allowSyntheticDefaultImports）下
 * 可配合 `import qrDecode from 'qr-decode'` 使用。
 */
declare module 'qr-decode' {
  function qrDecode(imageData: ImageData): string;
  export = qrDecode;
}
