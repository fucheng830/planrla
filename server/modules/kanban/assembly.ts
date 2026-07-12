import path from 'node:path';
import os from 'node:os';
import { getConnection, projectsDb } from '@/modules/database/index.js';
import { createTaskStore } from '@/modules/kanban/store.js';
import { createTemplateStore } from '@/modules/kanban/template-store.js';
import { createKanbanService } from '@/modules/kanban/service.js';
import { createScheduler } from '@/modules/kanban/scheduler.js';
import { createKanbanRouter } from '@/modules/kanban/kanban.routes.js';
import { createAuxBridge } from '@/modules/kanban/aux-bridge.js';
import { createRunner } from '@/modules/kanban/runner.js';
import { createWorktreeGit } from '@/modules/kanban/git-worktree.js';
import { createWorktreeSetup } from '@/modules/kanban/worktree-setup.js';

let cached: ReturnType<typeof buildKanban> | null = null;

export function getKanban() {
  if (cached) return cached;
  cached = buildKanban();
  return cached;
}

function buildKanban() {
  const db = getConnection();
  const taskStore = createTaskStore({ db });
  // 模板目录:planrla 用户配置目录,createTemplateStore 会在其下
  // 自动创建 kanban-templates 子目录(见 TPL_SUBDIR)
  const templateDir = path.join(os.homedir(), '.planrla');
  const templateStore = createTemplateStore({ dir: templateDir });
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
  });
  const auxBridge = createAuxBridge({ updateAuxFlags: taskStore.updateTaskAuxFlags });
  const runner = createRunner({ taskStore, templateStore, service, auxBridge, resolveRootPath, worktreeSetup });
  const scheduler = createScheduler({
    taskStore,
    templateStore,
    onAdmit: (taskId: string) => {
      const task = taskStore.getTask(taskId);
      if (!task) return;
      const tpl = templateStore.getTaskTemplate(task.taskTemplateId);
      const stage = tpl?.stages[task.currentStageIndex]?.snapshot;
      if (!stage) return;
      if (stage.role === 'agent' && stage.agent) {
        void runner.runAgentStage(task.rootId, taskId, task.currentStageIndex)
          .catch((e: any) => console.error('[kanban-runner]', e));
      } else if (stage.role === 'user' && stage.autoAdvance) {
        try { service.next(task.rootId, taskId); }
        catch (e) { console.error('[kanban auto-advance]', e); }
      }
    },
  });
  const router = createKanbanRouter({ service, templateStore, scheduler });
  return { db, taskStore, templateStore, service, scheduler, runner, router };
}
