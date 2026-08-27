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

import { cronPromptsStore, type CronPromptTask } from './cron-prompts.store.js';

/** No-op websocket stub (same trick as A2A inbound): the cron path has no live peer. */
const STUB_CONNECTION: RealtimeClientConnection = {
  readyState: 3,
  send() { /* no live client */ },
};

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
  runNow(taskId: string): Promise<{ sessionId: string | null; error?: string }>;
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
  async function executeTask(task: CronPromptTask): Promise<string | null> {
    const spawnFn = spawnFns[task.provider as keyof typeof spawnFns];
    if (!spawnFn) {
      log(`[cron-prompts] provider "${task.provider}" not supported`);
      cronPromptsStore.recordRun(task.id, null);
      return null;
    }
    // 全局任务可不关联项目:未填时在用户主目录执行
    const cwd = task.projectPath || homedir();
    if (!existsSync(cwd)) {
      log(`[cron-prompts] projectPath does not exist: ${cwd} (task=${task.name})`);
      cronPromptsStore.recordRun(task.id, null);
      return null;
    }

    const { sessionId } = sessionsService.createAppSession(task.provider as LLMProvider, cwd);
    const run = chatRunRegistry.startRun({
      appSessionId: sessionId,
      provider: task.provider as LLMProvider,
      providerSessionId: null,
      connection: STUB_CONNECTION,
      userId: null,
    });
    if (!run) {
      log(`[cron-prompts] session busy, skip run (task=${task.id})`);
      cronPromptsStore.recordRun(task.id, null);
      return null;
    }

    const writer = new CronRunWriter();
    try {
      // Fire-and-forget with a bounded wait: a hung provider runtime (dead
      // cwd, stuck CLI) must not block the caller forever.
      void Promise.resolve(spawnFn(task.prompt, {
        sessionId: undefined,
        cwd: cwd,
        projectPath: cwd,
        permissionMode: 'bypassPermissions',
      }, writer)).catch((e: unknown) => {
        log(`[cron-prompts] run failed: ${e instanceof Error ? e.message : String(e)}`);
        writer.send({ kind: 'error', content: String(e instanceof Error ? e.message : e) });
      });
      await writer.waitComplete(RUN_TIMEOUT_MS);
    } finally {
      writer.dispose();
      chatRunRegistry.completeRun(sessionId, { exitCode: 0 });
      cronPromptsStore.recordRun(task.id, sessionId);
      sendInboxNotification(task, sessionId);
    }
    return sessionId;
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
      runTaskGuarded(fresh);
    });
    scheduled.set(task.id, handle);
  }

  return {
    start() { this.reload(); },
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
      // Fire-and-forget: an agent turn can take minutes; respond immediately
      // and let the run record itself on completion.
      runTaskGuarded(task);
      return { sessionId: null, started: true };
    },
    setBroadcastSource(source) { broadcastSource = source; },
  };
}

export const cronPromptsDriver = createCronPromptsDriver();
