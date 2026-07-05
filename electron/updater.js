// Electron main: electron-updater 封装。事件 → IPC push 'updater:state';
// IPC handlers: updater:check / :download / :quit-install。
// electron-updater 是 CommonJS,用 createRequire 拿 autoUpdater。ipcMain 不在这里
// require(会触发 electron 的 CJS 加载,破坏入口 main.js 的 ESM named import)——
// 改由 initAutoUpdater(mainWindow, ipcMain) 从 main.js 入口传入(入口 named import 工作)。
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { autoUpdater } = require('electron-updater');

const FEED_URL = process.env.PLANRLA_UPDATE_URL || 'https://updates.planrla.com/desktop';

let initialized = false;

export function initAutoUpdater(mainWindow, ipcMain) {
  if (initialized) return;
  initialized = true;

  autoUpdater.autoDownload = false;
  autoUpdater.setFeedURL({ provider: 'generic', url: FEED_URL });
  autoUpdater.logger = console;

  const send = (state) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('updater:state', state);
    }
  };

  autoUpdater.on('checking-for-update', () => send({ state: 'checking' }));
  autoUpdater.on('update-available', (info) => send({
    state: 'available',
    version: info.version,
    releaseNotesUrl: `https://github.com/fucheng830/planrla/releases/tag/v${info.version}`,
  }));
  autoUpdater.on('update-not-available', () => send({ state: 'not-available' }));
  autoUpdater.on('download-progress', (p) => send({ state: 'downloading', percent: Math.round(p.percent) }));
  autoUpdater.on('update-downloaded', () => send({ state: 'downloaded' }));
  autoUpdater.on('error', (err) => send({ state: 'error', message: err?.message || String(err) }));

  ipcMain.handle('updater:check', async () => {
    try { await autoUpdater.checkForUpdates(); } catch { /* error 事件已 send */ }
  });
  ipcMain.handle('updater:download', async () => {
    try { await autoUpdater.downloadUpdate(); } catch { /* error 事件已 send */ }
  });
  ipcMain.handle('updater:quit-install', () => autoUpdater.quitAndInstall());

  // 启动 silent 检测(失败不阻塞)
  autoUpdater.checkForUpdates().catch(() => {});
}
