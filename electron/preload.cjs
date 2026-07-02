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
});
