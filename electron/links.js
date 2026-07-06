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

// 主窗口允许导航的自家 origin 集合:内嵌 server(prod)+ dev server(dev 模式)。
export function selfOrigins(serverPort, devUrl) {
  const candidates = [`http://127.0.0.1:${serverPort}`];
  if (devUrl) candidates.push(devUrl);
  const origins = new Set();
  for (const c of candidates) {
    try { origins.add(new URL(c).origin); } catch { /* 无效候选跳过 */ }
  }
  return origins;
}

// url 是否属于主窗口自家 origin。非法 url 返回 false(不抛)。
export function isSelfOrigin(url, serverPort, devUrl) {
  try {
    return selfOrigins(serverPort, devUrl).has(new URL(url).origin);
  } catch {
    return false;
  }
}
