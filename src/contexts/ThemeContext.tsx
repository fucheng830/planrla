import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { parseStoredTheme, resolveEffectiveDark } from '../shared/theme/themeMode';
import type { ThemeMode } from '../shared/theme/themeMode';

const ThemeContext = createContext<{
  themeMode: ThemeMode;
  setThemeMode: (mode: ThemeMode) => void;
  isDarkMode: boolean;
  toggleDarkMode: () => void;
} | null>(null);

export const useTheme = () => {
  const context = useContext(ThemeContext);
  if (!context) throw new Error('useTheme must be used within a ThemeProvider');
  return context;
};

const prefersDark = () =>
  typeof window !== 'undefined' && window.matchMedia
    ? window.matchMedia('(prefers-color-scheme: dark)').matches
    : false;

export const ThemeProvider = ({ children }: { children: React.ReactNode }) => {
  const [themeMode, setThemeModeState] = useState<ThemeMode>(() =>
    parseStoredTheme(typeof window !== 'undefined' ? localStorage.getItem('theme') : null),
  );
  // system 模式下跟踪系统亮暗；变化时 setSystemDark 触发重渲染，派生 isDarkMode 自动更新
  const [systemDark, setSystemDark] = useState(() => prefersDark());

  const isDarkMode = resolveEffectiveDark(themeMode, systemDark);

  // 写 document class + localStorage + theme-color meta + 桌面端 theme-cache（C1 提供 API）
  useEffect(() => {
    document.documentElement.classList.toggle('dark', isDarkMode);
    localStorage.setItem('theme', themeMode);

    const statusBarMeta = document.querySelector('meta[name="apple-mobile-web-app-status-bar-style"]');
    if (statusBarMeta) statusBarMeta.setAttribute('content', isDarkMode ? 'black-translucent' : 'default');

    const themeColorMeta = document.querySelector('meta[name="theme-color"]');
    if (themeColorMeta) themeColorMeta.setAttribute('content', isDarkMode ? '#0c1117' : '#ffffff');

    const electronAPI = typeof window !== 'undefined' ? window.electronAPI : null;
    if (electronAPI?.themeCache?.set) {
      try {
        electronAPI.themeCache.set(isDarkMode);
      } catch {
        // themeCache IPC 不可用（如非桌面端或 C1 未实现）——静默降级
      }
    }
  }, [themeMode, isDarkMode]);

  // system 模式下始终监听系统亮暗（修复旧逻辑"toggle 一次就锁死不再跟系统"）
  useEffect(() => {
    if (themeMode !== 'system' || typeof window === 'undefined' || !window.matchMedia) return;
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    const handler = () => setSystemDark(mediaQuery.matches);
    mediaQuery.addEventListener('change', handler);
    return () => mediaQuery.removeEventListener('change', handler);
  }, [themeMode]);

  const setThemeMode = useCallback((mode: ThemeMode) => setThemeModeState(mode), []);

  // 向后兼容旧调用方（DarkModeToggle 仍用 isDarkMode + toggleDarkMode）
  const toggleDarkMode = useCallback(() => {
    setThemeModeState((prev) => {
      const effective = resolveEffectiveDark(prev, prefersDark());
      return effective ? 'light' : 'dark';
    });
  }, []);

  return (
    <ThemeContext.Provider value={{ themeMode, setThemeMode, isDarkMode, toggleDarkMode }}>
      {children}
    </ThemeContext.Provider>
  );
};
