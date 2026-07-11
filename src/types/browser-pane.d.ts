// 声明渲染端 window.browserPane（preload.cjs contextBridge 暴露）。
// 仅桌面端 Electron 存在；Web/Android 访问为 undefined，调用方须守卫。

export interface BrowserPaneUrlChange {
  url: string;
  canGoBack: boolean;
  canGoForward: boolean;
}

export interface BrowserPaneApi {
  open: (url?: string) => Promise<void>;
  close: () => Promise<void>;
  navigate: (url: string) => Promise<boolean>;
  goBack: () => Promise<void>;
  goForward: () => Promise<void>;
  reload: () => Promise<void>;
  updateBounds: (bounds: { x: number; y: number; width: number; height: number }) => void;
  onUrlChange: (fn: (payload: BrowserPaneUrlChange) => void) => () => void;
  onTitleChange: (fn: (payload: { title: string }) => void) => () => void;
}

declare global {
  interface Window {
    browserPane?: BrowserPaneApi;
  }
}
