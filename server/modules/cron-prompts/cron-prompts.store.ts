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
  /** 派发失败累计次数(退避重试依据;成功后清零)。 */
  dispatchAttempts: number;
  /** 退避重试的下次允许派发时间;null=无退避。 */
  retryAt: string | null;
  /** 最近一次派发失败归类:transient(可重试)/permanent(不重试)。 */
  lastFailureKind: 'transient' | 'permanent' | null;
  /** 有限次上限;NULL = 无限循环(默认)。 */
  maxRuns: number | null;
  /** active / completed(有限次耗尽终态)。 */
  lifecycleStatus: 'active' | 'completed';
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
  dispatch_attempts: number;
  retry_at: string | null;
  last_failure_kind: string | null;
  max_runs: number | null;
  lifecycle_status: string;
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
  dispatchAttempts: Number(row.dispatch_attempts ?? 0),
  retryAt: row.retry_at ?? null,
  lastFailureKind: row.last_failure_kind === 'transient' || row.last_failure_kind === 'permanent'
    ? row.last_failure_kind
    : null,
  maxRuns: row.max_runs === null || row.max_runs === undefined ? null : Number(row.max_runs),
  lifecycleStatus: row.lifecycle_status === 'completed' ? 'completed' : 'active',
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
    maxRuns?: number | null;
    permissionMode?: string;
    enabled?: boolean;
    notifyInbox?: boolean;
    notifyEmail?: boolean;
    notifyFeishu?: boolean;
  }): CronPromptTask {
    const db = getConnection();
    const id = randomUUID();
    db.prepare(
      `INSERT INTO cron_prompts (id, name, cron_expression, prompt, provider, project_path, session_mode, bound_session_id, catch_up, max_runs, permission_mode, enabled, notify_inbox, notify_email, notify_feishu)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
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
      input.maxRuns ?? null,
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
    // 有限次任务:跑满后进 completed 终态并停调度(移植 ZCode lifecycle)。
    const task = this.getById(id);
    if (task?.maxRuns != null) {
      const next = task.runCount + 1;
      if (next >= task.maxRuns) {
        db.prepare(
          `UPDATE cron_prompts
           SET last_run_at = CURRENT_TIMESTAMP, last_session_id = ?, run_count = ?, lifecycle_status = 'completed', enabled = 0
           WHERE id = ?`
        ).run(sessionId, next, id);
        return;
      }
    }
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

  // ===== 派发退避(移植 ZCode markDispatched/markDispatchFailed 语义) =====

  /** 派发成功:清退避状态。 */
  markDispatchSucceeded(id: string): void {
    const db = getConnection();
    db.prepare(
      `UPDATE cron_prompts
       SET dispatch_attempts = 0, retry_at = NULL, last_failure_kind = NULL
       WHERE id = ?`
    ).run(id);
  },

  /**
   * 派发失败:记录失败归类并计算退避时间。
   * - permanent(如 provider 不存在/绑定会话丢失):不重试,等待下一个正常计划点。
   * - transient:指数退避(base * 2^attempts),封顶 cap;达上限后也放弃本轮。
   * 返回退避后的 retry_at(ISO),或 null 表示不再重试。
   */
  markDispatchFailed(
    id: string,
    kind: 'transient' | 'permanent',
    opts: { baseMs: number; capMs: number; maxAttempts: number },
  ): string | null {
    const db = getConnection();
    const task = this.getById(id);
    if (!task) return null;
    if (kind === 'permanent') {
      db.prepare(
        `UPDATE cron_prompts SET last_failure_kind = 'permanent' WHERE id = ?`
      ).run(id);
      return null;
    }
    const attempts = task.dispatchAttempts + 1;
    if (attempts >= opts.maxAttempts) {
      db.prepare(
        `UPDATE cron_prompts
         SET dispatch_attempts = ?, last_failure_kind = 'transient'
         WHERE id = ?`
      ).run(attempts, id);
      return null;
    }
    const backoff = Math.min(opts.baseMs * 2 ** (attempts - 1), opts.capMs);
    const retryAt = new Date(Date.now() + backoff).toISOString().replace('T', ' ').replace(/\.\d+Z$/, '');
    db.prepare(
      `UPDATE cron_prompts
       SET dispatch_attempts = ?, retry_at = ?, last_failure_kind = 'transient'
       WHERE id = ?`
    ).run(attempts, retryAt, id);
    return retryAt;
  },

  // ===== run 历史(移植 ZCode automation_runs) =====

  /** 插入一条 run 记录(claim 时刻)。 */
  insertRun(input: {
    runId: string;
    taskId: string;
    trigger: 'schedule' | 'manual' | 'catch-up';
    scheduledAt: string | null;
  }): void {
    const db = getConnection();
    db.prepare(
      `INSERT INTO cron_prompt_runs (run_id, task_id, trigger, status, scheduled_at)
       VALUES (?, ?, ?, 'claimed', ?)`
    ).run(input.runId, input.taskId, input.trigger, input.scheduledAt);
  },

  /** run 结算:成功(dispatched + session)/失败(error + failure_kind)。 */
  settleRun(input: {
    runId: string;
    status: 'dispatched' | 'failed_to_dispatch';
    sessionId?: string | null;
    error?: string | null;
    failureKind?: 'transient' | 'permanent' | null;
  }): void {
    const db = getConnection();
    db.prepare(
      `UPDATE cron_prompt_runs
       SET status = ?, session_id = ?, error = ?, failure_kind = ?, finished_at = CURRENT_TIMESTAMP
       WHERE run_id = ?`
    ).run(input.status, input.sessionId ?? null, input.error ?? null, input.failureKind ?? null, input.runId);
  },

  /** 某任务的 run 历史(倒序分页)。 */
  listRuns(taskId: string, limit = 20, offset = 0): CronPromptRun[] {
    const db = getConnection();
    const rows = db.prepare(
      `SELECT * FROM cron_prompt_runs WHERE task_id = ? ORDER BY started_at DESC LIMIT ? OFFSET ?`
    ).all(taskId, limit, offset) as unknown as CronPromptRunRow[];
    return rows.map(rowToRun);
  },
};

export interface CronPromptRun {
  runId: string;
  taskId: string;
  trigger: 'schedule' | 'manual' | 'catch-up';
  status: 'claimed' | 'dispatched' | 'failed_to_dispatch';
  sessionId: string | null;
  error: string | null;
  failureKind: 'transient' | 'permanent' | null;
  scheduledAt: string | null;
  startedAt: string;
  finishedAt: string | null;
}

interface CronPromptRunRow {
  run_id: string;
  task_id: string;
  trigger: string;
  status: string;
  session_id: string | null;
  error: string | null;
  failure_kind: string | null;
  scheduled_at: string | null;
  started_at: string;
  finished_at: string | null;
}

const rowToRun = (row: CronPromptRunRow): CronPromptRun => ({
  runId: row.run_id,
  taskId: row.task_id,
  trigger: row.trigger === 'manual' ? 'manual' : row.trigger === 'catch-up' ? 'catch-up' : 'schedule',
  status: row.status === 'dispatched' ? 'dispatched' : row.status === 'failed_to_dispatch' ? 'failed_to_dispatch' : 'claimed',
  sessionId: row.session_id ?? null,
  error: row.error ?? null,
  failureKind: row.failure_kind === 'transient' || row.failure_kind === 'permanent' ? row.failure_kind : null,
  scheduledAt: row.scheduled_at ?? null,
  startedAt: row.started_at,
  finishedAt: row.finished_at ?? null,
});
