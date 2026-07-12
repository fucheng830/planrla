import { mkdirSync, readFileSync, writeFileSync, readdirSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { AppError } from '@/shared/utils.js';
import type { TaskTemplate, StageTemplate, SessionReusePolicy } from '@/modules/kanban/types.js';

export interface TemplateStoreDeps {
  dir: string;
}

const TPL_SUBDIR = 'kanban-templates';
const TEMPLATE_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

/**
 * Validates that a template id is safe to embed in an on-disk filename.
 *
 * Template ids are concatenated into `task_template-<id>.json` paths, so any
 * id containing path separators (`/`, `\`) or traversal sequences (`..`)
 * could escape the `kanban-templates/` directory. This is the trust boundary
 * for path-traversal defense; every save/get/delete must pass through it.
 */
function isValidTemplateId(id: string): boolean {
  return typeof id === 'string' && TEMPLATE_ID_PATTERN.test(id);
}

function assertValidTemplateId(id: string): void {
  if (!isValidTemplateId(id)) {
    throw new AppError('invalid template id', { code: 'TEMPLATE_INVALID', statusCode: 400 });
  }
}

export function createTemplateStore(deps: TemplateStoreDeps) {
  const baseDir = join(deps.dir, TPL_SUBDIR);
  mkdirSync(baseDir, { recursive: true });

  function pathFor(id: string): string {
    return join(baseDir, `task_template-${id}.json`);
  }

  function saveTaskTemplate(tpl: TaskTemplate): TaskTemplate {
    assertValidTemplateId(tpl.id);
    if (!tpl.name?.trim()) throw new AppError('template name required', { code: 'TEMPLATE_INVALID', statusCode: 400 });
    if (!tpl.stages || tpl.stages.length === 0) throw new AppError('template must have at least one stage', { code: 'TEMPLATE_INVALID', statusCode: 400 });
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
    // An invalid id cannot correspond to a real template; return null so the
    // GET route maps it to 404 instead of constructing an unsafe path.
    if (!isValidTemplateId(id)) return null;
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
    // DELETE is idempotent: an invalid id is a safe no-op rather than a throw,
    // so a malicious id can never trigger an rmSync outside the templates dir.
    if (!isValidTemplateId(id)) return;
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
