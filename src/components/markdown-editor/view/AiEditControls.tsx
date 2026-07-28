// src/components/markdown-editor/view/AiEditControls.tsx
//
// REQ-047 — AI 选段改的 UI 控件。
// 三态:idle(显示"AI 改"按钮,选段时启用)/ awaitingInstruction(指令输入框)/
// running(取消 + 加载提示)/ success(接受/拒绝 + diff 提示)/ error(错误提示)。

import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, Loader2, Sparkles, X } from 'lucide-react';

import { Button } from '@/shared/view/ui';
import type { AiEditSlot } from '../types';

interface AiEditControlsProps {
  slot: AiEditSlot;
}

export function AiEditControls({ slot }: AiEditControlsProps) {
  const { t } = useTranslation('markdownEditor');
  const [instruction, setInstruction] = useState('');
  const inputRef = useRef<HTMLInputElement | null>(null);

  // 弹出指令框时自动聚焦。
  useEffect(() => {
    if (slot.awaitingInstruction) {
      setInstruction('');
      // 让 DOM 先渲染 input 再 focus。
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [slot.awaitingInstruction]);

  // 状态优先级:awaitingInstruction > running > success(diff) > error > idle trigger。
  if (slot.awaitingInstruction) {
    return (
      <div className="flex items-center gap-1.5 rounded-md border border-blue-300/60 bg-blue-50/80 px-2 py-1 dark:border-blue-700/40 dark:bg-blue-900/15">
        <Sparkles className="h-3.5 w-3.5 flex-shrink-0 text-blue-500 dark:text-blue-400" />
        <input
          ref={inputRef}
          type="text"
          value={instruction}
          onChange={(e) => setInstruction(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              slot.submitPrompt(instruction);
            } else if (e.key === 'Escape') {
              e.preventDefault();
              slot.cancelInstruction();
            }
          }}
          placeholder={t('ai.promptPlaceholder')}
          className="min-w-0 flex-1 bg-transparent text-xs text-foreground placeholder:text-muted-foreground/60 focus:outline-none"
        />
        <Button
          size="sm"
          variant="ghost"
          className="h-6 px-2 text-xs"
          onClick={() => slot.submitPrompt(instruction)}
        >
          {t('ai.submit')}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          className="h-6 w-6 p-0"
          onClick={slot.cancelInstruction}
          aria-label={t('ai.cancel')}
        >
          <X className="h-3.5 w-3.5" />
        </Button>
      </div>
    );
  }

  if (slot.status === 'running') {
    return (
      <div className="flex items-center gap-1.5 rounded-md bg-blue-50/80 px-2 py-1 text-xs text-blue-600 dark:bg-blue-900/15 dark:text-blue-300">
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
        <span>{t('ai.running')}</span>
        <Button size="sm" variant="ghost" className="ml-1 h-6 px-2 text-xs" onClick={slot.cancelRun}>
          {t('ai.cancel')}
        </Button>
      </div>
    );
  }

  if (slot.hasAiDiff) {
    return (
      <div className="flex items-center gap-1.5 rounded-md border border-emerald-300/60 bg-emerald-50/80 px-2 py-1 dark:border-emerald-700/40 dark:bg-emerald-900/15">
        <span className="text-xs text-emerald-700 dark:text-emerald-300">{t('ai.diffHint')}</span>
        <Button
          size="sm"
          className="h-6 gap-1 px-2 text-xs"
          onClick={slot.accept}
        >
          <Check className="h-3.5 w-3.5" />
          {t('ai.accept')}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          className="h-6 gap-1 px-2 text-xs"
          onClick={slot.reject}
        >
          <X className="h-3.5 w-3.5" />
          {t('ai.reject')}
        </Button>
      </div>
    );
  }

  if (slot.status === 'error' && slot.message) {
    return (
      <div className="flex items-center gap-1.5 rounded-md bg-red-50/80 px-2 py-1 text-xs text-red-600 dark:bg-red-900/15 dark:text-red-300">
        <span>{slot.message}</span>
        <Button size="sm" variant="ghost" className="h-6 px-2 text-xs" onClick={() => window.location.reload()}>
          {t('refresh')}
        </Button>
      </div>
    );
  }

  // idle:显示触发按钮(选段时启用)。
  const disabled = !slot.hasSelection;
  const title = slot.hasSelection ? t('ai.triggerTooltip') : t('ai.selectFirst');
  return (
    <Button
      size="sm"
      variant="ghost"
      className="h-7 gap-1 px-2 text-xs"
      disabled={disabled}
      onClick={slot.trigger}
      title={title}
    >
      <Sparkles className="h-3.5 w-3.5" />
      {t('ai.trigger')}
    </Button>
  );
}
