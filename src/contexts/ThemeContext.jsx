import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';

import { parseStoredTheme, resolveEffectiveDark } from '../shared/theme/themeMode';

const ThemeContext = createContext();

export const useTheme = () => {
  const context = useContext(ThemeContext);
  if (!context) throw new Error('useTheme must be used within a ThemeProvider');
  return context;
};

const prefersDark = () =>
  typeof window !== 'undefined' && window.matchMedia
    ? window.matchMedia('(prefers-color-scheme: dark)').matches
    : false;

export const ThemeProvider = ({ children }) => {
  // 三态 themeMode：默认 system（跟随系统）；light/dark 强制固定。
  const [themeMode, setThemeModeState] = useState(() =>
    parseStoredTheme(typeof window !== 'undefined' ? localStorage.getItem('theme') : null),
  );
  // system 模式下跟踪系统亮暗；变化时 setSystemDark 触发重渲染，派生 isDarkMode 自动更新
  const [systemDark, setSystemDark] = useState(() => prefersDark());

  const isDarkMode = resolveEffectiveDark(themeMode, systemDark);

  // 写 document class + localStorage + theme-color meta + 桌面端 theme-cache
  useEffect(() => {
    if (isDarkMode) {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
    localStorage.setItem('theme', themeMode);

    const statusBarMeta = document.querySelector('meta[name="apple-mobile-web-app-status-bar-style"]');
    if (statusBarMeta) statusBarMeta.setAttribute('content', isDarkMode ? 'black-translucent' : 'default');

    const themeColorMeta = document.querySelector('meta[name="theme-color"]');
    if (themeColorMeta) themeColorMeta.setAttribute('content', isDarkMode ? '#0c1117' : '#ffffff');

    // 桌面端：同步主题到 main 进程缓存（消除下次启动闪屏）。Web/Android 下无该 API，忽略。
    if (typeof window !== 'undefined' && window.electronAPI?.themeCache?.set) {
      try { window.electronAPI.themeCache.set(isDarkMode); } catch { /* electronAPI unavailable on web/android */ }
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

  const setThemeMode = useCallback((mode) => setThemeModeState(mode), []);

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
