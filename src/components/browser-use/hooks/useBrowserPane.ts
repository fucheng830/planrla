import { useCallback, useEffect, useRef, useState } from 'react';
import type { MouseEvent as ReactMouseEvent } from 'react';
import type { BrowserPaneUrlChange } from '../../../types/browser-pane';

const MIN_WIDTH = 320;
const MAX_WIDTH_RATIO = 0.8;

type BrowserPaneState = {
  url: string;
  title: string;
  canGoBack: boolean;
  canGoForward: boolean;
};

const INITIAL_STATE: BrowserPaneState = { url: '', title: '', canGoBack: false, canGoForward: false };

type UseBrowserPaneOptions = {
  enabled: boolean;
  isMobile: boolean;
  initialWidth?: number;
};

// 浏览器面板 hook:管理 resize 拖动、ResizeObserver→updateBounds、url/title 状态。
// enabled = 面板当前是否显示(关闭时不订阅、不推 bounds)。
export function useBrowserPane({ enabled, isMobile, initialWidth = 560 }: UseBrowserPaneOptions) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const resizeHandleRef = useRef<HTMLDivElement | null>(null);
  const [paneWidth, setPaneWidth] = useState(initialWidth);
  const [isResizing, setIsResizing] = useState(false);
  const [state, setState] = useState<BrowserPaneState>(INITIAL_STATE);

  // 订阅 url/title 变化(main 经 preload 推送)
  useEffect(() => {
    const api = typeof window !== 'undefined' ? window.browserPane : undefined;
    if (!enabled || !api) return;
    const offUrl = api.onUrlChange((p: BrowserPaneUrlChange) =>
      setState((s) => ({ ...s, url: p.url, canGoBack: p.canGoBack, canGoForward: p.canGoForward })),
    );
    const offTitle = api.onTitleChange((p) => setState((s) => ({ ...s, title: p.title })));
    return () => {
      offUrl?.();
      offTitle?.();
    };
  }, [enabled]);

  // ResizeObserver → updateBounds(rAF 节流)。容器尺寸或拖动状态变化时也重推一次。
  useEffect(() => {
    if (!enabled) return;
    const el = containerRef.current;
    const api = typeof window !== 'undefined' ? window.browserPane : undefined;
    if (!el || !api) return;
    let rafId = 0;
    const send = () => {
      rafId = 0;
      const r = el.getBoundingClientRect();
      api.updateBounds({
        x: Math.round(r.x),
        y: Math.round(r.y),
        width: Math.round(r.width),
        height: Math.round(r.height),
      });
    };
    const schedule = () => {
      if (rafId) return;
      rafId = requestAnimationFrame(send);
    };
    const ro = new ResizeObserver(schedule);
    ro.observe(el);
    schedule();
    return () => {
      ro.disconnect();
      if (rafId) cancelAnimationFrame(rafId);
    };
  }, [enabled, paneWidth, isResizing]);

  // resize 拖动(复用 useEditorSidebar 模式:鼠标到容器右沿距离 = 面板宽)
  useEffect(() => {
    if (!isResizing) return;
    const onMove = (e: globalThis.MouseEvent) => {
      // resizeHandle 的父级 = 面板,再父级 = 含左侧 + 面板的水平 flex 容器
      const flexContainer = resizeHandleRef.current?.parentElement?.parentElement;
      if (!flexContainer) return;
      const rect = flexContainer.getBoundingClientRect();
      const w = rect.right - e.clientX;
      const max = rect.width * MAX_WIDTH_RATIO;
      if (w >= MIN_WIDTH && w <= max) setPaneWidth(w);
    };
    const onUp = () => setIsResizing(false);
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    return () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
  }, [isResizing]);

  const handleResizeStart = useCallback(
    (e: ReactMouseEvent<HTMLDivElement>) => {
      if (isMobile) return;
      e.preventDefault();
      setIsResizing(true);
    },
    [isMobile],
  );

  const navigate = useCallback((url: string) => {
    window.browserPane?.navigate(url);
  }, []);

  const goBack = useCallback(() => window.browserPane?.goBack(), []);
  const goForward = useCallback(() => window.browserPane?.goForward(), []);
  const reload = useCallback(() => window.browserPane?.reload(), []);

  return {
    containerRef,
    resizeHandleRef,
    paneWidth,
    handleResizeStart,
    state,
    navigate,
    goBack,
    goForward,
    reload,
  };
}
