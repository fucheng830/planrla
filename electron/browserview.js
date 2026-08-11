// Electron main: embedded browser panel via WebContentsView (the Electron 30+
// replacement for the deprecated BrowserView). The renderer drives it through
// IPC — create/loadURL/setBounds/goBack/goForward/reload/hide/show/destroy.
// Navigation events (did-navigate) are pushed back to update the address bar.
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { WebContentsView, BrowserView, shell } = require('electron');

let view = null;
let initialized = false;

/**
 * @param {import('electron').BrowserWindow} mainWindow
 * @param {import('electron').IpcMain} ipcMain
 */
export function initBrowserView(mainWindow, ipcMain) {
  if (initialized) return;
  initialized = true;

  // ---- create: spin up a WebContentsView and attach it to the main window ----
  ipcMain.handle('browserview:create', async (_event, bounds) => {
    console.log('[browserview] create called, bounds:', JSON.stringify(bounds));
    if (view) {
      applyBounds(bounds);
      return true;
    }

    const viewOpts = {
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    };

    // Prefer WebContentsView (Electron 30+); fall back to BrowserView for
    // older builds.
    if (typeof WebContentsView !== 'undefined') {
      console.log('[browserview] using WebContentsView');
      view = new WebContentsView(viewOpts);
      mainWindow.contentView.addChildView(view);
    } else if (typeof BrowserView !== 'undefined') {
      console.log('[browserview] using BrowserView (fallback)');
      view = new BrowserView(viewOpts);
      mainWindow.addBrowserView(view);
    } else {
      console.error('[browserview] neither WebContentsView nor BrowserView available');
      return false;
    }
    applyBounds(bounds);

    // External links open in the system browser, never a new Electron window.
    view.webContents.setWindowOpenHandler(({ url }) => {
      shell.openExternal(url);
      return { action: 'deny' };
    });

    // Push navigation changes back to the renderer so the address bar updates.
    const pushNav = () => {
      if (!mainWindow.isDestroyed()) {
        mainWindow.webContents.send('browserview:nav-change', {
          url: view?.webContents.getURL() ?? '',
          canGoBack: view?.webContents.navigationHistory?.canGoBack() ?? false,
          canGoForward: view?.webContents.navigationHistory?.canGoForward() ?? false,
        });
      }
    };
    view.webContents.on('did-navigate', pushNav);
    view.webContents.on('did-navigate-in-page', pushNav);
    view.webContents.on('did-finish-load', pushNav);

    return true;
  });

  // ---- load-url ----
  ipcMain.handle('browserview:load-url', async (_event, url) => {
    console.log('[browserview] load-url:', url);
    if (!view) { console.log('[browserview] load-url: no view!'); return false; }
    let normalized = (url || '').trim();
    if (!normalized) return false;
    // Auto-add https:// if the user typed a bare domain.
    if (!/^https?:\/\//i.test(normalized)) {
      // Looks like a domain (has a dot, no spaces)? Prefix https://.
      if (/^[\w-]+(\.[\w-]+)+/.test(normalized)) {
        normalized = `https://${normalized}`;
      } else {
        // Treat as a search query → Baidu.
        normalized = `https://www.baidu.com/s?wd=${encodeURIComponent(normalized)}`;
      }
    }
    view.webContents.loadURL(normalized);
    return true;
  });

  // ---- set-bounds (renderer pushes screen-relative bounds) ----
  ipcMain.on('browserview:set-bounds', (_event, bounds) => {
    applyBounds(bounds);
  });

  // ---- navigation controls ----
  ipcMain.on('browserview:go-back', () => {
    if (view && view.webContents.navigationHistory?.canGoBack()) {
      view.webContents.navigationHistory.goBack();
    }
  });
  ipcMain.on('browserview:go-forward', () => {
    if (view && view.webContents.navigationHistory?.canGoForward()) {
      view.webContents.navigationHistory.goForward();
    }
  });
  ipcMain.on('browserview:reload', () => {
    view?.webContents.reload();
  });

  // ---- hide / show (tab switch, panel collapse) ----
  ipcMain.on('browserview:hide', () => {
    if (view) {
      if (typeof view.setVisible === 'function') {
        view.setVisible(false);
      } else if (typeof view.setBackgroundColor === 'function') {
        // BrowserView fallback: move off-screen
        view.setBounds({ x: -9999, y: -9999, width: 0, height: 0 });
      }
    }
  });
  ipcMain.on('browserview:show', (_event, bounds) => {
    if (view) {
      applyBounds(bounds);
      if (typeof view.setVisible === 'function') {
        view.setVisible(true);
      }
    }
  });

  // ---- destroy (tab close / panel close) ----
  ipcMain.on('browserview:destroy', () => {
    if (view) {
      if (typeof WebContentsView !== 'undefined' && view instanceof WebContentsView) {
        mainWindow.contentView.removeChildView(view);
      } else {
        mainWindow.removeBrowserView(view);
      }
      view = null;
    }
  });

  // ---- helpers ----
  function applyBounds(viewportBounds) {
    if (!view || !viewportBounds) return;
    // The renderer sends CSS-pixel viewport coordinates from
    // getBoundingClientRect — these are relative to the browser viewport
    // (the same origin WebContentsView uses for setBounds). Direct passthrough.
    const b = {
      x: Math.round(viewportBounds.x),
      y: Math.round(viewportBounds.y),
      width: Math.max(1, Math.round(viewportBounds.width)),
      height: Math.max(1, Math.round(viewportBounds.height)),
    };
    view.setBounds(b);
  }
}

/** Destroy the view if it exists (called on window close). */
export function destroyBrowserView() {
  if (view) {
    view.setVisible(false);
    view = null;
  }
}
