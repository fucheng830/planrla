// server/modules/kanban/aux-bridge.ts
//
// Translates provider session events (emitted by spawnFns like
// server/claude-sdk.js / server/openai-codex.js through the writer) into
// kanban TaskAuxFlags updates.
//
// Event shapes referenced here are the JSON message kinds the existing
// chat orchestrator already forwards to `writer.send(JSON.stringify(msg))`:
//   - permission_request: { kind, toolName, requestId, input? }  (Claude SDK)
//   - tool_use:           { kind, toolName, toolInput }          (Claude/Codex)
//
// The bridge is intentionally minimal: it only reacts to the tool/event
// kinds that map onto an aux flag, and ignores everything else. Unknown
// tool names fall through and produce no update.

import type { TaskAuxFlags } from '@/modules/kanban/types.js';

export interface AuxBridgeDeps {
  updateAuxFlags: (taskId: string, flags: Partial<TaskAuxFlags>) => void;
}

export function createAuxBridge(deps: AuxBridgeDeps) {
  const { updateAuxFlags } = deps;

  /**
   * Inspect a single provider event for `taskId` and, when it matches a
   * known tool/event kind, push the corresponding aux flag update.
   *
   * `msg` is typed `any` on purpose: provider SDKs emit heterogeneous
   * shapes and we validate defensively (kind must be a string, toolName
   * must match a known name) before acting.
   */
  function handle(taskId: string, msg: any): void {
    if (!msg || typeof msg.kind !== 'string') return;
    const { kind, toolName } = msg;

    if (kind === 'permission_request' && toolName === 'AskUserQuestion') {
      // Capture the requestId + questions payload so the kanban UI can render
      // an inline answer box (REQ-038). `msg.input` is the AskUserQuestion
      // payload ({ questions: [...] }); guard defensively since the shape is
      // provider-defined.
      const input = msg.input;
      updateAuxFlags(taskId, {
        askUserWaiting: true,
        pendingAskUser: {
          requestId: String(msg.requestId ?? ''),
          questions: input && typeof input === 'object' ? input : { questions: [] },
          capturedAt: new Date().toISOString(),
        },
      });
      return;
    }
    if (kind === 'permission_request' && toolName === 'ExitPlanMode') {
      updateAuxFlags(taskId, { hasPlan: true });
      return;
    }
    if (kind === 'tool_use') {
      if (toolName === 'TodoWrite' || toolName === 'TodoList') {
        updateAuxFlags(taskId, { hasTodos: true });
        return;
      }
      if (toolName === 'Task') {
        updateAuxFlags(taskId, { hasTask: true });
        return;
      }
      if (toolName === 'exit_plan_mode') {
        updateAuxFlags(taskId, { hasPlan: true });
        return;
      }
    }
  }

  return { handle };
}

export type AuxBridge = ReturnType<typeof createAuxBridge>;
