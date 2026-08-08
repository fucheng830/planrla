// Electron main process for Planrla Desktop (ESM — package.json is type:module).
// Spawns the bundled Planrla server as a child using Electron's node ABI
// (ELECTRON_RUN_AS_NODE) so native modules match, then loads the UI in a window.
// electron 是 CJS(npm 包 index.js 只 export exe 路径;运行时 require('electron') 才被
// electron 拦截返回 API)。ESM named import 拿不到 API —— 用 createRequire 走 CJS require。
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { app, BrowserWindow, Menu, ipcMain, safeStorage, shell, Notification, nativeTheme } = require('electron');
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import net from 'node:net';
import { fileURLToPath } from 'node:url';
import { readThemeCache, writeThemeCache } from './themeCache.cjs';
import { initAutoUpdater } from './updater.js';
import { isAllowedUrl, isSelfOrigin } from './links.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const APP_NAME = 'Planrla';
const APP_ID = 'cc.planrla.desktop';

let mainWindow = null;
let serverProc = null;
let serverPort = 0;

app.setName(APP_NAME);
if (process.platform === 'win32') {
  app.setAppUserModelId(APP_ID);
}

function resolveAppIcon() {
  const iconPath = path.join(__dirname, '..', 'public', 'logo-512.png');
  return fs.existsSync(iconPath) ? iconPath : undefined;
}

// ---- Cloud-account JWT (api.planrla.com) persisted via safeStorage ----
// Renderer calls window.cloudAuth.{getToken,setToken,removeToken} (see preload.cjs);
// these handlers encrypt the token with the OS keychain and store the blob in userData,
// so the cloud JWT never sits in plaintext localStorage like the local app token does.
const cloudTokenFile = () => path.join(app.getPath('userData'), 'cloud-token.bin');

function readCloudToken() {
  try {
    if (!fs.existsSync(cloudTokenFile())) return null;
    if (!safeStorage.isEncryptionAvailable()) return null;
    return safeStorage.decryptString(fs.readFileSync(cloudTokenFile()));
  } catch { return null; }
}
function writeCloudToken(token) {
  if (!safeStorage.isEncryptionAvailable()) throw new Error('safeStorage unavailable on this platform');
  fs.writeFileSync(cloudTokenFile(), safeStorage.encryptString(token));
}
function deleteCloudToken() {
  try { fs.unlinkSync(cloudTokenFile()); } catch {}
}

ipcMain.handle('cloud-auth:get', () => readCloudToken());
ipcMain.handle('cloud-auth:set', (_e, token) => { writeCloudToken(token); });
ipcMain.handle('cloud-auth:remove', () => deleteCloudToken());

// Renderer 主题变化时同步缓存，供下次启动选背景色（见 createWindow）
ipcMain.on('theme-cache:set', (_e, effectiveDark) => {
  if (typeof effectiveDark === 'boolean') writeThemeCache(app.getPath('userData'), effectiveDark);
});

// ---- 系统通知（REQ-042）----
// Renderer 经 window.api?.notify?.show(...) → preload → ipcMain 'show-notification'。
// permission 类型带 hasReply（行内输入批准理由）+ 批准/拒绝按钮；其它类型纯展示。
// 用户互动（reply/action/click）回推 'notification-callback' 给渲染层处理。
ipcMain.on('show-notification', (_event, { type, title, body, sessionId, requestId } = {}) => {
  if (!Notification.isSupported()) return;
  const isPermission = type === 'permission';
  const n = new Notification({
    title: title || APP_NAME,
    body: body || '',
    icon: resolveAppIcon(),
    hasReply: isPermission,
    replyPlaceholder: '回复(可选)...',
    actions: isPermission
      ? [{ type: 'button', text: '批准' }, { type: 'button', text: '拒绝' }]
      : [],
  });
  n.on('reply', (_e, reply) => {
    mainWindow?.webContents.send('notification-callback', { type: 'reply', reply, requestId, sessionId });
  });
  n.on('action', (_e, index) => {
    mainWindow?.webContents.send('notification-callback', {
      type: 'action',
      action: index === 0 ? 'allow' : 'deny',
      requestId,
      sessionId,
    });
  });
  n.on('click', () => {
    mainWindow?.show();
    mainWindow?.focus();
    mainWindow?.webContents.send('notification-callback', { type: 'click', sessionId });
  });
  n.show();
});

// REQ-051 session context menu: open a path in the OS file explorer.
// shell.openPath opens the folder in Explorer/Finder; returns '' on success.
ipcMain.handle('shell:open-path', async (_e, targetPath) => {
  if (typeof targetPath !== 'string' || !targetPath.trim()) {
    console.error('[shell:open-path] invalid path:', targetPath);
    return '';
  }
  try {
    const errorMsg = await shell.openPath(targetPath);
    if (errorMsg) {
      console.error(`[shell:open-path] failed for "${targetPath}": ${errorMsg}`);
    }
    return errorMsg;
  } catch (err) {
    console.error(`[shell:open-path] exception for "${targetPath}":`, err);
    return String(err?.message || err);
  }
});

function findFreePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const p = srv.address().port;
      srv.close(() => resolve(p));
    });
  });
}

function waitForReady(port, timeoutMs = 30000) {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const check = () => {
      const req = http.get(`http://127.0.0.1:${port}/`, (res) => {
        if (res.statusCode === 200 || res.statusCode === 304) resolve();
        else if (Date.now() - start > timeoutMs) reject(new Error('server ready timeout'));
        else setTimeout(check, 300);
      });
      req.on('error', () => {
        if (Date.now() - start > timeoutMs) reject(new Error('server ready timeout'));
        else setTimeout(check, 300);
      });
    };
    check();
  });
}

async function startServer() {
  // 固定端口，按环境区分：开发版(npm run desktop)用 3001、打包安装版用 3002，
  // 开发与正式版可同时运行互不冲突，手机也能按端口区分连哪个。
  // SERVER_PORT env 可强制覆盖；不再用 findFreePort() 随机端口。
  const defaultPort = app.isPackaged ? 3002 : 3001;
  serverPort = Number(process.env.SERVER_PORT) || defaultPort;
  const serverPath = path.join(__dirname, '..', 'dist-server', 'server', 'cli.js');
  // Spawn cwd MUST be a real filesystem directory. When the app runs from
  // app.asar, `path.join(__dirname, '..')` resolves to `.../app.asar`, which is
  // a file, not a directory — Windows CreateProcess fails to use it as a cwd,
  // the child never starts, and (without an 'error' handler) we'd silently hit
  // waitForReady's 30s timeout. process.resourcesPath is always a real dir.
  serverProc = spawn(process.execPath, [serverPath, 'start', '--port', String(serverPort)], {
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: '1',
      SERVER_PORT: String(serverPort),
      PLANRLA_PACKAGED: app.isPackaged ? '1' : '0',
    },
    cwd: process.resourcesPath,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  serverProc.on('error', (e) => console.error('[server] spawn error:', e?.message || e));
  serverProc.stdout.on('data', (d) => console.log(`[server] ${d.toString().trim()}`));
  serverProc.stderr.on('data', (d) => console.error(`[server] ${d.toString().trim()}`));
  serverProc.on('exit', (code) => console.log(`[server] exited code=${code}`));
  await waitForReady(serverPort);
  console.log(`[desktop] server ready on http://127.0.0.1:${serverPort}`);
}

function createWindow() {
  // Drop the default menu bar (File/Edit/View/Window/Help) for a cleaner chrome.
  Menu.setApplicationMenu(null);

  // 启动期主题色（消除闪屏）：优先读上次 effectiveDark 缓存；无缓存时跟随系统主题，
  // 与渲染端 ThemeContext 的 themeMode='system' 默认值对齐，避免外壳暗色而内页亮色
  // 造成窗口四周出现深色"黑边"。
  const cache = readThemeCache(app.getPath('userData'));
  const effectiveDark = cache ? cache.effectiveDark : nativeTheme.shouldUseDarkColors;
  const titlebarBg = effectiveDark ? '#0b1120' : '#ffffff';
  const symbolColor = effectiveDark ? '#e5e7eb' : '#374151';
  const titleBarStyle = process.platform === 'darwin' ? 'hiddenInset' : 'hidden';

  mainWindow = new BrowserWindow({
    title: APP_NAME,
    width: 1280,
    height: 840,
    icon: resolveAppIcon(),
    backgroundColor: titlebarBg,
    titleBarStyle,
    // Win/Linux: 系统绘制 minimize/maximize/close 按钮，颜色/高度可控（Electron 15+，38 完整支持）
    titleBarOverlay: process.platform !== 'darwin'
      ? { color: titlebarBg, symbolColor, height: 40 }
      : undefined,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, 'preload.cjs'),
    },
  });
  const devUrl = process.env.ELECTRON_DEV_URL;
  if (devUrl) {
    mainWindow.loadURL(devUrl);
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  } else {
    mainWindow.loadURL(`http://127.0.0.1:${serverPort}/`);
  }
  // 永不让 Electron 自己开新窗口:外链一律转系统浏览器(REQ-023)。
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (isAllowedUrl(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  // 防主窗口被普通 <a href="外链"> 劫持跳走:自家 origin 外的导航阻止 + 转浏览器。
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (!isSelfOrigin(url, serverPort, process.env.ELECTRON_DEV_URL)) {
      event.preventDefault();
      if (isAllowedUrl(url)) shell.openExternal(url);
    }
  });
  mainWindow.on('closed', () => { mainWindow = null; });
}

app.whenReady().then(async () => {
  try {
    if (!process.env.ELECTRON_DEV_URL) await startServer();
    createWindow();
    if (!process.env.ELECTRON_DEV_URL) initAutoUpdater(mainWindow, ipcMain);
  } catch (e) {
    console.error('[desktop] failed to start:', e);
    app.quit();
  }
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  if (serverProc) {
    try { serverProc.kill(); } catch {}
    serverProc = null;
  }
});
