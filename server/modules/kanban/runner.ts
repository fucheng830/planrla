// server/modules/kanban/runner.ts
//
// The kanban runner drives a single agent stage of a task. Given a taskId and
// stageIndex, it:
//   1. resolves the task + stage template,
//   2. resolves the cwd (worktreePath if set, else the root project path),
//   3. derives permissionMode from stage.planMode ("plan" | "default"),
//   4. looks up the provider's spawnFn by stage.agent,
//   5. builds a RunnerWriter that mirrors provider events into the aux bridge
//      and wires lifecycle hooks (session capture, complete → autoAdvance,
//      error → aux flag),
//   6. invokes spawnFn(prompt, opts, writer).
//
// spawnFns is a DI parameter: tests inject mocks; production wires the real
// spawnFns map from @/modules/providers/spawn-fns.js.
//
// The provider's native sessionId is memoized per sessionKey (task.mainSessionKey
// or taskId) so a follow-up run on the same logical session resumes the
// provider session instead of starting fresh. The provider reports its
// sessionId through the writer (RunnerWriter.send/setSessionId →
// onProviderSessionId), and the runner feeds it back as opts.sessionId on the
// next invocation.

import { randomUUID } from 'node:crypto';

import type { TaskStore } from '@/modules/kanban/store.js';
import type { Task, TaskStatus } from '@/modules/kanban/types.js';
import { AppError } from '@/shared/utils.js';
import type { TemplateStore } from '@/modules/kanban/template-store.js';
import type { KanbanService } from '@/modules/kanban/service.js';
import type { AuxBridge } from '@/modules/kanban/aux-bridge.js';
import { RunnerWriter } from '@/modules/kanban/runner-writer.js';
import { spawnFns as defaultSpawnFns } from '@/modules/providers/index.js';
import type { SpawnFn } from '@/modules/providers/index.js';
import { renderStagePrompt } from '@/modules/kanban/prompt.js';
import type { WorktreeSetup } from '@/modules/kanban/worktree-setup.js';

export interface RunnerDeps {
  taskStore: TaskStore;
  templateStore: TemplateStore;
  service: KanbanService;
  auxBridge: AuxBridge;
  /** Resolve a rootId (planrla projects.project_id) to its filesystem path. */
  resolveRootPath: (rootId: string) => string | null;
  /** Provider spawn map keyed by StageTemplate.agent. Defaults to the real spawnFns. */
  spawnFns?: Record<string, SpawnFn>;
  /** W4: kanban-level worktree orchestrator (lazy, idempotent). Optional for back-compat. */
  worktreeSetup?: WorktreeSetup;
  /** Timeout auto-retry re-enqueues the task and wakes the scheduler. Optional:
   *  tests without a scheduler skip the auto-retry path. */
  scheduler?: { schedule(rootId: string): void } | (() => { schedule(rootId: string): void } | undefined);
  /** W4: kanban MCP base URL, injected as an mcpServer so the agent can self-drive
   *  via task_next/task_status. If unset, no kanban MCP is injected. */
  mcpBaseUrl?: string;
  /** Max wall-clock ms for a single agent stage before the runner fails it. Defends
   *  against provider spawn hangs (e.g. Claude SDK hanging silently when the CLI
   *  binary is missing — no message ever reaches the writer, so onComplete/onError
   *  never fire and the task would otherwise stay "running" forever). Default 30 min. */
  stageTimeoutMs?: number;
  /** Called whenever the runner changes a task (status transitions, aux flags,
   *  session capture) so the assembly can broadcast it (REQ-034). */
  onTaskChanged?: (task: Task) => void;
  log?: (msg: string) => void;
}

export function createRunner(deps: RunnerDeps) {
  const {
    taskStore,
    templateStore,
    service,
    auxBridge,
    resolveRootPath,
    spawnFns = defaultSpawnFns,
    worktreeSetup,
    mcpBaseUrl,
    scheduler: schedulerDep,
    stageTimeoutMs = Number(process.env.KANBAN_STAGE_TIMEOUT_MS) || 60 * 60 * 1000,
    onTaskChanged,
    log = () => {},
  } = deps;

  // sessionKey → provider native sessionId. Lets a follow-up run resume the
  // provider session the first run established. Seeded from the persisted
  // task.providerSessionId so resume survives process restarts.
  const sessionMap = new Map<string, string>();

  // REQ-037: env keys stripped from provider spawns (e.g. GLM proxy vars like
  // ANTHROPIC_BASE_URL that collapse tool-heavy kanban runs). Configured via
  // KANBAN_STRIP_ENV_KEYS=comma,separated,keys; empty by default.
  const envStrip = (process.env.KANBAN_STRIP_ENV_KEYS ?? '')
    .split(',')
    .map((key) => key.trim())
    .filter(Boolean);

  /** Append an audit event to task_events (best-effort — never break a run).
   * Mirrors the service's helper; the runner owns agent-lifecycle events. */
  function recordEvent(taskId: string, type: string, payload?: Record<string, unknown>): void {
    try {
      taskStore.insertTaskEvent({
        id: randomUUID(), taskId, type,
        payloadJson: payload ? JSON.stringify(payload) : undefined,
        createdAt: new Date().toISOString(),
      });
    } catch (e) {
      log(`[kanban-events] insert failed: ${e}`);
    }
  }

  function emitTask(taskId: string): void {
    const current = taskStore.getTask(taskId);
    if (current) onTaskChanged?.(current);
  }

  async function runAgentStage(rootId: string, taskId: string, stageIndex: number): Promise<void> {
    const task = taskStore.getTask(taskId);
    if (!task) throw new Error(`task ${taskId} not found`);
    const tpl = templateStore.getTaskTemplate(task.taskTemplateId);
    if (!tpl) throw new Error(`template ${task.taskTemplateId} not found`);
    const stage = tpl.stages[stageIndex]?.snapshot;
    if (!stage || stage.role !== 'agent' || !stage.agent) {
      throw new Error(`invalid agent stage at index ${stageIndex}`);
    }

    const sessionKey = task.mainSessionKey ?? taskId;
    let providerSessionId = sessionMap.get(sessionKey);
    if (!providerSessionId && task.providerSessionId) {
      providerSessionId = task.providerSessionId;
      sessionMap.set(sessionKey, providerSessionId);
    }
    const rootPath = resolveRootPath(rootId);
    const permissionMode: 'plan' | 'bypassPermissions' = stage.planMode ? 'plan' : 'bypassPermissions';

    // W4: ensure worktree (lazy, idempotent) before resolving cwd. If the
    // orchestrator is absent (legacy callers/tests), fall back to the task's
    // persisted worktreePath or the root project path.
    let cwd: string | undefined;
    if (worktreeSetup) {
      const wt = await worktreeSetup.ensureWorktree(task, rootPath);
      if (!wt) throw new Error('worktree 创建失败:拒绝在主仓直接执行 agent(防污染用户仓库)');
      cwd = wt;
    } else {
      cwd = task.worktreePath ?? rootPath ?? undefined;
    }

    // W4: rendered prompt (variable substitution + MCP self-drive preamble).
    // `{{input}}` resolves from the current stage run's input; when an agent
    // stage is reached via autoAdvance from a user stage, the agent run has no
    // input of its own, so fall back to the task's original (stage 0) input.
    const run = taskStore.latestStageRun(taskId, stageIndex);
    const input = run?.input ?? (stageIndex > 0 ? (taskStore.latestStageRun(taskId, 0)?.input ?? '') : '');
    // 验收返工:feedback 由 rework 写入,这里消费一次。有反馈时只发送返工指令
    // (provider 会话延续,agent 拿着上一轮上下文按反馈改),不重发整段阶段 prompt。
    const reworkFeedback = taskStore.consumeReworkFeedback(taskId);
    const prompt = reworkFeedback
      ? [
          '你上一轮交付的工作未通过人工验收,需要返工。',
          '请在当前工作区继续,根据下面的验收反馈修改实现;完成后重新输出交付总结' + (stage.promptTemplate?.includes('DELIVERY.md') ? ',并同步更新 DELIVERY.md。' : '。'),
          '',
          '验收反馈:',
          reworkFeedback,
        ].join('\n')
      : renderStagePrompt({
          stage,
          ctx: {
            taskId: task.id,
            taskNumber: task.taskNumber,
            stageName: stage.name,
            stageIndex,
            rootPath,
            input,
          },
        });
    const spawnFn = spawnFns[stage.agent];
    if (!spawnFn) throw new Error(`unknown provider: ${stage.agent}`);

    log(`[kanban-runner] start task=${taskId} stage=${stageIndex} agent=${stage.agent} cwd=${cwd ?? '<none>'}${reworkFeedback ? ' (rework)' : ''}`);
    recordEvent(taskId, 'agent_stage_started', { stageIndex, agent: stage.agent, cwd, reworked: Boolean(reworkFeedback) });

    const writer = new RunnerWriter({
      taskId,
      auxBridge,
      onProviderSessionId: (sid) => {
        sessionMap.set(sessionKey, sid);
        taskStore.updateProviderSessionId(taskId, sid);
      },
      onComplete: () => {
        log(`[kanban-runner] complete task=${taskId}`);
        recordEvent(taskId, 'agent_stage_completed', { stageIndex });
        emitTask(taskId);
        // If the agent already self-advanced via the task_next MCP tool (stageIndex moved
        // on) or the task reached a terminal state, do nothing — avoids double-advance.
        const cur = taskStore.getTask(taskId);
        const alreadyAdvanced = !cur || cur.currentStageIndex !== stageIndex;
        const terminal = cur && (cur.status === 'success' || cur.status === 'fail' || cur.status === 'cancelled');
        if (alreadyAdvanced || terminal) return;
        // Completion fallback: advance so the loop always progresses even when the MCP
        // self-drive tool wasn't discovered/used. Applies to autoAdvance stages and to
        // self-drive agent stages (agentCanControlStage !== false). Human-review agent
        // stages (agentCanControlStage === false) stay put for manual advance.
        if (stage.autoAdvance || stage.agentCanControlStage !== false) {
          try {
            service.next(rootId, taskId);
          } catch (e) {
            log(`[kanban-runner] complete-advance next failed: ${e}`);
          }
        }
      },
      onError: (m) => {
        taskStore.updateTaskAuxFlags(taskId, { sessionError: String(m?.message ?? m) });
        emitTask(taskId);
      },
    });

    let stageTimer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        spawnFn(prompt, {
          sessionId: providerSessionId,
          cwd,
          projectPath: cwd,
          model: stage.model,
          permissionMode,
          // REQ-037: opt into SDK hook_event liveness signals (UserPromptSubmit/Stop).
          emitHookEvents: true,
          envStrip: envStrip.length > 0 ? envStrip : undefined,
          mcpServers: mcpBaseUrl ? { 'planrla-kanban': { type: 'http', url: mcpBaseUrl } } : undefined,
          // REQ-043: goal stage 透传 goalCondition(→ claude-sdk.js → createKanbanClaudeHooks 挂 goal Stop hook)
          // + maxTurns(→ sdkOptions.maxTurns,SDK 原生截断 → error_max_turns reject → 现有 catch → fail)
          ...(stage.goalCondition ? {
            goalCondition: stage.goalCondition,
            maxTurns: stage.goalMaxTurns ?? 300,
          } : {}),
        }, writer),
        new Promise<never>((_, reject) => {
          stageTimer = setTimeout(
            () => reject(new Error(`agent stage timed out after ${stageTimeoutMs}ms without completion`)),
            stageTimeoutMs,
          );
        }),
      ]);
    } catch (e: any) {
      // Provider hang / timeout / reject: never leave the task stuck in "running".
      // When a spawnFn neither resolves nor sends any writer message (e.g. Claude
      // SDK hanging when the CLI binary is missing), onComplete/onError never fire —
      // so we must fail the task ourselves to keep the board from wedging.
      taskStore.updateTaskAuxFlags(taskId, { sessionError: String(e?.message ?? e) });
      recordEvent(taskId, 'agent_stage_failed', { stageIndex, error: String(e?.message ?? e) });
      // 失败自动分级(确定性规则,非 LLM):超时类失败且本任务从未自动重试过
      // → 直接重排一次;语义类失败照常转人工。防止环境抖动把长研究烧成 fail。
      const errMsg = String(e?.message ?? e);
      const isTimeout = errMsg.includes('timed out');
      const alreadyAutoRetried = taskStore.listTaskEvents(taskId).some((e2) => e2.type === 'task_auto_retried');
      if (isTimeout && !alreadyAutoRetried) {
        recordEvent(taskId, 'task_auto_retried', { stageIndex, error: errMsg });
        taskStore.updateTaskAuxFlags(taskId, { sessionError: undefined });
        taskStore.clearProviderSessionId(taskId);
        taskStore.updateTaskStatus(taskId, 'queued');
        const scheduler = typeof schedulerDep === 'function' ? schedulerDep() : schedulerDep;
        scheduler?.schedule(rootId);
        log(`[kanban-runner] timeout auto-retry task=${taskId} stage=${stageIndex}`);
        return;
      }
      try {
        service.fail(rootId, taskId);
      } catch (failErr) {
        log(`[kanban-runner] post-fail service.fail error task=${taskId}: ${failErr}`);
      }
      log(`[kanban-runner] spawn failed/timeout task=${taskId}: ${e}`);
    } finally {
      if (stageTimer) clearTimeout(stageTimer);
    }
  }

  /**
   * Review loop: re-runs the current agent stage with a human review comment,
   * resuming the provider session the original stage run established (same
   * process only — the session map is in-memory). The task is marked running
   * while the review executes and its previous status is restored afterwards;
   * a review run never advances the stage.
   *
   * Returns the updated task immediately; `done` settles when the review run
   * finishes so callers can broadcast the restored state.
   */
  function startReviewComment(rootId: string, taskId: string, comment: string): { task: Task; done: Promise<void> } {
    const task = taskStore.getTask(taskId);
    if (!task) throw new AppError(`task ${taskId} not found`, { code: 'TASK_NOT_FOUND', statusCode: 404 });
    if (task.rootId !== rootId) {
      throw new AppError('task 不属于该 root', { code: 'TASK_ROOT_MISMATCH', statusCode: 403 });
    }

    const tpl = templateStore.getTaskTemplate(task.taskTemplateId);
    const stage = tpl?.stages[task.currentStageIndex]?.snapshot;
    if (!stage || stage.role !== 'agent' || !stage.agent) {
      throw new AppError('review comments require the current stage to be an agent stage', { code: 'REVIEW_REQUIRES_AGENT_STAGE', statusCode: 400 });
    }
    if (task.status === 'success' || task.status === 'fail' || task.status === 'cancelled') {
      throw new AppError('task is in terminal status', { code: 'TASK_TERMINAL', statusCode: 400 });
    }
    if (task.schedulerAdmitted) {
      throw new AppError('task is already running', { code: 'TASK_ALREADY_RUNNING', statusCode: 409 });
    }

    const trimmed = comment.trim();
    if (!trimmed) {
      throw new AppError('comment is required', { code: 'COMMENT_REQUIRED', statusCode: 400 });
    }

    const sessionKey = task.mainSessionKey ?? taskId;
    let providerSessionId = sessionMap.get(sessionKey);
    if (!providerSessionId && task.providerSessionId) {
      providerSessionId = task.providerSessionId;
      sessionMap.set(sessionKey, providerSessionId);
    }
    if (!providerSessionId) {
      throw new AppError('no live provider session for this task (only tasks run in this server process can be reviewed)', { code: 'NO_LIVE_SESSION', statusCode: 409 });
    }
    const spawnFn = spawnFns[stage.agent];
    if (!spawnFn) throw new AppError(`unknown provider: ${stage.agent}`, { code: 'UNKNOWN_PROVIDER', statusCode: 400 });

    const previousStatus = task.status;
    taskStore.updateTaskStage(taskId, task.currentStageIndex, 'running');
    recordEvent(taskId, 'review_submitted', { stageIndex: task.currentStageIndex, comment: trimmed.slice(0, 500) });

    const prompt = [
      'A human reviewer left the following feedback on your work in this workspace.',
      'Address the feedback now. Do not create git commits unless the reviewer asked you to.',
      '',
      trimmed,
    ].join('\n');

    const restoreStatus = () => {
      taskStore.updateTaskStage(taskId, task.currentStageIndex, previousStatus as TaskStatus);
      emitTask(taskId);
    };
    const writer = new RunnerWriter({
      taskId,
      auxBridge,
      onProviderSessionId: (sid: string) => {
        sessionMap.set(sessionKey, sid);
        taskStore.updateProviderSessionId(taskId, sid);
      },
      onComplete: restoreStatus,
      onError: (m: any) => {
        restoreStatus();
        taskStore.updateTaskAuxFlags(taskId, { sessionError: String(m?.message ?? m) });
      },
    });

    const cwd = task.worktreePath ?? resolveRootPath(rootId) ?? undefined;
    log(`[kanban-runner] review task=${taskId} stage=${task.currentStageIndex} agent=${stage.agent} cwd=${cwd ?? '<none>'}`);

    const done = (async () => {
      let stageTimer: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([
          spawnFn(prompt, {
            sessionId: providerSessionId,
            cwd,
            projectPath: cwd,
            model: stage.model,
            permissionMode: 'bypassPermissions',
            emitHookEvents: true, // REQ-037: SDK hook_event liveness signals
          } as any, writer),
          new Promise<never>((_, reject) => {
            stageTimer = setTimeout(
              () => reject(new Error(`review run timed out after ${stageTimeoutMs}ms without completion`)),
              stageTimeoutMs,
            );
          }),
        ]);
        // Backstop: a provider that resolves without a complete message still
        // restores the status (onComplete normally handles it first).
        restoreStatus();
      } catch (e: any) {
        restoreStatus();
        taskStore.updateTaskAuxFlags(taskId, { sessionError: String(e?.message ?? e) });
        log(`[kanban-runner] review failed task=${taskId}: ${e}`);
      } finally {
        if (stageTimer) clearTimeout(stageTimer);
      }
    })();

    return { task: taskStore.getTask(taskId)!, done };
  }

  return { runAgentStage, startReviewComment };
}

export type Runner = ReturnType<typeof createRunner>;
