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
  const service = createKanbanService({ taskStore, templateStore });
  const auxBridge = createAuxBridge({ updateAuxFlags: taskStore.updateTaskAuxFlags });
  const resolveRootPath = (rootId: string): string | null => projectsDb.getProjectPathById(rootId);
  const runner = createRunner({ taskStore, templateStore, service, auxBridge, resolveRootPath });
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
  const router = createKanbanRouter({ service, templateStore });
  return { db, taskStore, templateStore, service, scheduler, runner, router };
}
