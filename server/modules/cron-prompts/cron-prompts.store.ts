// server/modules/cron-prompts/cron-prompts.store.ts
//
// 定时 prompt 任务(复刻 ZCode Cron):每条任务 = 名称 + cron 表达式 + prompt,
// 到点由 driver 拉起一个 agent 会话执行 prompt。数据落在 cron_prompts 表。

import { randomUUID } from 'node:crypto';

import { getConnection } from '@/modules/database/index.js';

export interface CronPromptTask {
  id: string;
  name: string;
  cronExpression: string;
  prompt: string;
  provider: string;
  projectPath: string;
  /** new = 每次新会话;resume = 唤醒既有会话追加 turn(Codex 线程唤醒模式)。 */
  sessionMode: 'new' | 'resume';
  /** resume 模式下绑定的 app session id。 */
  boundSessionId: string | null;
  /** 错过计划点(停机/睡眠)后启动时是否补跑一次。 */
  catchUp: boolean;
  /** 持久化的下一计划点(UTC 裸串),补跑判定与推进的依据。 */
  nextRunAt: string | null;
  /** 运行时权限模式;默认 bypassPermissions 兼容既有任务行为。 */
  permissionMode: string;
  enabled: boolean;
  /** 运行后写一条系统消息进关联项目的消息盒子。 */
  notifyInbox: boolean;
  /** 偏好持久化,通道尚未接入(邮件)。 */
  notifyEmail: boolean;
  /** 偏好持久化,通道尚未接入(飞书)。 */
  notifyFeishu: boolean;
  lastRunAt: string | null;
  lastSessionId: string | null;
  runCount: number;
  createdAt: string;
  updatedAt: string;
}

interface CronPromptRow {
  id: string;
  name: string;
  cron_expression: string;
  prompt: string;
  provider: string;
  project_path: string;
  session_mode: string;
  bound_session_id: string | null;
  catch_up: number | null;
  next_run_at: string | null;
  permission_mode: string;
  enabled: number;
  notify_inbox: number | null;
  notify_email: number | null;
  notify_feishu: number | null;
  last_run_at: string | null;
  last_session_id: string | null;
  run_count: number;
  created_at: string;
  updated_at: string;
}

const rowToTask = (row: CronPromptRow): CronPromptTask => ({
  id: row.id,
  name: row.name,
  cronExpression: row.cron_expression,
  prompt: row.prompt,
  provider: row.provider,
  projectPath: row.project_path,
  sessionMode: row.session_mode === 'resume' ? 'resume' : 'new',
  boundSessionId: row.bound_session_id ?? null,
  // 老库 NULL → 默认开启(与权限列的回填语义一致)
  catchUp: row.catch_up === null ? true : Boolean(row.catch_up),
  nextRunAt: row.next_run_at ?? null,
  permissionMode: row.permission_mode || 'bypassPermissions',
  enabled: Boolean(row.enabled),
  // 老库 NULL → 按默认语义(站内开、其余关)
  notifyInbox: row.notify_inbox === null ? true : Boolean(row.notify_inbox),
  notifyEmail: Boolean(row.notify_email),
  notifyFeishu: Boolean(row.notify_feishu),
  lastRunAt: row.last_run_at,
  lastSessionId: row.last_session_id,
  runCount: Number(row.run_count ?? 0),
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

export const cronPromptsStore = {
  list(): CronPromptTask[] {
    const db = getConnection();
    const rows = db
      .prepare('SELECT * FROM cron_prompts ORDER BY created_at DESC')
      .all() as unknown as CronPromptRow[];
    return rows.map(rowToTask);
  },

  getById(id: string): CronPromptTask | null {
    const db = getConnection();
    const row = db
      .prepare('SELECT * FROM cron_prompts WHERE id = ?')
      .get(id) as unknown as CronPromptRow | undefined;
    return row ? rowToTask(row) : null;
  },

  create(input: {
    name: string;
    cronExpression: string;
    prompt: string;
    provider: string;
    projectPath: string;
    sessionMode?: 'new' | 'resume';
    boundSessionId?: string | null;
    catchUp?: boolean;
    permissionMode?: string;
    enabled?: boolean;
    notifyInbox?: boolean;
    notifyEmail?: boolean;
    notifyFeishu?: boolean;
  }): CronPromptTask {
    const db = getConnection();
    const id = randomUUID();
    db.prepare(
      `INSERT INTO cron_prompts (id, name, cron_expression, prompt, provider, project_path, session_mode, bound_session_id, catch_up, permission_mode, enabled, notify_inbox, notify_email, notify_feishu)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      id,
      input.name,
      input.cronExpression,
      input.prompt,
      input.provider,
      input.projectPath,
      input.sessionMode === 'resume' ? 'resume' : 'new',
      input.sessionMode === 'resume' ? (input.boundSessionId ?? null) : null,
      input.catchUp === false ? 0 : 1,
      input.permissionMode ?? 'bypassPermissions',
      input.enabled === false ? 0 : 1,
      input.notifyInbox === false ? 0 : 1,
      input.notifyEmail ? 1 : 0,
      input.notifyFeishu ? 1 : 0,
    );
    return this.getById(id)!;
  },

  update(
    id: string,
    fields: Partial<{
      name: string;
      cronExpression: string;
      prompt: string;
      provider: string;
      projectPath: string;
      sessionMode: 'new' | 'resume';
      boundSessionId: string | null;
      catchUp: boolean;
      permissionMode: string;
      enabled: boolean;
      notifyInbox: boolean;
      notifyEmail: boolean;
      notifyFeishu: boolean;
    }>
  ): CronPromptTask | null {
    const db = getConnection();
    const sets: string[] = [];
    const values: Array<string | number | null> = [];
    if (fields.name !== undefined) { sets.push('name = ?'); values.push(fields.name); }
    if (fields.cronExpression !== undefined) { sets.push('cron_expression = ?'); values.push(fields.cronExpression); }
    if (fields.prompt !== undefined) { sets.push('prompt = ?'); values.push(fields.prompt); }
    if (fields.provider !== undefined) { sets.push('provider = ?'); values.push(fields.provider); }
    if (fields.projectPath !== undefined) { sets.push('project_path = ?'); values.push(fields.projectPath); }
    if (fields.sessionMode !== undefined) {
      sets.push('session_mode = ?');
      values.push(fields.sessionMode === 'resume' ? 'resume' : 'new');
      // 切回 new 模式时清掉绑定,避免留下悬空引用。
      if (fields.sessionMode !== 'resume' && fields.boundSessionId === undefined) {
        sets.push('bound_session_id = ?');
        values.push(null);
      }
    }
    if (fields.boundSessionId !== undefined) { sets.push('bound_session_id = ?'); values.push(fields.boundSessionId); }
    if (fields.catchUp !== undefined) { sets.push('catch_up = ?'); values.push(fields.catchUp ? 1 : 0); }
    if (fields.permissionMode !== undefined) { sets.push('permission_mode = ?'); values.push(fields.permissionMode); }
    if (fields.enabled !== undefined) { sets.push('enabled = ?'); values.push(fields.enabled ? 1 : 0); }
    if (fields.notifyInbox !== undefined) { sets.push('notify_inbox = ?'); values.push(fields.notifyInbox ? 1 : 0); }
    if (fields.notifyEmail !== undefined) { sets.push('notify_email = ?'); values.push(fields.notifyEmail ? 1 : 0); }
    if (fields.notifyFeishu !== undefined) { sets.push('notify_feishu = ?'); values.push(fields.notifyFeishu ? 1 : 0); }
    if (sets.length === 0) return this.getById(id);
    sets.push('updated_at = CURRENT_TIMESTAMP');
    values.push(id);
    db.prepare(`UPDATE cron_prompts SET ${sets.join(', ')} WHERE id = ?`).run(...values);
    return this.getById(id);
  },

  delete(id: string): boolean {
    const db = getConnection();
    const result = db.prepare('DELETE FROM cron_prompts WHERE id = ?').run(id);
    return result.changes > 0;
  },

  /** Records a completed trigger (fire-and-forget: the run may still stream). */
  recordRun(id: string, sessionId: string | null): void {
    const db = getConnection();
    db.prepare(
      `UPDATE cron_prompts
       SET last_run_at = CURRENT_TIMESTAMP, last_session_id = ?, run_count = run_count + 1
       WHERE id = ?`
    ).run(sessionId, id);
  },

  /** 持久化下一计划点(补跑判定的依据)。 */
  setNextRunAt(id: string, nextRunAt: string | null): void {
    const db = getConnection();
    db.prepare('UPDATE cron_prompts SET next_run_at = ? WHERE id = ?').run(nextRunAt, id);
  },
};
