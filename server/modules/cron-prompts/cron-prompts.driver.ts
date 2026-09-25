// server/modules/cron-prompts/cron-prompts.driver.ts
//
// 到点执行:为每次触发新建一个 app 会话并 spawn 对应 provider 执行 prompt。
// 复用 A2A inbound 的 S4 spawn 模式(chatRunRegistry 锁 + 静默 writer)——
// 会话会正常出现在侧边栏,产物落在 provider 自己的 transcript 里。

import { existsSync } from 'node:fs';

import * as cron from 'node-cron';

import { spawnFns, sessionsService } from '@/modules/providers/index.js';
import { homedir } from 'node:os';
import { chatRunRegistry } from '@/modules/websocket/index.js';
import type { LLMProvider, RealtimeClientConnection } from '@/shared/types.js';
import { broadcastTeamMessage } from '@/utils/kanban-websocket.js';
import { createTeamMessageStore } from '@/modules/team-messages/index.js';
import { projectsDb } from '@/modules/database/repositories/projects.db.js';
import { sessionsDb } from '@/modules/database/repositories/sessions.db.js';

import { formatUtcSqlite, nextScheduledRunMs, shouldCatchUp } from './catch-up.js';
import { cronPromptsStore, type CronPromptTask } from './cron-prompts.store.js';

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

  send(data: unknown): void {
    if (this.done) return;
    let msg: Record<string, any>;
    try {
      msg = typeof data === 'string' ? JSON.parse(data) : (data as Record<string, any>);
    } catch { return; }
    if (msg?.kind === 'complete' || msg?.kind === 'error') {
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
  ): Promise<string | null> {
    const spawnFn = spawnFns[task.provider as keyof typeof spawnFns];
    if (!spawnFn) {
      log(`[cron-prompts] provider "${task.provider}" not supported`);
      onStarted?.({ sessionId: null, error: `provider "${task.provider}" not supported` });
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
        cronPromptsStore.recordRun(task.id, null);
        return null;
      }
      if (bound.provider !== task.provider) {
        log(`[cron-prompts] bound session provider mismatch: task=${task.provider}, session=${bound.provider}`);
        onStarted?.({
          sessionId: null,
          error: `bound session provider "${bound.provider}" does not match task provider "${task.provider}"`,
        });
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
      cronPromptsStore.recordRun(task.id, null);
      return null;
    }

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
      cronPromptsStore.recordRun(task.id, null);
      return null;
    }
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
    return appSessionId;
  }

  function runTaskGuarded(task: CronPromptTask) {
    if (running.has(task.id)) {
      log(`[cron-prompts] task ${task.name} still running, skipping trigger`);
      return;
    }
    running.add(task.id);
    void executeTask(task)
      .catch((e) => log(`[cron-prompts] task ${task.name} error: ${e?.message ?? e}`))
      .finally(() => running.delete(task.id));
  }

  function register(task: CronPromptTask) {
    if (!task.enabled) return;
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
      runTaskGuarded(task);
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
      const wrapped = executeTask(task, (result) => resolveStarted(result));
      void wrapped.catch(() => undefined);
      return await started;
    },
    setBroadcastSource(source) { broadcastSource = source; },
  };
}

export const cronPromptsDriver = createCronPromptsDriver();
