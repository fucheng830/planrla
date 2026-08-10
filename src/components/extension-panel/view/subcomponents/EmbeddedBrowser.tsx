import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, RotateCw, Search } from 'lucide-react';

type EmbeddedBrowserProps = {
  /** When true, the native WebContentsView is temporarily hidden so DOM
   *  overlays (dropdowns, menus) are not covered by it. */
  overlayActive?: boolean;
};

type NavState = {
  url: string;
  canGoBack: boolean;
  canGoForward: boolean;
};

/**
 * Embedded browser panel backed by Electron WebContentsView. The renderer
 * renders an address bar + a placeholder div; a ResizeObserver pushes the
 * div's screen coordinates to the main process which positions the
 * WebContentsView on top of it. Navigation events from the main process
 * update the address bar.
 *
 * In non-Electron (web) builds `window.browserView` is absent — the component
 * degrades to a "browser not available" placeholder.
 */
export default function EmbeddedBrowser({ overlayActive }: EmbeddedBrowserProps) {
  const [url, setUrl] = useState('');
  const [navState, setNavState] = useState<NavState>({ url: '', canGoBack: false, canGoForward: false });
  const [inputValue, setInputValue] = useState('');
  const containerRef = useRef<HTMLDivElement>(null);
  const browserView = typeof window !== 'undefined' ? (window as any).browserView : undefined;

  // Push the placeholder div's position to the main process. We compute the
  // element's position relative to the viewport (CSS pixels) using
  // getBoundingClientRect — these are window-relative, not screen-physical, so
  // they work correctly with DPI scaling and multi-monitor setups.
  const pushBounds = useCallback(() => {
    if (!browserView || !containerRef.current) return;
    const el = containerRef.current;
    const rect = el.getBoundingClientRect();
    browserView.setBounds({
      x: rect.left,
      y: rect.top,
      width: rect.width,
      height: rect.height,
    });
  }, [browserView]);

  // Create the view on mount, destroy on unmount.
  useEffect(() => {
    if (!browserView || !containerRef.current) return;

    let unsub: (() => void) | undefined;
    let observer: ResizeObserver | undefined;

    const rect = containerRef.current.getBoundingClientRect();

    // Create first, then load the default page once the view is ready.
    browserView.create({ x: rect.left, y: rect.top, width: rect.width, height: rect.height })
      .then(() => {
        // Subscribe to navigation changes.
        unsub = browserView!.onNavChange((data: NavState) => {
          setNavState(data);
          setInputValue(data.url);
        });

        // Load a default page now that the view exists.
        browserView!.loadURL('https://www.baidu.com');

        // ResizeObserver keeps the view positioned as the panel resizes.
        observer = new ResizeObserver(() => pushBounds());
        if (containerRef.current) observer.observe(containerRef.current);
      });

    return () => {
      unsub?.();
      observer?.disconnect();
      browserView.destroy();
    };
  }, [browserView, pushBounds]);

  // Hide the view when the component becomes invisible (tab switch / panel
  // collapse) and show it again when visible.
  useEffect(() => {
    if (!browserView) return;
    // The view is visible by default after create; this effect runs on every
    // re-render so we just ensure bounds are current.
    pushBounds();
  });

  // Hide the native WebContentsView when a DOM overlay (dropdown menu) is
  // active — otherwise the native view covers it.
  useEffect(() => {
    if (!browserView) return;
    if (overlayActive) {
      browserView.hide();
    } else {
      // Restore: re-push bounds so the view repositions correctly after show.
      const rect = containerRef.current?.getBoundingClientRect();
      if (rect) {
        browserView.show({ x: rect.left, y: rect.top, width: rect.width, height: rect.height });
      }
    }
  }, [overlayActive, browserView]);

  const handleNavigate = useCallback((e: React.FormEvent) => {
    e.preventDefault();
    if (!browserView || !inputValue.trim()) return;
    browserView.loadURL(inputValue.trim());
  }, [browserView, inputValue]);

  if (!browserView) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center">
        <p className="text-sm text-muted-foreground">
          Embedded browser is only available in the desktop app.
        </p>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      {/* Address bar + navigation */}
      <div className="flex items-center gap-1 border-b border-border px-2 py-1.5">
        <button
          type="button"
          onClick={() => browserView.goBack()}
          disabled={!navState.canGoBack}
          className="flex h-7 w-7 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-30"
          title="Back"
        >
          <ArrowLeft className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={() => browserView.goForward()}
          disabled={!navState.canGoForward}
          className="flex h-7 w-7 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-30"
          title="Forward"
        >
          <ArrowRight className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={() => browserView.reload()}
          className="flex h-7 w-7 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground"
          title="Reload"
        >
          <RotateCw className="h-4 w-4" />
        </button>
        <form onSubmit={handleNavigate} className="flex flex-1 items-center">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-2 top-1/2 h-3 w-3 -translate-y-1/2 text-muted-foreground/50" />
            <input
              type="text"
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              placeholder="Search or enter address"
              className="h-7 w-full rounded-md border border-border bg-background pl-7 pr-2 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
            />
          </div>
        </form>
      </div>

      {/* Placeholder div — the WebContentsView is positioned on top of this */}
      <div ref={containerRef} className="relative min-h-0 flex-1 bg-background" />
    </div>
  );
}
