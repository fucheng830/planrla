// Type declaration for the safeStorage bridge exposed by electron/preload.cjs.
// In production (Electron) window.cloudAuth is present; in browser dev mode (vite, no
// preload) it is undefined and the CloudAccountProvider falls back to localStorage.
export {};

declare global {
  interface Window {
    cloudAuth?: {
      getToken: () => Promise<string | null>;
      setToken: (token: string) => Promise<void>;
      removeToken: () => Promise<void>;
    };
  }
}
