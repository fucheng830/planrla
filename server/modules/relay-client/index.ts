// server/modules/relay-client/index.ts
//
// Public barrel for the relay-client module. The eslint boundaries rule
// requires cross-module imports to enter through this file; server/index.js
// mounts the router and calls autostartRelay() from here.

export { default as relayRouter } from './relay.routes.js';
export {
  autostartRelay,
  disableRelay,
  enableRelay,
  getRelayStatus,
  DEFAULT_RELAY_URL,
} from './relay.service.js';
export type { RelayStatus } from './relay.service.js';
export type { RelayAgentState, RelayAgentStats } from './relay.client.js';
