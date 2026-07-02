export type ThemeMode = 'system' | 'light' | 'dark';

export const DEFAULT_THEME_MODE: ThemeMode = 'system';

const VALID_MODES: ReadonlySet<ThemeMode> = new Set(['system', 'light', 'dark']);

/**
 * 解析 localStorage 存的 theme 值。旧值 'dark'/'light' 直接兼容；
 * null/空/非法值回落到默认 'system'。大小写敏感。
 */
export function parseStoredTheme(raw: string | null | undefined): ThemeMode {
  if (raw && VALID_MODES.has(raw as ThemeMode)) return raw as ThemeMode;
  return DEFAULT_THEME_MODE;
}

/**
 * 由 themeMode + 系统偏好派生实际的亮暗。system 跟随系统；light/dark 固定。
 */
export function resolveEffectiveDark(mode: ThemeMode, prefersDark: boolean): boolean {
  if (mode === 'system') return prefersDark;
  return mode === 'dark';
}
