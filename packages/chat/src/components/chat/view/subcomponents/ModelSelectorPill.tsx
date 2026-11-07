import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, ChevronDown } from 'lucide-react';

import SessionProviderLogo from '../../../llm-logo-provider/SessionProviderLogo';
import type { LLMProvider, ProviderModelsDefinition } from '../../../../types/app';

const PROVIDER_NAMES: Record<LLMProvider, string> = {
  claude: 'Claude',
  cursor: 'Cursor',
  codex: 'Codex',
  gemini: 'Gemini',
  opencode: 'OpenCode',
  kimi: 'Kimi',
  zcode: 'ZCode',
};

type ModelSelectorPillProps = {
  provider: LLMProvider;
  currentModel: string;
  catalog: Partial<Record<LLMProvider, ProviderModelsDefinition>>;
  onSelect: (provider: LLMProvider, model: string) => void;
};

/** Codex 输入器右下角模型选择胶囊:当前 provider·model,点开浮层直选。 */
export default function ModelSelectorPill({ provider, currentModel, catalog, onSelect }: ModelSelectorPillProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const [panelStyle, setPanelStyle] = useState<{ bottom: number; left: number } | null>(null);

  const toggleOpen = () => {
    if (!open && rootRef.current) {
      const rect = rootRef.current.getBoundingClientRect();
      // fixed 定位绕开输入器 overflow:hidden 的裁剪;面板底边贴按钮上方 8px
      setPanelStyle({ bottom: window.innerHeight - rect.top + 8, left: rect.right - 288 });
    }
    setOpen((v) => !v);
  };

  useEffect(() => {
    if (!open) return;
    const onDocClick = (event: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [open]);

  const options = useMemo(() => catalog[provider]?.OPTIONS ?? [], [catalog, provider]);
  const currentLabel = useMemo(
    () => options.find((o) => o.value === currentModel)?.label || currentModel,
    [options, currentModel],
  );

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={toggleOpen}
        className="flex h-7 items-center gap-1.5 rounded-full px-2.5 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        title="选择模型"
      >
        <SessionProviderLogo provider={provider} className="h-3.5 w-3.5 shrink-0" />
        <span className="max-w-[140px] truncate font-medium">{PROVIDER_NAMES[provider] ?? provider}</span>
        <span className="max-w-[160px] truncate text-muted-foreground/70">{currentLabel}</span>
        <ChevronDown className="h-3 w-3 shrink-0 opacity-60" />
      </button>

      {open && (
        <div
          className="fixed z-[60] w-72 overflow-hidden rounded-xl border border-border bg-popover shadow-[0_8px_32px_hsl(0_0%_0%/0.14)]"
          style={panelStyle ? { bottom: panelStyle.bottom, left: Math.max(8, panelStyle.left) } : undefined}
        >
          <div className="border-b border-border/60 bg-muted/30 px-3 py-2 text-xs font-semibold text-foreground">
            {PROVIDER_NAMES[provider] ?? provider} 模型
          </div>
          <div className="max-h-72 overflow-y-auto py-1">
            {options.length === 0 ? (
              <div className="px-3 py-2 text-xs text-muted-foreground">暂无可用模型</div>
            ) : (
              options.map((o) => {
                const isSelected = o.value === currentModel;
                return (
                  <button
                    key={o.value}
                    type="button"
                    onClick={() => { onSelect(provider, o.value); setOpen(false); }}
                    className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs transition-colors hover:bg-muted"
                  >
                    <span className="min-w-0 flex-1 truncate text-foreground">{o.label}</span>
                    {isSelected && <Check className="h-3.5 w-3.5 shrink-0 text-primary" />}
                  </button>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}
