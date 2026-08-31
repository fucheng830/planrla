// Product analytics (GTM T8). PostHog via the official CDN loader — no npm
// dependency. Everything is a silent no-op unless VITE_POSTHOG_KEY was set at
// build time (never committed; set it in the CI/ Pages env when we launch).
//
// GTM funnel events:
//   signup / cli_connected / session_created / mobile_viewed /
//   alert_triggered / approved_from_mobile   (+ app_viewed as denominator)

type TrackProps = Record<string, string | number | boolean | undefined>;

const KEY = import.meta.env.VITE_POSTHOG_KEY as string | undefined;
const HOST = (import.meta.env.VITE_POSTHOG_HOST as string | undefined) ?? 'https://us.i.posthog.com';

const POSTHOG_LOADER = 'https://js.posthog.com/static/array.js';

interface PosthogQueue {
  push(command: unknown[]): void;
  capture?(event: string, props?: TrackProps): void;
}

let started = false;

function start(): PosthogQueue | null {
  if (typeof window === 'undefined' || !KEY) return null;
  const w = window as unknown as { posthog?: PosthogQueue };
  if (started) return w.posthog ?? null;
  started = true;
  const queue: PosthogQueue = w.posthog ?? [];
  w.posthog = queue;
  queue.push(['init', KEY, { api_host: HOST, autocapture: false }]);
  const script = document.createElement('script');
  script.src = POSTHOG_LOADER;
  script.async = true;
  document.head.appendChild(script);
  return queue;
}

/** Fire-and-forget event. Queued until the loader finishes; no-op without a key. */
export function track(event: string, props: TrackProps = {}): void {
  const ph = start();
  if (!ph) return;
  try {
    if (typeof ph.capture === 'function') ph.capture(event, props);
    else ph.push(['capture', event, props]);
  } catch {
    // analytics must never break the app
  }
}

export function isMobileViewport(): boolean {
  if (typeof window === 'undefined') return false;
  return window.matchMedia('(max-width: 768px)').matches || /Android|iPhone|iPad|Mobile/i.test(navigator.userAgent);
}

/** True when the app UI was loaded through the cloud relay (phone link). */
export function isRelayOrigin(): boolean {
  return typeof window !== 'undefined' && window.location.hostname === 'api.planrla.com';
}

/** Fires session_created for new chats and cli_connected once per provider. */
export function trackRunStarted(provider: string | undefined, isNewSession: boolean): void {
  if (isNewSession) track('session_created', { provider });
  if (provider) {
    const storageKey = `planrla:seen-providers`;
    try {
      const seen = new Set(JSON.parse(localStorage.getItem(storageKey) ?? '[]') as string[]);
      if (!seen.has(provider)) {
        seen.add(provider);
        localStorage.setItem(storageKey, JSON.stringify([...seen]));
        track('cli_connected', { provider });
      }
    } catch {
      track('cli_connected', { provider });
    }
  }
}
