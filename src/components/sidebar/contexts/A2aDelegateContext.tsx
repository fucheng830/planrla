/**
 * REQ-020 S3 — A2A delegation opt-in for individual chat sessions.
 *
 * The sidebar renders one "Allow A2A delegation" toggle per session row. The
 * authoritative flag lives on the server (`sessions.a2a_exposed`) and is
 * carried into the client through the project/session payload. This context
 * exposes:
 *
 *  - `isExposed(sessionId, serverValue)` — merges the server-provided value
 *    with a local optimistic override so the toggle reacts instantly.
 *  - `toggle(sessionId, next)` — fires the PATCH `/api/settings/sessions/:id/
 *    a2a-exposed` call. The optimistic override is applied immediately; on
 *    failure it is rolled back so the UI never lies about server state.
 *
 * Keeping this in a context (instead of threading two new props through five
 * sidebar layers) lets `SidebarSessionItem` opt in without touching its
 * ancestors' prop signatures.
 */
import { createContext, useContext } from 'react';

export type A2aDelegateContextValue = {
  /** Returns the effective exposed flag (optimistic override wins). */
  isExposed: (sessionId: string, serverValue?: boolean) => boolean;
  /**
   * Toggles one session's A2A exposure. Implementations apply an optimistic
   * override, call the PATCH API, and roll back on failure.
   */
  toggle: (sessionId: string, next: boolean) => Promise<void>;
  /** True while the PATCH for this session is in flight. */
  isPending: (sessionId: string) => boolean;
};

const noopContext: A2aDelegateContextValue = {
  isExposed: (_sessionId, serverValue) => Boolean(serverValue),
  toggle: async () => {
    // Default no-op: the provider has not been mounted. Safe fallback so the
    // toggle renders without crashing if rendered outside the sidebar tree.
  },
  isPending: () => false,
};

const A2aDelegateContext = createContext<A2aDelegateContextValue>(noopContext);

export const A2aDelegateProvider = A2aDelegateContext.Provider;

export function useA2aDelegate(): A2aDelegateContextValue {
  return useContext(A2aDelegateContext);
}
