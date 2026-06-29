// Electron main process for nomad Desktop (ESM — package.json is type:module).
// Spawns the bundled nomad server as a child using Electron's node ABI
// (ELECTRON_RUN_AS_NODE) so native modules match, then loads the UI in a window.
import { app, BrowserWindow, ipcMain, safeStorage } from 'electron';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import net from 'node:net';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const APP_NAME = 'nomad';
const APP_ID = 'cc.nomad.desktop';

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

// ---- Cloud-account JWT (cc.brainmate.cc) persisted via safeStorage ----
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
  serverPort = await findFreePort();
  const serverPath = path.join(__dirname, '..', 'dist-server', 'server', 'cli.js');
  serverProc = spawn(process.execPath, [serverPath, 'start', '--port', String(serverPort)], {
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: '1',
      SERVER_PORT: String(serverPort),
    },
    cwd: path.join(__dirname, '..'),
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  serverProc.stdout.on('data', (d) => console.log(`[server] ${d.toString().trim()}`));
  serverProc.stderr.on('data', (d) => console.error(`[server] ${d.toString().trim()}`));
  serverProc.on('exit', (code) => console.log(`[server] exited code=${code}`));
  await waitForReady(serverPort);
  console.log(`[desktop] server ready on http://127.0.0.1:${serverPort}`);
}

function createWindow() {
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
