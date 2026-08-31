export interface SessionReference {
  /** 客户端生成的唯一 id。 */
  id: string;
  sessionId: string;
  title: string;
  provider: string;
  /** ISO date string(展示用)。 */
  date: string;
}

/** 一行提示(注入到 prompt,告诉 agent 有这个 session 可用 query_session 查)。 */
export function formatReferenceHint(ref: SessionReference): string {
  return `[可查询引用:「${ref.title}」(id=${ref.sessionId}, ${ref.provider})] 用 query_session 工具按需查它的内容。`;
}

/** 多引用拼成提示区(每行一个,空行分隔)。 */
export function formatReferenceHints(refs: SessionReference[]): string {
  return refs.map(formatReferenceHint).join('\n\n');
}
