// server/modules/kanban/index.ts
//
// Public barrel for the kanban module. The eslint boundaries rule requires
// cross-module imports to enter through this file instead of deep-importing
// module internals (files inside the module keep importing siblings directly).
// Currently only the Claude SDK hook factory is consumed from outside
// (server/claude-sdk.js); the rest of the module is wired internally by
// assembly.ts.

export { createKanbanClaudeHooks, formatInjectedAnswers } from '@/modules/kanban/claude-hooks.js';
export type { HookApprovalDecision, KanbanClaudeHooksDeps } from '@/modules/kanban/claude-hooks.js';
