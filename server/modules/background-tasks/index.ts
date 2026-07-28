// server/modules/background-tasks/index.ts
//
// Public barrel for the background-tasks module. The eslint boundaries rule
// requires cross-module imports to enter through this file instead of
// deep-importing module internals.
//
// Consumers:
// - server/claude-sdk.js: parser hook + bash-kill dispatcher
// - server/modules/kanban/assembly.ts: kanban producer
// - server/modules/a2a/inbound.service.ts: a2a producer
// - server/modules/websocket/services/chat-run-registry.service.ts: chat proxy
// - server/index.js: broadcast + killBash deps + router mount

export { backgroundTaskRegistry } from '@/modules/background-tasks/registry.service.js';
export type {
  BackgroundTaskBroadcaster,
  BashKillDispatcher,
  RegistryDeps,
} from '@/modules/background-tasks/registry.service.js';
export { backgroundTaskRoutes } from '@/modules/background-tasks/registry.routes.js';
export { setBashKillDeps, killBashTask } from '@/modules/background-tasks/bash-kill.js';
export { parseBashTaskEvent } from '@/modules/background-tasks/bash-parser.js';
export type { BashRegistryOp, BashParserContext } from '@/modules/background-tasks/bash-parser.js';
