// server/modules/cron-prompts/catch-up.ts
//
// 补跑(catch-up)语义:进程不在线(关机/睡眠/服务重启)期间错过的计划触发,
// 在 driver 下次启动时检测并最多补跑一次。
//
// 判定规则(与 ZCode「错过不补跑」相反,面向日报类任务——错过早上 9 点,
// 10 点启动补一次,比静默丢弃好):
//   1. 任务 enabled 且 catchUp 开启
//   2. 有持久化的 nextRunAt(上次运行推进的计划点)
//   3. nextRunAt <= now(计划点已过而未运行)
//   4. now - nextRunAt <= CATCH_UP_WINDOW_MS(默认 7 天,超过视为任务失效)
//
// nextRunAt 在每次正常运行触发时推进到下一个计划点并持久化;补跑后同样
// 推进到 now 之后的下一个计划点。因此每次停机窗口最多补跑一次(不是每个
// 错过周期补一次)——高频任务停机 8 小时补跑 1 次而非 N 次,避免风暴。

export const CATCH_UP_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

export interface CatchUpCandidate {
  enabled: boolean;
  catchUp: boolean;
  /** ISO 字符串(SQLite CURRENT_TIMESTAMP 是 UTC 裸串,由调用方解析)。 */
  nextRunAt: string | null;
}

export interface CatchUpDecision {
  shouldCatchUp: boolean;
  reason?: 'disabled' | 'catch-up-off' | 'no-scheduled-run' | 'not-yet-due' | 'too-old';
}

export function parseNaiveUtcIso(value: string): number | null {
  const naive = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})$/.exec(value.trim());
  if (naive) {
    return Date.UTC(
      Number(naive[1]), Number(naive[2]) - 1, Number(naive[3]),
      Number(naive[4]), Number(naive[5]), Number(naive[6]),
    );
  }
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * 判断一个任务是否需要补跑。nowMs 可注入便于测试。
 */
export function shouldCatchUp(
  task: CatchUpCandidate,
  nowMs: number = Date.now(),
  windowMs: number = CATCH_UP_WINDOW_MS,
): CatchUpDecision {
  if (!task.enabled) return { shouldCatchUp: false, reason: 'disabled' };
  if (!task.catchUp) return { shouldCatchUp: false, reason: 'catch-up-off' };
  if (!task.nextRunAt) return { shouldCatchUp: false, reason: 'no-scheduled-run' };
  const dueMs = parseNaiveUtcIso(task.nextRunAt);
  if (dueMs === null) return { shouldCatchUp: false, reason: 'no-scheduled-run' };
  if (dueMs > nowMs) return { shouldCatchUp: false, reason: 'not-yet-due' };
  if (nowMs - dueMs > windowMs) return { shouldCatchUp: false, reason: 'too-old' };
  return { shouldCatchUp: true };
}

/** 下一个计划点(从给定基准时间起算)。getNextMatch 由调用方注入 node-cron 的 timeMatcher。 */
export function nextScheduledRunMs(
  cronExpression: string,
  fromMs: number,
  getNextMatch: (expression: string, date: Date) => Date | null,
): number | null {
  const match = getNextMatch(cronExpression, new Date(fromMs));
  return match ? match.getTime() : null;
}

/** SQLite CURRENT_TIMESTAMP 裸串(UTC)格式化。 */
export function formatUtcSqlite(ms: number): string {
  return new Date(ms).toISOString().replace('T', ' ').replace(/\.\d+Z$/, '');
}
