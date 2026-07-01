// Electron main process for Planrla Desktop (ESM — package.json is type:module).
// Spawns the bundled Planrla server as a child using Electron's node ABI
// (ELECTRON_RUN_AS_NODE) so native modules match, then loads the UI in a window.
import { app, BrowserWindow, Menu, ipcMain, safeStorage } from 'electron';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import net from 'node:net';
import { fileURLToPath } from 'node:url';

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

async function setupAutoUpdater() {
  if (process.env.ELECTRON_DEV_URL) return;

  try {
    const updaterMod = await import('electron-updater');
    // CJS package re-exported via dynamic import: autoUpdater may live on the
    // namespace or under .default depending on the bundler/ESM interop layer.
    const autoUpdater = updaterMod.autoUpdater || updaterMod.default?.autoUpdater;
    if (!autoUpdater) throw new Error('electron-updater did not export autoUpdater');
    const updateFeedUrl = process.env.PLANRLA_UPDATE_URL;

    autoUpdater.autoDownload = false;
    if (updateFeedUrl) {
      autoUpdater.setFeedURL({ provider: 'generic', url: updateFeedUrl });
    }

    autoUpdater.on('error', (error) => console.error('[desktop:update] error:', error?.message || error));
    autoUpdater.on('update-available', (info) => console.log('[desktop:update] available:', info.version));
    autoUpdater.on('update-not-available', (info) => console.log('[desktop:update] current:', info.version));

    await autoUpdater.checkForUpdates();
  } catch (error) {
    console.error('[desktop:update] failed to initialize:', error?.message || error);
  }
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
  mainWindow = new BrowserWindow({
    title: APP_NAME,
    width: 1280,
    height: 840,
    icon: resolveAppIcon(),
    backgroundColor: '#0b1120',
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
  mainWindow.on('closed', () => { mainWindow = null; });
}

app.whenReady().then(async () => {
  try {
    if (!process.env.ELECTRON_DEV_URL) await startServer();
    createWindow();
    await setupAutoUpdater();
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
