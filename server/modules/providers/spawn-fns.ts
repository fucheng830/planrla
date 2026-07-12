// server/modules/providers/spawn-fns.ts
//
// Central re-export of the five provider spawn functions the kanban runner
// (and the chat orchestrator in server/index.js) drive to launch an agent
// session. Aggregating them here lets call sites depend on one map keyed by
// the `agent` string stored on a StageTemplate, instead of importing each
// provider wrapper individually.
//
// The underlying wrappers live as .js in the server root because the backend
// is mid-migration from JS to TS (see server/tsconfig.json `allowJs: true`).
// `@/` maps to `server/` (tsconfig paths), so `@/claude-sdk.js` resolves to
// server/claude-sdk.js etc.

import { queryClaudeSDK } from '@/claude-sdk.js';
import { queryCodex } from '@/openai-codex.js';
import { spawnCursor } from '@/cursor-cli.js';
import { spawnGemini } from '@/gemini-cli.js';
import { spawnOpenCode } from '@/opencode-cli.js';

/**
 * Writer contract every spawnFn expects (see RunnerWriter for the runner-side
 * implementation). Kept loose (`any`) because each provider wrapper was
 * written against the chat path's WebSocket writer and only relies on
 * `.send()` / `.setSessionId()` / `.updateWebSocket()` / `.isWebSocketWriter`.
 */
export type SpawnFn = (command: string, options: any, writer: any) => Promise<unknown>;

/**
 * Map of provider key → spawn function. The key matches `StageTemplate.agent`
 * ("claude" | "codex" | "cursor" | "gemini" | "opencode").
 */
export const spawnFns: Record<string, SpawnFn> = {
  claude: queryClaudeSDK,
  codex: queryCodex,
  cursor: spawnCursor,
  gemini: spawnGemini,
  opencode: spawnOpenCode,
};
