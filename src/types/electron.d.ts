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
  }
}
