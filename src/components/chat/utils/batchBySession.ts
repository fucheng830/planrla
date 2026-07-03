import type { NormalizedMessage } from '../../../stores/useSessionStore';

/** 待批量写入 store 的单条事件（sessionId + 消息）。 */
export type BatchEntry = {
  sessionId: string;
  msg: NormalizedMessage;
};

/**
 * 把累积的 shouldPersist 事件按 session 分组，顺序保留。
 * flush 时对每个 session 调一次 `sessionStore.appendRealtimeBatch(sid, msgs)`，
 * 把 N 次 appendRealtime 合并为 per-session 一次 set。
 */
export function batchBySession(entries: BatchEntry[]): Map<string, NormalizedMessage[]> {
  const grouped = new Map<string, NormalizedMessage[]>();
  for (const entry of entries) {
    const arr = grouped.get(entry.sessionId);
    if (arr) {
      arr.push(entry.msg);
    } else {
      grouped.set(entry.sessionId, [entry.msg]);
    }
  }
  return grouped;
}
