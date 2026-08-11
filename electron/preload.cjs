// Preload runs isolated (contextIsolation: true). Exposes a tiny safeStorage-backed
// bridge for the Planrla cloud-account JWT (api.planrla.com) so the renderer never
// touches the raw token in plaintext localStorage. CommonJS (.cjs) so Electron loads
// it regardless of the package "type": "module" setting.
const { contextBridge, ipcRenderer } = require('electron');

// Backward-compatible top-level exposure (existing renderer code uses window.cloudAuth).
contextBridge.exposeInMainWorld('cloudAuth', {
  getToken: () => ipcRenderer.invoke('cloud-auth:get'),
  setToken: (token) => ipcRenderer.invoke('cloud-auth:set', token),
  removeToken: () => ipcRenderer.invoke('cloud-auth:remove'),
});

// Aggregated electronAPI surface for new chrome code (theme cache, platform).
// cloudAuth is NOT mirrored here — the top-level window.cloudAuth expose above
// is the single source of truth (consumed by CloudAccountContext.tsx).
contextBridge.exposeInMainWorld('electronAPI', {
  themeCache: {
    // main 进程经 ipc 同步写 theme-cache.json（renderer 无法直接写 userData）
    set: (effectiveDark) => ipcRenderer.send('theme-cache:set', effectiveDark),
  },
  platform: process.platform,
  // REQ-051 session context menu: open a path in the OS file explorer.
  openPath: (targetPath) => ipcRenderer.invoke('shell:open-path', targetPath),
});

// Auto-updater bridge (REQ-011). Renderer useAutoUpdater hook reads state via
// onState push; check/download/quitInstall are fire-and-forget invoke.
contextBridge.exposeInMainWorld('updater', {
  check: () => ipcRenderer.invoke('updater:check'),
  download: () => ipcRenderer.invoke('updater:download'),
  quitInstall: () => ipcRenderer.invoke('updater:quit-install'),
  onState: (fn) => {
    const handler = (_e, payload) => fn(payload);
    ipcRenderer.on('updater:state', handler);
    return () => ipcRenderer.removeListener('updater:state', handler);
  },
});

// System notification bridge (REQ-042). Renderer fires show-notification;
// main 进程回调（点击/动作）经 notification-callback 推回 renderer。
contextBridge.exposeInMainWorld('systemNotify', {
  show: (opts) => ipcRenderer.send('show-notification', opts),
  onNotificationCallback: (cb) => {
    const handler = (_event, data) => cb(data);
    ipcRenderer.on('notification-callback', handler);
    return () => ipcRenderer.removeListener('notification-callback', handler);
  },
});

// Embedded browser panel bridge (WebContentsView). The renderer creates the
// view, loads URLs, pushes bounds (screen-relative → main converts), and
// receives navigation updates to sync the address bar.
contextBridge.exposeInMainWorld('browserView', {
  create: (bounds) => ipcRenderer.invoke('browserview:create', bounds),
  loadURL: (url) => ipcRenderer.invoke('browserview:load-url', url),
  setBounds: (bounds) => ipcRenderer.send('browserview:set-bounds', bounds),
  goBack: () => ipcRenderer.send('browserview:go-back'),
  goForward: () => ipcRenderer.send('browserview:go-forward'),
  reload: () => ipcRenderer.send('browserview:reload'),
  hide: () => ipcRenderer.send('browserview:hide'),
  show: (bounds) => ipcRenderer.send('browserview:show', bounds),
  destroy: () => ipcRenderer.send('browserview:destroy'),
  onNavChange: (cb) => {
    const handler = (_event, data) => cb(data);
    ipcRenderer.on('browserview:nav-change', handler);
    return () => ipcRenderer.removeListener('browserview:nav-change', handler);
  },
});
