import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowLeft, ArrowRight, RotateCw, X } from 'lucide-react';

import { Button } from '../../../shared/view/ui';
import { useBrowserPane } from '../hooks/useBrowserPane';

type BrowserPaneProps = {
  isMobile: boolean;
  onClose: () => void;
  initialUrl?: string;
};

// BrowserPane = 工具栏 + WebContentsView 宿主 + 左边缘 resize 手柄。
// 生命周期:挂载 → window.browserPane.open(initialUrl);卸载 → close()。
// resize 手柄沿用 EditorSidebar 模式:作为面板根 flex 容器的首个直接子元素,
// 满足 useBrowserPane 的 M2 契约(resizeHandleRef.parentElement.parentElement === MainContent 的水平 flex 容器)。
export default function BrowserPane({
  isMobile,
  onClose,
  initialUrl = 'https://www.google.com',
}: BrowserPaneProps) {
  const { t } = useTranslation('settings');
  const [addressInput, setAddressInput] = useState(initialUrl);
  const {
    containerRef,
    resizeHandleRef,
    paneWidth,
    handleResizeStart,
    state,
    navigate,
    goBack,
    goForward,
    reload,
  } = useBrowserPane({ enabled: true, isMobile });

  // 挂载即 open view + 导航到初始 url;卸载 close 让 main destroy view。
  useEffect(() => {
    window.browserPane?.open(initialUrl);
    setAddressInput(initialUrl);
    return () => {
      window.browserPane?.close();
    };
  }, [initialUrl]);

  // main 回推的 url 变化时,同步地址栏(用户未在输入框聚焦时)。
  useEffect(() => {
    if (state.url && document.activeElement?.tagName !== 'INPUT') {
      setAddressInput(state.url);
    }
  }, [state.url]);

  const submitAddress = (event: FormEvent) => {
    event.preventDefault();
    const trimmed = addressInput.trim();
    if (!trimmed) return;
    const withProto = /^[a-zA-Z][a-zA-Z\d+\-.]*:/.test(trimmed) ? trimmed : `https://${trimmed}`;
    navigate(withProto);
  };

  return (
    <div
      className="flex h-full min-h-0 flex-row border-l border-border bg-background"
      style={{ width: `${paneWidth}px`, flexShrink: 0 }}
    >
      {/* resize 手柄(左边缘)— 必须是面板根的直接子元素 */}
      <div
        ref={resizeHandleRef}
        onMouseDown={handleResizeStart}
        className="group relative w-1 flex-shrink-0 cursor-col-resize bg-border/60 transition-colors hover:bg-primary/60"
        title={t('browserPane.resize')}
      >
        <div className="absolute inset-y-0 left-1/2 w-1 -translate-x-1/2 bg-primary opacity-0 transition-opacity group-hover:opacity-100" />
      </div>

      <div className="flex h-full min-w-0 flex-1 flex-col">
        {/* 工具栏 */}
        <div className="flex items-center gap-1 border-b border-border/60 px-2 py-1.5">
          <Button
            variant="ghost"
            size="sm"
            className="h-7 w-7 p-0"
            onClick={goBack}
            disabled={!state.canGoBack}
            title={t('browserPane.back')}
            aria-label={t('browserPane.back')}
          >
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 w-7 p-0"
            onClick={goForward}
            disabled={!state.canGoForward}
            title={t('browserPane.forward')}
            aria-label={t('browserPane.forward')}
          >
            <ArrowRight className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 w-7 p-0"
            onClick={reload}
            title={t('browserPane.reload')}
            aria-label={t('browserPane.reload')}
          >
            <RotateCw className="h-4 w-4" />
          </Button>
          <form onSubmit={submitAddress} className="min-w-0 flex-1">
            <input
              value={addressInput}
              onChange={(event) => setAddressInput(event.target.value)}
              placeholder={t('browserPane.addressPlaceholder')}
              className="w-full rounded-md border border-border bg-muted/40 px-2 py-1 text-sm text-foreground outline-none focus:border-primary/50"
              spellCheck={false}
            />
          </form>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 w-7 p-0"
            onClick={onClose}
            title={t('browserPane.close')}
            aria-label={t('browserPane.close')}
          >
            <X className="h-4 w-4" />
          </Button>
        </div>

        {/* WebContentsView 宿主:透明占位,native view 由 main 附加到此屏幕区域 */}
        <div ref={containerRef} className="min-h-0 flex-1 bg-neutral-100 dark:bg-neutral-900" />
      </div>
    </div>
  );
}
