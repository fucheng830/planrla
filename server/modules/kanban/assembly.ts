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
import { createAuxBridge } from '@/modules/kanban/aux-bridge.js';
import { createRunner } from '@/modules/kanban/runner.js';
import { createWorktreeGit } from '@/modules/kanban/git-worktree.js';
import { createWorktreeSetup } from '@/modules/kanban/worktree-setup.js';
import { resolveToolApproval } from '@/claude-sdk.js';
import type { Task, TaskTemplate } from '@/modules/kanban/types.js';
import { backgroundTaskRegistry } from '@/modules/background-tasks/index.js';
import { recordTombstone } from '@/modules/sync/index.js';

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
  // First run: seed a default SDLC template so task creation works out of the
  // box — an empty template dir leaves the workflow board unable to create
  // anything. All stages default to manual advance; agent stages only run
  // after a human explicitly moves a task into them.
  if (templateStore.listTaskTemplates().length === 0) {
    const now = new Date().toISOString();
    const stage = (id: string, name: string, role: 'user' | 'agent', promptTemplate?: string): TaskTemplate['stages'][number]['snapshot'] => ({
      id, name, role, autoAdvance: false, ...(role === 'agent' ? { agent: 'claude', agentCanControlStage: true } : {}), ...(promptTemplate ? { promptTemplate } : {}), createdAt: now, updatedAt: now,
    });
    templateStore.saveTaskTemplate({
      id: 'sdlc-default',
      name: '研发流程(需求 → 交付)',
      maxConcurrency: 1,
      createdAt: now,
      updatedAt: now,
      stages: [
        { id: 'st0', position: 0, snapshot: stage('ss0', '需求设计', 'user') },
        { id: 'st1', position: 1, snapshot: stage('ss1', '技术方案', 'agent', '需求:\n{input}\n\n请产出技术方案设计:架构选型、改动点、风险。') },
        { id: 'st2', position: 2, snapshot: stage('ss2', '开工', 'agent', '{input}\n\n按已确认的技术方案实施开发。') },
        { id: 'st3', position: 3, snapshot: stage('ss3', '测试验证', 'agent', '{input}\n\n运行测试与验证,输出验证记录。') },
        { id: 'st4', position: 4, snapshot: stage('ss4', '交付', 'agent', '{input}\n\n整理交付说明与 changelog。') },
      ],
    });
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
      // best-effort worktree cleanup; resolveRootPath mirrors the runner's cwd resolution
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
  const auxBridge = createAuxBridge({
    updateAuxFlags: (taskId, flags) => {
      taskStore.updateTaskAuxFlags(taskId, flags);
      const updated = taskStore.getTask(taskId);
      if (updated) emitTaskChanged(updated);
    },
  });
  const runner = createRunner({ taskStore, templateStore, service, auxBridge, resolveRootPath, worktreeSetup, mcpBaseUrl, onTaskChanged: emitTaskChanged });
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
