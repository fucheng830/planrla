// server/modules/cron-prompts/cron-prompts.routes.ts
//
// REST API for the 定时任务 panel (auth: user JWT, mounted like /api/tasks).

import { Router } from 'express';
import * as realCron from 'node-cron';

import { providerCapabilitiesService } from '@/modules/providers/index.js';
import { sessionsDb } from '@/modules/database/index.js';

import { cronPromptsStore } from './cron-prompts.store.js';
import { cronPromptsDriver } from './cron-prompts.driver.js';

interface CronValidate {
  validate: (expr: string) => boolean;
}

export function createCronPromptsRouter(deps: { cron?: CronValidate } = {}): Router {
  const router = Router();
  const cronLib = deps.cron ?? realCron;

  const normalizePermissionMode = (provider: string, raw: unknown): string => {
    if (typeof raw !== 'string' || !raw.trim()) return 'bypassPermissions';
    const mode = raw.trim();
    const capabilities = providerCapabilitiesService.getProviderCapabilities(provider as never);
    if (!capabilities?.permissionModes?.includes(mode)) {
      throw new Error(`invalid permissionMode "${mode}" for provider "${provider}"`);
    }
    return mode;
  };

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
    const notifyInbox = typeof body.notifyInbox === 'boolean' ? body.notifyInbox : true;
    const notifyEmail = body.notifyEmail === true;
    const notifyFeishu = body.notifyFeishu === true;
    const catchUp = typeof body.catchUp === 'boolean' ? body.catchUp : true;
    const maxRunsRaw = body.maxRuns;
    const maxRuns = typeof maxRunsRaw === 'number' && Number.isInteger(maxRunsRaw) && maxRunsRaw > 0
      ? maxRunsRaw
      : null;
    const permissionMode = normalizePermissionMode(provider, body.permissionMode);
    const sessionMode = body.sessionMode === 'resume' ? 'resume' as const : 'new' as const;
    const boundSessionId = typeof body.boundSessionId === 'string' ? body.boundSessionId.trim() : '';
    if (sessionMode === 'resume') {
      const bound = boundSessionId ? sessionsDb.getSessionById(boundSessionId) : null;
      if (!bound) {
        return { error: `boundSessionId "${boundSessionId}" does not exist` } as const;
      }
      if (bound.provider !== provider) {
        return { error: `bound session provider "${bound.provider}" does not match task provider "${provider}"` } as const;
      }
    }
    return { value: { name, cronExpression, prompt, provider, projectPath: rawProjectPath, sessionMode, boundSessionId: sessionMode === 'resume' ? boundSessionId : null, catchUp, maxRuns, permissionMode, notifyInbox, notifyEmail, notifyFeishu } } as const;
  };

  router.get('/', (_req, res) => {
    res.json({ success: true, data: cronPromptsStore.list() });
  });

  router.get('/:id/runs', (req, res) => {
    const limit = Math.min(Number(req.query.limit) || 20, 100);
    const offset = Math.max(Number(req.query.offset) || 0, 0);
    const runs = cronPromptsStore.listRuns(String(req.params.id), limit, offset);
    res.json({ success: true, data: runs });
  });

  router.post('/', (req, res) => {
    let parsed;
    try {
      parsed = validatePayload((req.body ?? {}) as Record<string, unknown>);
    } catch (e) {
      return res.status(400).json({ error: e instanceof Error ? e.message : String(e) });
    }
    if ('error' in parsed) return res.status(400).json({ error: parsed.error });
    let task;
    try {
      task = cronPromptsStore.create(parsed.value);
    } catch (e) {
      return res.status(400).json({ error: e instanceof Error ? e.message : String(e) });
    }
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
    if (typeof body.permissionMode === 'string' && body.permissionMode.trim()) {
      try {
        fields.permissionMode = normalizePermissionMode(
          typeof body.provider === 'string' && body.provider ? body.provider : cronPromptsStore.getById(String(req.params.id))?.provider ?? 'claude',
          body.permissionMode,
        );
      } catch (e) {
        return res.status(400).json({ error: e instanceof Error ? e.message : String(e) });
      }
    }
    if (body.sessionMode === 'resume' || body.sessionMode === 'new') {
      const mode = body.sessionMode as 'new' | 'resume';
      if (mode === 'resume') {
        const boundId = typeof body.boundSessionId === 'string' ? body.boundSessionId.trim() : '';
        const bound = boundId ? sessionsDb.getSessionById(boundId) : null;
        if (!bound) return res.status(400).json({ error: `boundSessionId "${boundId}" does not exist` });
        const provider = typeof body.provider === 'string' && body.provider ? body.provider : bound.provider;
        if (bound.provider !== provider) {
          return res.status(400).json({ error: `bound session provider "${bound.provider}" does not match task provider "${provider}"` });
        }
        fields.sessionMode = mode;
        fields.boundSessionId = boundId;
      } else {
        fields.sessionMode = mode;
      }
    } else if (typeof body.boundSessionId === 'string' && body.boundSessionId.trim()) {
      const boundId = body.boundSessionId.trim();
      const bound = boundId ? sessionsDb.getSessionById(boundId) : null;
      if (!bound) return res.status(400).json({ error: `boundSessionId "${boundId}" does not exist` });
      fields.boundSessionId = boundId;
    }
    if (typeof body.enabled === 'boolean') fields.enabled = body.enabled;
    if (typeof body.notifyInbox === 'boolean') fields.notifyInbox = body.notifyInbox;
    if (typeof body.notifyEmail === 'boolean') fields.notifyEmail = body.notifyEmail;
    if (typeof body.notifyFeishu === 'boolean') fields.notifyFeishu = body.notifyFeishu;
    if (typeof body.catchUp === 'boolean') fields.catchUp = body.catchUp;
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
