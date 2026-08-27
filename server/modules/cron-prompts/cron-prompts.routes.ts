// server/modules/cron-prompts/cron-prompts.routes.ts
//
// REST API for the 定时任务 panel (auth: user JWT, mounted like /api/tasks).

import { Router } from 'express';
import * as realCron from 'node-cron';

import { cronPromptsStore } from './cron-prompts.store.js';
import { cronPromptsDriver } from './cron-prompts.driver.js';

interface CronValidate {
  validate: (expr: string) => boolean;
}

export function createCronPromptsRouter(deps: { cron?: CronValidate } = {}): Router {
  const router = Router();
  const cronLib = deps.cron ?? realCron;

  const validatePayload = (body: Record<string, unknown>) => {
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    const cronExpression = typeof body.cronExpression === 'string' ? body.cronExpression.trim() : '';
    const prompt = typeof body.prompt === 'string' ? body.prompt.trim() : '';
    const provider = typeof body.provider === 'string' && body.provider ? body.provider : 'claude';
    // 全局任务:projectPath 可选——发起时给 agent 的关联工作目录(空则主目录)。
    // Windows 反斜杠统一规范化为正斜杠(历史上反斜杠丢失导致任务永不执行)。
    const rawProjectPath = typeof body.projectPath === 'string'
      ? body.projectPath.trim().replace(/[\\/]+/g, '/')
      : '';
    if (!name) return { error: 'name is required' } as const;
    if (!cronExpression || !cronLib.validate(cronExpression)) {
      return { error: `invalid cron expression: ${cronExpression}` } as const;
    }
    if (!prompt) return { error: 'prompt is required' } as const;
    return { value: { name, cronExpression, prompt, provider, projectPath: rawProjectPath } } as const;
  };

  router.get('/', (_req, res) => {
    res.json({ success: true, data: cronPromptsStore.list() });
  });

  router.post('/', (req, res) => {
    const parsed = validatePayload((req.body ?? {}) as Record<string, unknown>);
    if ('error' in parsed) return res.status(400).json({ error: parsed.error });
    const task = cronPromptsStore.create(parsed.value);
    cronPromptsDriver.reload();
    res.status(201).json({ success: true, data: task });
  });

  router.patch('/:id', (req, res) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const fields: Record<string, unknown> = {};
    if (typeof body.name === 'string' && body.name.trim()) fields.name = body.name.trim();
    if (typeof body.cronExpression === 'string' && body.cronExpression.trim()) {
      if (!cronLib.validate(body.cronExpression.trim())) {
        return res.status(400).json({ error: `invalid cron expression: ${body.cronExpression}` });
      }
      fields.cronExpression = body.cronExpression.trim();
    }
    if (typeof body.prompt === 'string' && body.prompt.trim()) fields.prompt = body.prompt.trim();
    if (typeof body.provider === 'string' && body.provider) fields.provider = body.provider;
    if (typeof body.projectPath === 'string') fields.projectPath = body.projectPath.trim().replace(/[\\/]+/g, '/');
    if (typeof body.enabled === 'boolean') fields.enabled = body.enabled;
    const task = cronPromptsStore.update(String(req.params.id), fields);
    if (!task) return res.status(404).json({ error: 'task not found' });
    cronPromptsDriver.reload();
    res.json({ success: true, data: task });
  });

  router.delete('/:id', (req, res) => {
    const deleted = cronPromptsStore.delete(String(req.params.id));
    if (!deleted) return res.status(404).json({ error: 'task not found' });
    cronPromptsDriver.reload();
    res.json({ success: true });
  });

  router.post('/:id/run', async (req, res) => {
    try {
      const result = await cronPromptsDriver.runNow(String(req.params.id));
      if (!result.sessionId && result.error) {
        return res.status(404).json({ error: result.error });
      }
      res.json({ success: true, data: result });
    } catch (e) {
      res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
    }
  });

  return router;
}
