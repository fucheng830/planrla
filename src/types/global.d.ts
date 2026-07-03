import type { UpdaterApi } from './updater';

export {};

declare global {
  interface Window {
    __ROUTER_BASENAME__?: string;
    updater?: UpdaterApi;
  }

  interface EventSourceEventMap {
    result: MessageEvent;
    progress: MessageEvent;
    done: MessageEvent;
  }
}
