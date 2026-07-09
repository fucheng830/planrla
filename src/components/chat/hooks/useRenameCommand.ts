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
 */
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
  if (explicitTitle) {
    return `[重命名当前会话 (id=${sessionId})] 请用标题"${explicitTitle}"调用 set_session_title 工具写入。`;
  }
  return `[重命名当前会话 (id=${sessionId})] 请根据本次对话内容生成一个简短(5-15 字)的标题,并调用 set_session_title 工具写入。`;
}
