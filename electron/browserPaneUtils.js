// 浏览器面板纯逻辑(零 electron 依赖,便于 node --test 单测)。
// 集成层(WebContentsView / setBounds)在 browserPaneController.js。

const NAVIGABLE_PROTOCOLS = new Set(['http:', 'https:']);

// 仅放行 http/https(浏览器视图导航入口)。mailto/tel/file/javascript 等不在此视图打开。
export function isNavigableUrl(rawUrl) {
  try {
    return NAVIGABLE_PROTOCOLS.has(new URL(rawUrl).protocol);
  } catch {
    return false;
  }
}

// profile → Electron session partition 名。无 profile 用内存 partition(关窗即清,不持久化)。
export function toPartitionName(profileName) {
  const safe = String(profileName || '')
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
  return safe ? `persist:planrla-browser-${safe}` : 'planrla-browser';
}

// 钳制 bounds 在合理范围(非负、最小尺寸、不超容器),避免 WebContentsView.setBounds 抛错或越界。
const MIN_WIDTH = 100;
const MIN_HEIGHT = 100;

export function clampBounds(bounds, max) {
  const maxWidth = Math.max(MIN_WIDTH, max?.width ?? MIN_WIDTH);
  const maxHeight = Math.max(MIN_HEIGHT, max?.height ?? MIN_HEIGHT);
  const x = Math.max(0, Math.round(bounds?.x ?? 0));
  const y = Math.max(0, Math.round(bounds?.y ?? 0));
  const width = Math.min(maxWidth, Math.max(MIN_WIDTH, Math.round(bounds?.width ?? MIN_WIDTH)));
  const height = Math.min(maxHeight, Math.max(MIN_HEIGHT, Math.round(bounds?.height ?? MIN_HEIGHT)));
  return { x, y, width, height };
}
