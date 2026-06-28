import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { cloudLogin as cloudLoginApi, cloudSignup as cloudSignupApi, cloudMe, type CloudUser } from '../../../utils/cloudApi';

// Production (Electron): safeStorage via preload bridge. Dev (browser): localStorage fallback.
const DEV_STORAGE_KEY = 'cloud-token';
const loadCloudToken = async (): Promise<string | null> => {
  if (window.cloudAuth) return window.cloudAuth.getToken();
  return localStorage.getItem(DEV_STORAGE_KEY);
};
const saveCloudToken = async (token: string): Promise<void> => {
  if (window.cloudAuth) await window.cloudAuth.setToken(token);
  else localStorage.setItem(DEV_STORAGE_KEY, token);
};
const clearCloudToken = async (): Promise<void> => {
  if (window.cloudAuth) await window.cloudAuth.removeToken();
  else localStorage.removeItem(DEV_STORAGE_KEY);
};

interface CloudAccountContextValue {
  user: CloudUser | null;
  token: string | null;
  loading: boolean;
  error: string | null;
  login: (email: string, password: string) => Promise<void>;
  signup: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
}

const CloudAccountContext = createContext<CloudAccountContextValue | null>(null);

export function useCloudAccount(): CloudAccountContextValue {
  const ctx = useContext(CloudAccountContext);
  if (!ctx) throw new Error('useCloudAccount must be used within <CloudAccountProvider>');
  return ctx;
}

export function CloudAccountProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<CloudUser | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // On mount: if we have a persisted cloud token, validate it via /me and hydrate the user.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const stored = await loadCloudToken();
        if (!stored) return;
        const me = await cloudMe(stored);
        if (cancelled) return;
        setToken(stored);
        setUser(me);
      } catch {
        // token invalid/expired — drop it so the user can sign in again.
        await clearCloudToken();
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    setError(null);
    try {
      const { token: tok, user: u } = await cloudLoginApi(email.trim(), password);
      await saveCloudToken(tok);
      setToken(tok);
      setUser(u);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'login failed');
      throw e;
    }
  }, []);

  const signup = useCallback(async (email: string, password: string) => {
    setError(null);
    try {
      const { token: tok, user: u } = await cloudSignupApi(email.trim(), password);
      await saveCloudToken(tok);
      setToken(tok);
      setUser(u);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'signup failed');
      throw e;
    }
  }, []);

  const logout = useCallback(async () => {
    await clearCloudToken();
    setToken(null);
    setUser(null);
    setError(null);
  }, []);

  return (
    <CloudAccountContext.Provider value={{ user, token, loading, error, login, signup, logout }}>
      {children}
    </CloudAccountContext.Provider>
  );
}
