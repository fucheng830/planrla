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

export interface RunnerDeps {
  taskStore: TaskStore;
  templateStore: TemplateStore;
  service: KanbanService;
  auxBridge: AuxBridge;
  /** Resolve a rootId (planrla projects.project_id) to its filesystem path. */
  resolveRootPath: (rootId: string) => string | null;
  /** Provider spawn map keyed by StageTemplate.agent. Defaults to the real spawnFns. */
  spawnFns?: Record<string, SpawnFn>;
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
    // Prefer the task's worktree when one has been allocated; fall back to the
    // root project path; undefined lets the provider pick its own cwd.
    const cwd = task.worktreePath ?? rootPath ?? undefined;
    const permissionMode: 'plan' | 'default' = stage.planMode ? 'plan' : 'default';
    const prompt = stage.promptTemplate ?? '';
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
