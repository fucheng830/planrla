// server/modules/cron-prompts/cron-prompts.driver.ts
//
// 到点执行:为每次触发新建一个 app 会话并 spawn 对应 provider 执行 prompt。
// 复用 A2A inbound 的 S4 spawn 模式(chatRunRegistry 锁 + 静默 writer)——
// 会话会正常出现在侧边栏,产物落在 provider 自己的 transcript 里。

import { existsSync } from 'node:fs';
import { homedir } from 'node:os';

import * as cron from 'node-cron';

import { spawnFns, sessionsService } from '@/modules/providers/index.js';
import { chatRunRegistry } from '@/modules/websocket/index.js';
import type { LLMProvider, RealtimeClientConnection } from '@/shared/types.js';
import { broadcastTeamMessage } from '@/utils/kanban-websocket.js';
import { createTeamMessageStore } from '@/modules/team-messages/index.js';
import { projectsDb, sessionsDb } from '@/modules/database/index.js';

import { formatUtcSqlite, nextScheduledRunMs, shouldCatchUp } from './catch-up.js';
import { cronPromptsStore, type CronPromptTask } from './cron-prompts.store.js';

// 派发退避常量(移植 ZCode DISPATCH_RETRY_*):spawn/路径失败后指数退避重试。
const DISPATCH_RETRY_BASE_MS = 30_000;
const DISPATCH_RETRY_CAP_MS = 15 * 60_000;
const DISPATCH_RETRY_MAX_ATTEMPTS = 5;

/** No-op websocket stub (same trick as A2A inbound): the cron path has no live peer. */
const STUB_CONNECTION: RealtimeClientConnection = {
  readyState: 3,
  send() { /* no live client */ },
};

/** Result handed to callers as soon as a run has been handed off to the provider. */
export interface CronRunStartResult {
  sessionId: string | null;
  error?: string;
}

/** Buffers provider events; completion releases the driver's await. */
class CronRunWriter {
  readonly isWebSocketWriter = true;
  readonly userId: string | number = 0;
  private done = false;
  private resolveDone?: () => void;
  private timer?: NodeJS.Timeout;
  lastError: string | null = null;

  send(data: unknown): void {
    if (this.done) return;
    let msg: Record<string, any>;
    try {
      msg = typeof data === 'string' ? JSON.parse(data) : (data as Record<string, any>);
    } catch { return; }
    if (msg?.kind === 'complete' || msg?.kind === 'error') {
      if (msg?.kind === 'error' && msg?.content) {
        this.lastError = String(msg.content);
      }
      this.done = true;
      this.resolveDone?.();
    }
  }

  setSessionId(_sid: string): void { /* persistence owned by sessionsDb */ }
  updateWebSocket(): void { /* no-op */ }

  /** Resolves on complete/error or timeout (whichever first). */
  waitComplete(timeoutMs: number): Promise<void> {
    return new Promise((resolve) => {
      this.resolveDone = resolve;
      this.timer = setTimeout(() => {
        if (!this.done) { this.done = true; resolve(); }
      }, timeoutMs);
    });
  }

  dispose(): void {
    if (this.timer) clearTimeout(this.timer);
  }
}

export interface CronPromptsDriver {
  start(): void;
  reload(): void;
  stop(): void;
  /** Runs one task immediately (manual "Run now" / API). Returns the app session id. */
  runNow(taskId: string): Promise<CronRunStartResult>;
  /** index.js 注入 wss 提供函数,驱动发出的消息盒子通知才能实时广播。 */
  setBroadcastSource(source: () => object | undefined): void;
}

export function createCronPromptsDriver(deps: {
  log?: (msg: string) => void;
  /** Per-run wall clock cap (fire-and-forget; the spawn itself keeps going). */
  runTimeoutMs?: number;
} = {}): CronPromptsDriver {
  const log = deps.log ?? ((msg: string) => console.log(msg));
  const RUN_TIMEOUT_MS = deps.runTimeoutMs ?? 10 * 60 * 1000;
  const scheduled = new Map<string, { stop: () => void }>();
  const running = new Set<string>();
  const teamMessages = createTeamMessageStore();
  /** index.js 注入 wss 获取函数(与 kanban setTaskBroadcaster 同模式),
   *  让运行通知实时刷进已打开的消息盒子。 */
  let broadcastSource: (() => object | undefined) | undefined;

  /**
   * 站内消息通知:任务开启 notifyInbox 且关联了已注册项目时,往该项目的
   * 消息盒子写一条系统消息(cron 表达式 + 会话指引)。全局任务(未关联
   * 项目)没有落点,静默跳过——会话本身仍会出现在侧边栏。
   */
  function sendInboxNotification(task: CronPromptTask, sessionId: string | null): void {
    if (!task.notifyInbox || !task.projectPath) return;
    try {
      const project = projectsDb.getProjectPath(task.projectPath);
      if (!project) return;
      const wss = broadcastSource?.();
      if (!wss) return;
      const runNo = cronPromptsStore.getById(task.id)?.runCount ?? 0;
      const message = teamMessages.createMessage({
        rootId: project.project_id,
        kind: 'team',
        channel: '定时任务',
        sender: 'Cron',
        content: `定时任务「${task.name}」已触发执行(第 ${runNo} 次,${task.cronExpression})。${sessionId ? `已生成会话,可在侧边栏查看执行结果。` : '⚠️ 本次未成功拉起会话,请检查任务配置或服务端日志。'}`,
        taskId: null,
      });
      broadcastTeamMessage(wss, message.rootId, message);
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      log(`[cron-prompts] inbox notify failed (task=${task.name}): ${detail}`);
    }
  }

  /**
   * Validates + mints the app session synchronously, then lets the provider
   * spawn continue in the background. Resolves with the app session id as
   * soon as the run has been handed off (bounded by RUN_TIMEOUT_MS).
   */
  async function executeTask(
    task: CronPromptTask,
    onStarted?: (result: CronRunStartResult) => void,
    trigger: 'schedule' | 'manual' | 'catch-up' = 'schedule',
  ): Promise<string | null> {
    const runId = `${task.id}:${Date.now()}`;
    const spawnFn = spawnFns[task.provider as keyof typeof spawnFns];
    if (!spawnFn) {
      log(`[cron-prompts] provider "${task.provider}" not supported`);
      onStarted?.({ sessionId: null, error: `provider "${task.provider}" not supported` });
      cronPromptsStore.insertRun({ runId, taskId: task.id, trigger, scheduledAt: task.nextRunAt });
      cronPromptsStore.settleRun({ runId, status: 'failed_to_dispatch', error: `provider not supported`, failureKind: 'permanent' });
      cronPromptsStore.markDispatchFailed(task.id, 'permanent', backoffOpts);
      cronPromptsStore.recordRun(task.id, null);
      return null;
    }
    // resume 模式:唤醒绑定的既有会话追加 turn(Codex 线程唤醒语义);
    // new 模式:mint 一个全新 app session,冷启动。
    let appSessionId: string;
    let providerSessionId: string | undefined;
    let cwd: string;
    if (task.sessionMode === 'resume') {
      const bound = task.boundSessionId
        ? sessionsDb.getSessionById(task.boundSessionId)
        : null;
      if (!bound) {
        log(`[cron-prompts] bound session not found (task=${task.name}, session=${task.boundSessionId})`);
        onStarted?.({ sessionId: null, error: `bound session "${task.boundSessionId}" not found` });
        cronPromptsStore.insertRun({ runId, taskId: task.id, trigger, scheduledAt: task.nextRunAt });
        cronPromptsStore.settleRun({ runId, status: 'failed_to_dispatch', error: 'bound session not found', failureKind: 'permanent' });
        cronPromptsStore.markDispatchFailed(task.id, 'permanent', backoffOpts);
        cronPromptsStore.recordRun(task.id, null);
        return null;
      }
      if (bound.provider !== task.provider) {
        log(`[cron-prompts] bound session provider mismatch: task=${task.provider}, session=${bound.provider}`);
        onStarted?.({
          sessionId: null,
          error: `bound session provider "${bound.provider}" does not match task provider "${task.provider}"`,
        });
        cronPromptsStore.insertRun({ runId, taskId: task.id, trigger, scheduledAt: task.nextRunAt });
        cronPromptsStore.settleRun({ runId, status: 'failed_to_dispatch', error: 'provider mismatch', failureKind: 'permanent' });
        cronPromptsStore.markDispatchFailed(task.id, 'permanent', backoffOpts);
        cronPromptsStore.recordRun(task.id, null);
        return null;
      }
      appSessionId = bound.session_id;
      providerSessionId = bound.provider_session_id ?? undefined;
      cwd = bound.project_path ?? task.projectPath ?? homedir();
    } else {
      appSessionId = '';
      providerSessionId = undefined;
      cwd = task.projectPath || homedir();
    }
    if (!existsSync(cwd)) {
      log(`[cron-prompts] projectPath does not exist: ${cwd} (task=${task.name})`);
      onStarted?.({ sessionId: null, error: `project path does not exist: ${cwd}` });
      cronPromptsStore.insertRun({ runId, taskId: task.id, trigger, scheduledAt: task.nextRunAt });
      cronPromptsStore.settleRun({ runId, status: 'failed_to_dispatch', error: `project path missing: ${cwd}`, failureKind: 'transient' });
      // 路径缺失可能是移动盘/网络盘临时不可达 → transient 重试。
      const retry = cronPromptsStore.markDispatchFailed(task.id, 'transient', backoffOpts);
      if (retry) scheduleRetry(task.id, retry);
      cronPromptsStore.recordRun(task.id, null);
      return null;
    }
    cronPromptsStore.insertRun({ runId, taskId: task.id, trigger, scheduledAt: task.nextRunAt });

    if (!appSessionId) {
      appSessionId = sessionsService.createAppSession(task.provider as LLMProvider, cwd).sessionId;
    }
    const run = chatRunRegistry.startRun({
      appSessionId,
      provider: task.provider as LLMProvider,
      providerSessionId: providerSessionId ?? null,
      connection: STUB_CONNECTION,
      userId: null,
    });
    if (!run) {
      log(`[cron-prompts] session busy, skip run (task=${task.id})`);
      onStarted?.({ sessionId: null, error: 'session busy, skipped this run' });
      cronPromptsStore.settleRun({ runId, status: 'failed_to_dispatch', error: 'session busy', failureKind: 'transient' });
      const retry = cronPromptsStore.markDispatchFailed(task.id, 'transient', backoffOpts);
      if (retry) scheduleRetry(task.id, retry);
      cronPromptsStore.recordRun(task.id, null);
      return null;
    }
    // 派发到 provider 成功(会话已建立、run 已注册)——清退避状态。
    cronPromptsStore.markDispatchSucceeded(task.id);
    cronPromptsStore.settleRun({ runId, status: 'dispatched', sessionId: appSessionId });
    // The app session id exists before the provider finishes (or even
    // reports its own provider session id) — hand it back immediately so
    // "Run now" callers can navigate to the run.
    onStarted?.({ sessionId: appSessionId });

    const writer = new CronRunWriter();
    try {
      // Fire-and-forget with a bounded wait: a hung provider runtime (dead
      // cwd, stuck CLI) must not block the caller forever.
      void Promise.resolve(spawnFn(task.prompt, {
        // resume 模式传 provider-native id(与 chat.send 的 resume 语义一致);
        // new 模式为 undefined,让 runtime 起新会话并回报 provider id。
        sessionId: providerSessionId,
        resume: Boolean(providerSessionId),
        cwd: cwd,
        projectPath: cwd,
        permissionMode: task.permissionMode,
      }, writer)).catch((e: unknown) => {
        log(`[cron-prompts] run failed: ${e instanceof Error ? e.message : String(e)}`);
        writer.send({ kind: 'error', content: String(e instanceof Error ? e.message : e) });
      });
      await writer.waitComplete(RUN_TIMEOUT_MS);
    } finally {
      writer.dispose();
      chatRunRegistry.completeRun(appSessionId, { exitCode: 0 });
      cronPromptsStore.recordRun(task.id, appSessionId);
      sendInboxNotification(task, appSessionId);
    }

    // 2026-10-22: context limit 自动轮换——resume 会话膨胀超限后
    // Claude Code 原生 compaction 也失败(Prompt is too long)，
    // 此时自动创建新会话并注入旧会话末尾消息摘要，更新绑定，
    // 让后续轮次在新会话上继续执行。
    if (writer.lastError && writer.lastError.includes('Prompt is too long') && task.sessionMode === 'resume') {
      log(`[cron-prompts] context limit hit, rotating session (task=${task.name}, old=${appSessionId})`);
      try {
        // 拉旧会话最后几条消息做摘要
        const msgResp = await fetch(
          `http://localhost:${process.env.SERVER_PORT ?? 3000}/api/providers/sessions/${appSessionId}/messages?limit=15`,
        );
        const msgData = await msgResp.json();
        const msgs: Array<{ role?: string; content?: string }> =
          msgData?.data?.messages ?? msgData?.data ?? [];
        const summaryLines = msgs
          .filter((m) => m.content)
          .slice(-10)
          .map((m) => `[${m.role ?? '?'}] ${String(m.content).slice(0, 200)}`);
        const summary = summaryLines.length
          ? `以下是上一轮工作的上下文摘要：\n${summaryLines.join('\n')}`
          : '';

        // 创建新会话并改绑
        const newApp = sessionsService.createAppSession(
          task.provider as LLMProvider,
          cwd,
        ).sessionId;
        cronPromptsStore.update(task.id, {
          sessionMode: 'resume',
          boundSessionId: newApp,
        });
        log(`[cron-prompts] rotated to new session ${newApp} (task=${task.name})`);

        // 用新会话重发本轮 prompt（附摘要）
        const retryPrompt = summary
          ? `[上下文轮换] 以下是前一轮的结论摘要：\n${summary}\n\n---\n\n${task.prompt}`
          : task.prompt;
        const newRun = chatRunRegistry.startRun({
          appSessionId: newApp,
          provider: task.provider as LLMProvider,
          providerSessionId: null,
          connection: STUB_CONNECTION,
          userId: null,
        });
        if (newRun) {
          const retryWriter = new CronRunWriter();
          try {
            void Promise.resolve(spawnFn(retryPrompt, {
              cwd,
              projectPath: cwd,
              permissionMode: task.permissionMode,
            }, retryWriter)).catch(() => {});
            await retryWriter.waitComplete(RUN_TIMEOUT_MS);
          } finally {
            retryWriter.dispose();
            chatRunRegistry.completeRun(newApp, { exitCode: 0 });
            cronPromptsStore.recordRun(task.id, newApp);
          }
        }
      } catch (rotateErr) {
        log(`[cron-prompts] rotation failed: ${rotateErr instanceof Error ? rotateErr.message : String(rotateErr)}`);
      }
    }

    return appSessionId;
  }

  const backoffOpts = { baseMs: DISPATCH_RETRY_BASE_MS, capMs: DISPATCH_RETRY_CAP_MS, maxAttempts: DISPATCH_RETRY_MAX_ATTEMPTS };
  const retryTimers = new Map<string, NodeJS.Timeout>();

  /** 安排一次退避重试(重读任务,可能已被禁用/删除)。 */
  function scheduleRetry(taskId: string, retryAt: string): void {
    const existing = retryTimers.get(taskId);
    if (existing) clearTimeout(existing);
    const due = parseUtcBare(retryAt) - Date.now();
    const timer = setTimeout(() => {
      retryTimers.delete(taskId);
      const fresh = cronPromptsStore.getById(taskId);
      if (!fresh || !fresh.enabled) return;
      log(`[cron-prompts] retry dispatch (task=${fresh.name}, attempt=${fresh.dispatchAttempts + 1})`);
      runTaskGuarded(fresh, 'schedule');
    }, Math.max(due, 1000));
    timer.unref?.();
    retryTimers.set(taskId, timer);
  }

  /** 解析 SQLite UTC 裸串为毫秒。 */
  function parseUtcBare(value: string): number {
    const naive = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})$/.exec(value.trim());
    if (naive) {
      return Date.UTC(Number(naive[1]), Number(naive[2]) - 1, Number(naive[3]), Number(naive[4]), Number(naive[5]), Number(naive[6]));
    }
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : Date.now();
  }

  function runTaskGuarded(task: CronPromptTask, trigger: 'schedule' | 'manual' | 'catch-up' = 'schedule') {
    if (running.has(task.id)) {
      log(`[cron-prompts] task ${task.name} still running, skipping trigger`);
      return;
    }
    running.add(task.id);
    void executeTask(task, undefined, trigger)
      .catch((e) => log(`[cron-prompts] task ${task.name} error: ${e?.message ?? e}`))
      .finally(() => running.delete(task.id));
  }

  function register(task: CronPromptTask) {
    if (!task.enabled) return;
    // completed 终态不再注册调度(ZCode 语义:不可被 reload 复活)。
    if (task.lifecycleStatus === 'completed') return;
    if (!cron.validate(task.cronExpression)) {
      log(`[cron-prompts] invalid cron "${task.cronExpression}" (task=${task.name})`);
      return;
    }
    const handle = cron.schedule(task.cronExpression, () => {
      const fresh = cronPromptsStore.getById(task.id);
      if (!fresh || !fresh.enabled) return;
      log(`[cron-prompts] fired: ${fresh.name}`);
      advanceNextRunAt(fresh);
      runTaskGuarded(fresh);
    });
    scheduled.set(task.id, handle);
    // 首次注册(无持久化计划点)时初始化;已存在的值保留给 catch-up 扫描判定,
    // 否则 reload 会先覆盖掉"错过的计划点",补跑永远不会触发。
    if (!task.nextRunAt) advanceNextRunAt(task);
  }

  /** 把 next_run_at 推进到 now 之后的下一个计划点并持久化。 */
  function advanceNextRunAt(task: CronPromptTask): void {
    try {
      // v4 node-cron 没有 scheduled:false 选项;创建即启动,算完立刻 stop。
      // timeMatcher.getNextMatch(date) 与调度器用同一匹配器,语义一致。
      const probe = cron.schedule(task.cronExpression, () => {}, { unref: true }) as
        ReturnType<typeof cron.schedule> & { timeMatcher: { getNextMatch(date: Date): Date } };
      try {
        const nextMs = nextScheduledRunMs(task.cronExpression, Date.now(), (expression, date) => {
          if (expression !== task.cronExpression) return null;
          // timeMatcher 只算 > date 的下一个匹配(与调度器语义一致)。
          return probe.timeMatcher.getNextMatch(date) as Date;
        });
        if (nextMs !== null) cronPromptsStore.setNextRunAt(task.id, formatUtcSqlite(nextMs));
      } finally {
        probe.stop();
      }
    } catch (err) {
      log(`[cron-prompts] advance next_run_at failed (task=${task.name}): ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  /** 启动时补跑:错过计划点(停机/睡眠)且在 7 天窗口内的任务,最多补一次。 */
  function runCatchUpScan(): void {
    const tasks = cronPromptsStore.list();
    for (const task of tasks) {
      const decision = shouldCatchUp(task);
      if (!decision.shouldCatchUp) continue;
      log(`[cron-prompts] catch-up: ${task.name} (missed ${task.nextRunAt})`);
      // 补跑后立即推进到 now 之后的计划点,防止重复补跑。
      advanceNextRunAt(task);
      runTaskGuarded(task, 'catch-up');
    }
  }

  return {
    start() {
      this.reload();
      runCatchUpScan();
    },
    reload() {
      for (const handle of scheduled.values()) handle.stop();
      scheduled.clear();
      for (const task of cronPromptsStore.list()) register(task);
      log(`[cron-prompts] ${scheduled.size} schedule(s) active`);
    },
    stop() {
      for (const handle of scheduled.values()) handle.stop();
      scheduled.clear();
      for (const timer of retryTimers.values()) clearTimeout(timer);
      retryTimers.clear();
    },
    async runNow(taskId) {
      const task = cronPromptsStore.getById(taskId);
      if (!task) return { sessionId: null, error: 'task not found' };
      if (running.has(task.id)) {
        return { sessionId: task.lastSessionId, error: 'task is already running' };
      }
      // Fire-and-forget: an agent turn can take minutes; hand back the app
      // session id as soon as it is minted so callers can navigate there.
      let resolveStarted!: (result: CronRunStartResult) => void;
      const started = new Promise<CronRunStartResult>((resolve) => { resolveStarted = resolve; });
      const wrapped = executeTask(task, (result) => resolveStarted(result), 'manual');
      void wrapped.catch(() => undefined);
      return await started;
    },
    setBroadcastSource(source) { broadcastSource = source; },
  };
}

export const cronPromptsDriver = createCronPromptsDriver();
