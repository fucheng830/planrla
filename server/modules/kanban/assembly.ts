import path from 'node:path';
import os from 'node:os';

import { getConnection, projectsDb } from '@/modules/database/index.js';
import { createTaskStore } from '@/modules/kanban/store.js';
import { createTemplateStore } from '@/modules/kanban/template-store.js';
import { createScheduleStore } from '@/modules/kanban/schedule-store.js';
import { createKanbanCron } from '@/modules/kanban/cron-driver.js';
import { createKanbanService } from '@/modules/kanban/service.js';
import { createScheduler } from '@/modules/kanban/scheduler.js';
import { createKanbanRouter } from '@/modules/kanban/kanban.routes.js';
import { SDLC_DEFAULT_SEED_VERSION, buildSdlcDefaultTemplate, migrateSdlcDefaultSeed } from '@/modules/kanban/sdlc-default-template.js';
import { createAuxBridge } from '@/modules/kanban/aux-bridge.js';
import { createRunner } from '@/modules/kanban/runner.js';
import { createWorktreeGit } from '@/modules/kanban/git-worktree.js';
import { createWorktreeSetup } from '@/modules/kanban/worktree-setup.js';
import { resolveToolApproval } from '@/claude-sdk.js';
import type { Task } from '@/modules/kanban/types.js';
import { backgroundTaskRegistry } from '@/modules/background-tasks/index.js';
import { recordTombstone } from '@/modules/sync/index.js';
import { sessionsService } from '@/modules/providers/index.js';
import type { LLMProvider } from '@/shared/types.js';

let cached: ReturnType<typeof buildKanban> | null = null;

export function getKanban() {
  if (cached) return cached;
  cached = buildKanban();
  return cached;
}

// Broadcast hook for runner/scheduler-driven task changes (REQ-034). The WS
// server does not exist when buildKanban() runs, so index.js registers the
// real broadcaster after listen via setTaskBroadcaster; until then emits are
// no-ops (route-driven mutations already broadcast themselves).
let taskBroadcaster: ((rootId: string, task: Task) => void) | null = null;

// REQ-046:templateStore 引用,emitTaskChanged 推 registry 时查 stageTotal。
// buildKanban() 里赋值;在此之前为 undefined(emitTaskChanged 容错跳过)。
let templateStoreRef: ReturnType<typeof createTemplateStore> | null = null;

function emitTaskChanged(task: Task): void {
  if (!taskBroadcaster) return;
  try {
    taskBroadcaster(task.rootId, task);
  } catch {
    // Broadcast must never break the runner.
  }
  // REQ-046 §13 ② — 顺带把 kanban task 推给统一后台任务 registry(REQ-034 aux 实时)。
  // best-effort:registry 内部容错,失败不影响 kanban。
  try {
    const tpl = templateStoreRef?.getTaskTemplate(task.taskTemplateId);
    const stageTotal = tpl?.stages?.length;
    backgroundTaskRegistry.upsertKanban({
      taskId: task.id,
      rootId: task.rootId,
      title: task.taskTemplateName || `Task #${task.taskNumber}`,
      status: task.status,
      stage: task.currentStageIndex + 1,
      stageTotal,
      aux: task.auxFlags,
    });
  } catch {
    /* registry 容错 */
  }
}

function buildKanban() {
  const db = getConnection();
  const taskStore = createTaskStore({ db });
  // 模板目录:planrla 用户配置目录,createTemplateStore 会在其下
  // 自动创建 kanban-templates 子目录(见 TPL_SUBDIR)
  const templateDir = path.join(os.homedir(), '.planrla');
  const templateStore = createTemplateStore({ dir: templateDir });
  // kanban agent 会话不经 chat websocket,chatRunRegistry 看不到它们——把
  // running 任务的 provider 会话注册进 /sessions/running 聚合,侧栏/消息盒子
  // 才能显示运行中状态(解析不到 app 会话时静默跳过,如会话尚未被同步建档)。
  sessionsService.registerExternalRunningSessions(() => {
    const out: Array<{ sessionId: string; provider: LLMProvider; startedAt: number; lastSeq: number }> = [];
    for (const task of taskStore.listAllTasks()) {
      if (task.status !== 'running' || !task.providerSessionId) continue;
      const tpl = templateStore.getTaskTemplate(task.taskTemplateId);
      const agentStages = tpl?.stages.filter((s) => s.snapshot.role === 'agent') ?? [];
      const candidates = [
        ...new Set([...agentStages.map((s) => s.snapshot.agent).filter(Boolean), 'claude', 'codex'] as LLMProvider[]),
      ];
      for (const provider of candidates) {
        const appSessionId = sessionsService.resolveAppSessionIdByProviderSessionId(provider, task.providerSessionId!);
        if (appSessionId) {
          out.push({
            sessionId: appSessionId,
            provider,
            startedAt: Date.parse(task.updatedAt) || Date.now(),
            lastSeq: 0,
          });
          break;
        }
      }
    }
    return out;
  });
  // First run: seed a default SDLC template so task creation works out of the
  // box — an empty template dir leaves the workflow board unable to create
  // anything. All stages default to manual advance; agent stages only run
  // after a human explicitly moves a task into them.
  //
  // 已有磁盘模板环境走 seedVersion 定向迁移(模板定义单源在
  // sdlc-default-template.ts):只升级仍等于旧版原文的 stage prompt,用户
  // 自改过的 stage 原样保留并在日志点名,保证幂等。
  if (templateStore.listTaskTemplates().length === 0) {
    templateStore.saveTaskTemplate(buildSdlcDefaultTemplate(new Date().toISOString()));
  } else {
    const existingSdlc = templateStore.getTaskTemplate('sdlc-default');
    if (existingSdlc && (existingSdlc.seedVersion ?? 1) < SDLC_DEFAULT_SEED_VERSION) {
      const { tpl, upgraded, skipped } = migrateSdlcDefaultSeed(existingSdlc);
      templateStore.saveTaskTemplate(tpl);
      console.log(`[kanban-seed] sdlc-default migrated to seedVersion ${SDLC_DEFAULT_SEED_VERSION}`
        + ` (upgraded: ${upgraded.join(',') || 'none'}; kept user edits: ${skipped.join(',') || 'none'})`);
    }
  }
  templateStoreRef = templateStore;
  const resolveRootPath = (rootId: string): string | null => projectsDb.getProjectPathById(rootId);
  // W4: worktree setup. mcpBaseUrl mirrors index.js SERVER_PORT default (env contract).
  const serverPort = process.env.SERVER_PORT || '3001';
  const mcpBaseUrl = process.env.PLANRLA_KANBAN_MCP_URL ?? `http://127.0.0.1:${serverPort}/api/mcp/kanban`;
  const worktreeSetup = createWorktreeSetup({
    store: taskStore,
    git: createWorktreeGit(),
    mcpBaseUrl,
    log: (m) => console.log(m),
  });
  const service = createKanbanService({
    taskStore,
    templateStore,
    onTerminal: (task) => {
      // success 保留 worktree:交付物(分支+diff+DELIVERY.md)要留给用户评审;
      // fail/cancel 的现场没有保留价值,照旧清理。resolveRootPath mirrors the runner's cwd resolution
      if (task.status === 'success') return;
      void worktreeSetup.removeWorktree(task, resolveRootPath(task.rootId))
        .catch((e) => console.error('[kanban-worktree] terminal cleanup failed:', e));
    },
    onDeleteTask: (taskId, rootId) => {
      // Record a tombstone so team sync propagates the deletion to teammates.
      try {
        recordTombstone(db, taskId, rootId);
      } catch (e) {
        console.error('[kanban-sync] tombstone record failed:', e);
      }
    },
  });

  // REQ-046: the background-task registry is in-memory — rehydrate rows for
  // non-terminal tasks on startup so the panel survives backend restarts
  // (running tasks would otherwise vanish and never re-emit).
  try {
    for (const task of taskStore.listAllTasks()) {
      if (task.status === 'success' || task.status === 'fail' || task.status === 'cancelled') continue;
      const tpl = templateStore.getTaskTemplate(task.taskTemplateId);
      backgroundTaskRegistry.upsertKanban({
        taskId: task.id,
        rootId: task.rootId,
        title: task.taskTemplateName || `Task #${task.taskNumber}`,
        status: task.status,
        stage: task.currentStageIndex + 1,
        stageTotal: tpl?.stages?.length,
        aux: task.auxFlags,
      });
    }
  } catch (e) {
    console.error('[kanban-registry] startup rehydrate failed:', e);
  }
  const auxBridge = createAuxBridge({
    updateAuxFlags: (taskId, flags) => {
      taskStore.updateTaskAuxFlags(taskId, flags);
      const updated = taskStore.getTask(taskId);
      if (updated) emitTaskChanged(updated);
    },
  });
  const runner = createRunner({ taskStore, templateStore, service, auxBridge, resolveRootPath, worktreeSetup, mcpBaseUrl, scheduler: () => scheduler, onTaskChanged: emitTaskChanged });
  const scheduler = createScheduler({
    taskStore,
    templateStore,
    onAdmit: (taskId: string) => {
      const task = taskStore.getTask(taskId);
      if (!task) return;
      const tpl = templateStore.getTaskTemplate(task.taskTemplateId);
      const stage = tpl?.stages[task.currentStageIndex]?.snapshot;
      if (!stage) return;
      emitTaskChanged(task);
      if (stage.role === 'agent' && stage.agent) {
        void runner.runAgentStage(task.rootId, taskId, task.currentStageIndex)
          .catch((e: any) => console.error('[kanban-runner]', e));
      } else if (stage.role === 'user' && stage.autoAdvance) {
        try { service.next(task.rootId, taskId); }
        catch (e) { console.error('[kanban auto-advance]', e); }
      }
    },
  });

  // Zombie recovery: agent runners are child processes — a backend restart
  // kills them mid-stage and nothing would ever resume or fail the task.
  // Requeue running tasks so the scheduler respawns the current stage. Roots
  // with queued-but-unadmitted tasks also get a schedule pass — otherwise a
  // restart after a fail leaves them queued forever (nothing would trigger
  // the scheduler again).
  try {
    const staleRoots = new Set<string>();
    for (const task of taskStore.listAllTasks()) {
      if (task.status === 'success' || task.status === 'fail' || task.status === 'cancelled') continue;
      if (task.status === 'running') {
        taskStore.updateTaskStatus(task.id, 'queued');
        taskStore.setSchedulerAdmitted(task.id, false);
      } else if (task.schedulerAdmitted) {
        // queued/waiting_user 却带着 admit 标志 = 中断遗留的不一致态(如超时
        // 自动重试曾直通 queued 不清标志)。不清掉,调度器会永远跳过它。
        taskStore.setSchedulerAdmitted(task.id, false);
      }
      staleRoots.add(task.rootId);
    }
    for (const rootId of staleRoots) scheduler.schedule(rootId);
  } catch (e) {
    console.error('[kanban] zombie requeue failed:', e);
  }
  // W4-extras: cron-driven schedules. scheduleStore persists schedules; cronDriver
  // registers them with node-cron.
  const scheduleStore = createScheduleStore({ db });
  const cronDriver = createKanbanCron({
    scheduleStore,
    service,
    scheduler,
    log: (m) => console.log(m),
  });
  // Register all enabled cron schedules on startup so they fire without waiting
  // for a schedule CRUD (which triggers reload()). getKanban() is lazy (first
  // /api/tasks request), so this runs on first kanban access — acceptable.
  try { cronDriver.start(); }
  catch (e: any) { console.error('[kanban-cron] start failed:', e?.message ?? e); }
  const router = createKanbanRouter({ service, taskStore, templateStore, scheduler, scheduleStore, cronDriver, resolveRootPath, runner, resolveToolApproval });
  return {
    db, taskStore, templateStore, scheduleStore, service, scheduler, runner, router,
    setTaskBroadcaster(fn: (rootId: string, task: Task) => void) {
      taskBroadcaster = fn;
    },
  };
}
