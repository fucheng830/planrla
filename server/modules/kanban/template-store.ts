import { mkdirSync, readFileSync, writeFileSync, readdirSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import type { TaskTemplate, StageTemplate, SessionReusePolicy } from '@/modules/kanban/types.js';

export interface TemplateStoreDeps {
  dir: string;
}

const TPL_SUBDIR = 'kanban-templates';

export function createTemplateStore(deps: TemplateStoreDeps) {
  const baseDir = join(deps.dir, TPL_SUBDIR);
  mkdirSync(baseDir, { recursive: true });

  function pathFor(id: string): string {
    return join(baseDir, `task_template-${id}.json`);
  }

  function saveTaskTemplate(tpl: TaskTemplate): TaskTemplate {
    if (!tpl.name?.trim()) throw new Error('template name required');
    if (!tpl.stages || tpl.stages.length === 0) throw new Error('template must have at least one stage');
    const normalized: TaskTemplate = {
      ...tpl,
      maxConcurrency: tpl.maxConcurrency > 0 ? tpl.maxConcurrency : 1,
      stages: tpl.stages.map((s, i) => ({
        ...s,
        position: i,
        snapshot: normalizeStageTemplate(s.snapshot),
      })),
      updatedAt: new Date().toISOString(),
    };
    writeFileSync(pathFor(tpl.id), JSON.stringify(normalized, null, 2), 'utf8');
    return normalized;
  }

  function getTaskTemplate(id: string): TaskTemplate | null {
    const p = pathFor(id);
    if (!existsSync(p)) return null;
    return JSON.parse(readFileSync(p, 'utf8')) as TaskTemplate;
  }

  function listTaskTemplates(): TaskTemplate[] {
    return readdirSync(baseDir)
      .filter((f) => f.startsWith('task_template-') && f.endsWith('.json'))
      .map((f) => JSON.parse(readFileSync(join(baseDir, f), 'utf8')) as TaskTemplate);
  }

  function deleteTaskTemplate(id: string): void {
    const p = pathFor(id);
    if (existsSync(p)) rmSync(p);
  }

  return { saveTaskTemplate, getTaskTemplate, listTaskTemplates, deleteTaskTemplate };
}

function normalizeStageTemplate(s: StageTemplate): StageTemplate {
  const policy: SessionReusePolicy = s.sessionReusePolicy ?? 'task_main';
  return { ...s, sessionReusePolicy: policy };
}

export type TemplateStore = ReturnType<typeof createTemplateStore>;
