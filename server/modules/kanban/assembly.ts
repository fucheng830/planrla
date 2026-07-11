import path from 'node:path';
import os from 'node:os';
import { getConnection } from '@/modules/database/index.js';
import { createTaskStore } from '@/modules/kanban/store.js';
import { createTemplateStore } from '@/modules/kanban/template-store.js';
import { createKanbanService } from '@/modules/kanban/service.js';
import { createScheduler } from '@/modules/kanban/scheduler.js';
import { createKanbanRouter } from '@/modules/kanban/kanban.routes.js';

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
  const scheduler = createScheduler({
    taskStore,
    templateStore,
    onAdmit: (taskId: string) => {
      // W3 接 runner;W2 留桩
      console.log('[kanban] task admitted (runner pending W3):', taskId);
    },
  });
  const router = createKanbanRouter({ service });
  return { db, taskStore, templateStore, service, scheduler, router };
}
