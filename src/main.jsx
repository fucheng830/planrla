import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.tsx'
import './index.css'
import './design-system/workbench.css'
import 'katex/dist/katex.min.css'

import { measure } from './shared/perf/timing'
import { isMobileViewport, isRelayOrigin, track } from './utils/analytics'

// Initialize i18n
import './i18n/config.js'

// GTM T8 activation funnel denominator — counts every session start, including
// phone browsers loaded through the relay (the W1 cohort).
track('app_viewed', { mobile: isMobileViewport(), relay: isRelayOrigin() });
if (isMobileViewport() || isRelayOrigin()) track('mobile_viewed', { relay: isRelayOrigin() });

// Register service worker for PWA + Web Push support — production only.
// In dev the SW (cache-first assets + fetch interception) fights Vite's own
// module serving; a stale registration leaves the page running half-dead
// modules (dead click handlers). Dev loads tear down leftover SW + caches.
if ('serviceWorker' in navigator) {
  if (import.meta.env.DEV) {
    navigator.serviceWorker.getRegistrations().then((registrations) => {
      registrations.forEach((registration) => registration.unregister());
    }).catch(() => {});
    if (window.caches && window.caches.keys) {
      caches.keys().then((keys) => keys.forEach((key) => caches.delete(key))).catch(() => {});
    }
  } else {
    navigator.serviceWorker.register('/sw.js').catch(err => {
      console.warn('Service worker registration failed:', err);
    });
  }
}

// 性能测点 app-init:包 createRoot + 首次 render。dev → console.debug 耗时;生产零开销。
measure('app-init', () => {
  ReactDOM.createRoot(document.getElementById('root')).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  );
})
