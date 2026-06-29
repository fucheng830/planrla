// Preload runs isolated (contextIsolation: true). Exposes a tiny safeStorage-backed
// bridge for the nomad cloud-account JWT (cc.brainmate.cc) so the renderer never
// touches the raw token in plaintext localStorage. CommonJS (.cjs) so Electron loads
// it regardless of the package "type": "module" setting.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('cloudAuth', {
  getToken: () => ipcRenderer.invoke('cloud-auth:get'),
  setToken: (token) => ipcRenderer.invoke('cloud-auth:set', token),
  removeToken: () => ipcRenderer.invoke('cloud-auth:remove'),
});
