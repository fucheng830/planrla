// 外链处理的纯逻辑(零 electron 依赖,便于 node --test 单测)。
// 集成层(挂 handler / 调 shell.openExternal)在 main.js。

export const ALLOWED_PROTOCOLS = new Set(['http:', 'https:', 'mailto:', 'tel:', 'sms:']);

// URL 是否为白名单协议。非法 URL 返回 false(不抛),由调用方静默丢弃。
export function isAllowedUrl(rawUrl) {
  try {
    return ALLOWED_PROTOCOLS.has(new URL(rawUrl).protocol);
  } catch {
    return false;
  }
}
