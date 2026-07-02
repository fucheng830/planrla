import { Monitor, Moon, Sun } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { useTheme } from '../../../contexts/ThemeContext';
import type { ThemeMode } from '../../../shared/theme/themeMode';
import { cn } from '../../../lib/utils';

const OPTIONS: Array<{ value: ThemeMode; icon: typeof Monitor; labelKey: string }> = [
  { value: 'system', icon: Monitor, labelKey: 'appearanceSettings.themeMode.system' },
  { value: 'light', icon: Sun, labelKey: 'appearanceSettings.themeMode.light' },
  { value: 'dark', icon: Moon, labelKey: 'appearanceSettings.themeMode.dark' },
];

export default function ThemeModeSelector({ ariaLabel }: { ariaLabel?: string }) {
  const { themeMode, setThemeMode } = useTheme();
  const { t } = useTranslation('settings');

  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel ?? t('appearanceSettings.themeMode.label')}
      className="inline-flex items-center gap-1 rounded-lg border border-input bg-card p-1"
    >
      {OPTIONS.map(({ value, icon: Icon, labelKey }) => {
        const active = themeMode === value;
        return (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => setThemeMode(value)}
            className={cn(
              'flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
              active
                ? 'bg-primary text-primary-foreground'
                : 'text-muted-foreground hover:bg-accent hover:text-foreground',
            )}
          >
            <Icon className="h-3.5 w-3.5" />
            <span>{t(labelKey)}</span>
          </button>
        );
      })}
    </div>
  );
}
