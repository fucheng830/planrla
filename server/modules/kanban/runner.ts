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
    const permissionMode: 'plan' | 'default' = stage.planMode ? 'plan' : 'default';

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
        if (stage.autoAdvance) {
          try {
            service.next(rootId, taskId);
          } catch (e) {
            log(`[kanban-runner] auto-advance next failed: ${e}`);
          }
        }
      },
      onError: (m) => {
        taskStore.updateTaskAuxFlags(taskId, { sessionError: String(m?.message ?? m) });
      },
    });

    try {
      await spawnFn(prompt, {
        sessionId: providerSessionId,
        cwd,
        model: stage.model,
        permissionMode,
      } as any, writer);
    } catch (e: any) {
      taskStore.updateTaskAuxFlags(taskId, { sessionError: String(e?.message ?? e) });
      log(`[kanban-runner] spawn failed task=${taskId}: ${e}`);
    }
  }

  return { runAgentStage };
}

export type Runner = ReturnType<typeof createRunner>;
