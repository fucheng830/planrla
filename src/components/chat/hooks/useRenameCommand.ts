/**
 * /rename slash-command parsing + hint formatting (mirrors useSearchCommand).
 *
 * `/rename` alone → ask the agent to generate a short title from the
 * conversation and call `set_session_title`.
 * `/rename <title>` → ask the agent to use the provided title verbatim.
 *
 * The hint is prepended to the outgoing user message (same prepend pattern as
 * /search) so the agent sees the current sessionId and the instruction in
 * one block.
 *
 * REQ-030: the literal hint head (`SILENT_RENAME_HINT_PREFIX`) is shared with
 * the backend history filter via `shared/renameCommand` so the synthetic
 * silent-rename user message can be detected identically on reload.
 */
import { SILENT_RENAME_HINT_PREFIX } from '../../../../shared/renameCommand';

export function parseRenameCommand(rawInput: string): { explicitTitle?: string } {
  const trimmed = rawInput.trim();
  const match = trimmed.match(/^\/rename(?:\s+(.*))?$/i);
  if (!match) {
    return {};
  }
  const rest = (match[1] || '').trim();
  return rest ? { explicitTitle: rest } : {};
}

export function formatRenameCommandHint(sessionId: string, explicitTitle?: string): string {
  const head = `${SILENT_RENAME_HINT_PREFIX}${sessionId})] `;
  if (explicitTitle) {
    return `${head}请用标题"${explicitTitle}"调用 set_session_title 工具写入。`;
  }
  return `${head}请根据本次对话内容生成一个简短(5-15 字)的标题,并调用 set_session_title 工具写入。`;
}
