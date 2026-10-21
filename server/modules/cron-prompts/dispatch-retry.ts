// 派发失败归类(移植 ZCode failureKind 语义)。

export type DispatchFailureKind = 'transient' | 'permanent';

/** 根据错误信息判断失败类别:结构性问题不重试,环境性问题退避重试。 */
export function kindForError(message: string): DispatchFailureKind {
  if (/not supported|not found|provider mismatch/i.test(message)) return 'permanent';
  return 'transient';
}

/** 退避毫秒 → 人读分/秒(用于日志与 UI)。 */
export function formatNextRunParts(ms: number): { minutes: number; seconds: number } {
  return { minutes: Math.floor(ms / 60_000), seconds: Math.floor((ms % 60_000) / 1000) };
}
