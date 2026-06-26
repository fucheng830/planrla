// Electron main process for CloudCLI Desktop (ESM — package.json is type:module).
// Spawns the bundled CloudCLI server as a child using Electron's node ABI
// (ELECTRON_RUN_AS_NODE) so native modules match, then loads the UI in a window.
import { app, BrowserWindow } from 'electron';
import { spawn } from 'node:child_process';
import path from 'node:path';
import http from 'node:http';
import net from 'node:net';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let mainWindow = null;
let serverProc = null;
let serverPort = 0;

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
  // Spawn the server with system node (native modules were built for system node ABI;
  // electron-rebuild is deferred to packaging — see plan M5).
  serverProc = spawn('node', [serverPath, 'start', '--port', String(serverPort)], {
    env: { ...process.env, SERVER_PORT: String(serverPort) },
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
    width: 1280,
    height: 840,
    backgroundColor: '#0b1120',
    webPreferences: { contextIsolation: true, nodeIntegration: false },
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
