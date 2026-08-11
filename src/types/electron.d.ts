// Type declaration for the Electron renderer bridge exposed by electron/preload.cjs.
// `window.electronAPI` is the aggregated surface (theme cache, platform);
// `window.cloudAuth` is exposed separately for backward compatibility (see
// src/components/cloud-account/cloud-auth.d.ts).
export {};

declare global {
  interface Window {
    electronAPI?: {
      themeCache?: {
        set: (effectiveDark: boolean) => void;
      };
      platform?: NodeJS.Platform;
      openPath?: (targetPath: string) => Promise<string>;
    };
    browserView?: {
      create: (bounds: { x: number; y: number; width: number; height: number }) => Promise<boolean>;
      loadURL: (url: string) => Promise<boolean>;
      setBounds: (bounds: { x: number; y: number; width: number; height: number }) => void;
      goBack: () => void;
      goForward: () => void;
      reload: () => void;
      hide: () => void;
      show: (bounds: { x: number; y: number; width: number; height: number }) => void;
      destroy: () => void;
      onNavChange: (cb: (data: { url: string; canGoBack: boolean; canGoForward: boolean }) => void) => () => void;
    };
  }
}
