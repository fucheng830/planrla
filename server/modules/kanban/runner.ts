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

import type { TaskStore } from '@/modules/kanban/store.js';
import type { TemplateStore } from '@/modules/kanban/template-store.js';
import type { KanbanService } from '@/modules/kanban/service.js';
import type { AuxBridge } from '@/modules/kanban/aux-bridge.js';
import { RunnerWriter } from '@/modules/kanban/runner-writer.js';
import { spawnFns as defaultSpawnFns } from '@/modules/providers/spawn-fns.js';
import type { SpawnFn } from '@/modules/providers/spawn-fns.js';
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
  /** W4: kanban MCP base URL, injected as an mcpServer so the agent can self-drive
   *  via task_next/task_status. If unset, no kanban MCP is injected. */
  mcpBaseUrl?: string;
  /** Max wall-clock ms for a single agent stage before the runner fails it. Defends
   *  against provider spawn hangs (e.g. Claude SDK hanging silently when the CLI
   *  binary is missing — no message ever reaches the writer, so onComplete/onError
   *  never fire and the task would otherwise stay "running" forever). Default 30 min. */
  stageTimeoutMs?: number;
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
    stageTimeoutMs = Number(process.env.KANBAN_STAGE_TIMEOUT_MS) || 30 * 60 * 1000,
    log = () => {},
  } = deps;

  // sessionKey → provider native sessionId. Lets a follow-up run resume the
  // provider session the first run established.
  const sessionMap = new Map<string, string>();

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
    const providerSessionId = sessionMap.get(sessionKey);
    const rootPath = resolveRootPath(rootId);
    const permissionMode: 'plan' | 'bypassPermissions' = stage.planMode ? 'plan' : 'bypassPermissions';

    // W4: ensure worktree (lazy, idempotent) before resolving cwd. If the
    // orchestrator is absent (legacy callers/tests), fall back to the task's
    // persisted worktreePath or the root project path.
    let cwd: string | undefined;
    if (worktreeSetup) {
      const wt = await worktreeSetup.ensureWorktree(task, rootPath);
      cwd = wt ?? rootPath ?? undefined;
    } else {
      cwd = task.worktreePath ?? rootPath ?? undefined;
    }

    // W4: rendered prompt (variable substitution + MCP self-drive preamble).
    // `{{input}}` resolves from the current stage run's input; when an agent
    // stage is reached via autoAdvance from a user stage, the agent run has no
    // input of its own, so fall back to the task's original (stage 0) input.
    const run = taskStore.latestStageRun(taskId, stageIndex);
    const input = run?.input ?? (stageIndex > 0 ? (taskStore.latestStageRun(taskId, 0)?.input ?? '') : '');
    const prompt = renderStagePrompt({
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

    log(`[kanban-runner] start task=${taskId} stage=${stageIndex} agent=${stage.agent} cwd=${cwd ?? '<none>'}`);

    const writer = new RunnerWriter({
      taskId,
      auxBridge,
      onProviderSessionId: (sid) => {
        sessionMap.set(sessionKey, sid);
      },
      onComplete: () => {
        log(`[kanban-runner] complete task=${taskId}`);
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
          mcpServers: mcpBaseUrl ? { 'planrla-kanban': { type: 'http', url: mcpBaseUrl } } : undefined,
        } as any, writer),
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

  return { runAgentStage };
}

export type Runner = ReturnType<typeof createRunner>;
