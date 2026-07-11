import type { NormalizedMessage } from '@/shared/types.js';
import { isSilentRenameHintContent } from '../../shared/renameCommand.js';

/**
 * REQ-030 — drops silent rename turns from a normalized history stream.
 *
 * A silent rename turn is the synthetic exchange the auto-rename hook injects
 * to drive `set_session_title`: a user message whose content opens with the
 * shared `SILENT_RENAME_HINT_PREFIX`, followed by the assistant's text/thinking
 * response, a `set_session_title` tool_use row, and the matching tool_result.
 *
 * The provider runtime persists that whole exchange into the transcript on
 * disk, so on reload `fetchHistory` would hand it back and the user would see
 * the `[重命名当前会话 (id=...)]` hint plus the tool call. This filter is the
 * read-side complement: it strips the entire turn before history leaves the
 * service so neither REST nor MCP consumers ever see it.
 *
 * Turn boundary: starting from a detected hint user message, every subsequent
 * row is dropped until the next message that carries `role === 'user'` (a real
 * user-authored text row) or the end of the array. This is safe because
 * provider adapters only assign `role: 'user'` to genuine user text —
 * tool_result rows, tool_use rows, and thinking rows never carry `role: 'user'`
 * (see claude-sessions.provider.ts normalizeMessage), so the trailing
 * tool_result of the silent turn is always swept up before the boundary fires.
 */
export function filterSilentRenameTurns(messages: NormalizedMessage[]): NormalizedMessage[] {
  if (messages.length === 0) {
    return messages;
  }

  const out: NormalizedMessage[] = [];
  let skipping = false;

  for (const message of messages) {
    if (!skipping) {
      // Entering a silent turn: only a user-authored text row that carries the
      // hint prefix opens a drop window. Tool-result-shaped user rows do not
      // carry the hint content, so they never trigger a drop.
      if (message.role === 'user' && isSilentRenameHintContent(message.content)) {
        skipping = true;
        continue;
      }
      out.push(message);
      continue;
    }

    // Currently inside a silent turn — drop everything until the next real
    // user-authored row. tool_result / tool_use / thinking / assistant text
    // rows never have role === 'user', so they are all dropped here, and the
    // boundary only fires on the next genuine user turn (or end of array).
    if (message.role === 'user') {
      skipping = false;
      // The boundary message itself is a real user turn — keep it. (A hint
      // back-to-back with another silent rename is impossible because the
      // prefix is only ever produced by the rename flow, not user input; if
      // it ever happened, the next iteration would re-enter skipping.)
      out.push(message);
    }
  }

  return out;
}
