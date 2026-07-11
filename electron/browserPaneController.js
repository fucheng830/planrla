// BrowserPaneController:管理附加到 mainWindow 的单个 WebContentsView(浏览器面板)。
// 阶段 1:单视图、内存 partition、用户导航(不经 server / Claude)。
// ESM — package.json type:module;electron API 经 createRequire 拿(named import 在 ESM 拿不到)。
import { createRequire } from 'node:module';
import { isNavigableUrl, toPartitionName, clampBounds } from './browserPaneUtils.js';

const require = createRequire(import.meta.url);
const { WebContentsView } = require('electron');

const MIN_PLACEHOLDER = 100;

export class BrowserPaneController {
  constructor(mainWindow) {
    this.mainWindow = mainWindow;
    this.view = null;
    // 阶段 1 固定无 profile(内存 partition,关窗即清,与主窗口 cookie/localStorage 完全隔离)。
    this.partition = toPartitionName(null);
  }

  isOpen() {
    return this.view !== null;
  }

  open(initialUrl) {
    if (this.view) {
      // 已开;若给了合法 url 就导航过去
      if (initialUrl) this.navigate(initialUrl);
      return;
    }
    this.view = new WebContentsView({
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        partition: this.partition,
      },
    });
    this.mainWindow.contentView.addChildView(this.view);
    this._attachListeners();
    if (initialUrl && isNavigableUrl(initialUrl)) {
      this.view.webContents.loadURL(initialUrl);
    }
    // 初次 open 后,渲染端 ResizeObserver 会经 updateBounds 推来正确 bounds;
    // 在此之前先放一个占位 bounds(屏幕外),避免闪现在左上角。
    this.view.setBounds({ x: 0, y: 0, width: MIN_PLACEHOLDER, height: MIN_PLACEHOLDER });
  }

  close() {
    if (!this.view) return;
    this.mainWindow.contentView.removeChildView(this.view);
    const wc = this.view.webContents;
    this.view = null;
    try { wc.destroy(); } catch { /* already destroyed */ }
  }

  navigate(rawUrl) {
    if (!this.view || !isNavigableUrl(rawUrl)) return false;
    this.view.webContents.loadURL(rawUrl);
    return true;
  }

  goBack() {
    this.view?.webContents.navigationHistory.goBack();
  }

  goForward() {
    this.view?.webContents.navigationHistory.goForward();
  }

  reload() {
    this.view?.webContents.reload();
  }

  updateBounds(rawBounds) {
    if (!this.view) return;
    const content = this.mainWindow.getContentBounds();
    const bounds = clampBounds(rawBounds, { width: content.width, height: content.height });
    this.view.setBounds(bounds);
  }

  _attachListeners() {
    const wc = this.view.webContents;
    const send = (channel, payload) => {
      if (this.mainWindow.isDestroyed()) return;
      this.mainWindow.webContents.send(channel, payload);
    };
    const emitUrl = (url) => send('browserPane:url-change', {
      url,
      canGoBack: wc.navigationHistory.canGoBack(),
      canGoForward: wc.navigationHistory.canGoForward(),
    });
    wc.on('did-navigate', (_e, url) => emitUrl(url));
    wc.on('did-navigate-in-page', (_e, url) => emitUrl(url));
    wc.on('page-title-updated', (_e, title) => send('browserPane:title-change', { title }));
    // 阶段 1:外链在视图内的导航都是用户主动行为,允许(已在独立 partition 内)。
    // 不挂 setWindowOpenHandler —— 视图内 target=_blank 由 webContents 默认处理(view 内开)。
  }
}
