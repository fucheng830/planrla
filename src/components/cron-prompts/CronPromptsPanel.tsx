import { useCallback, useEffect, useState } from 'react';
import {
  CalendarClock, Check, Clock, Loader2, Pencil, Play, Plus, Power, Trash2, X,
} from 'lucide-react';

import { authenticatedFetch } from '../../utils/api';
import { cn } from '../../lib/utils';

type CronPromptTask = {
  id: string;
  name: string;
  cronExpression: string;
  prompt: string;
  provider: string;
  projectPath: string;
  enabled: boolean;
  lastRunAt: string | null;
  lastSessionId: string | null;
  runCount: number;
};

/** 人类可读的 cron 描述（覆盖常见形态，未覆盖时返回表达式本身）。 */
function describeCron(expr: string): string {
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) return expr;
  const [min, hour, dom, mon, dow] = parts;
  const time = `${hour === '*' ? '每小时' : `${String(hour).padStart(2, '0')}:${String(min).padStart(2, '0')}`}`;
  if (min !== '*' && hour !== '*' && dom === '*' && mon === '*' && dow === '*') return `每天 ${time}`;
  if (min !== '*' && hour !== '*' && dom === '*' && mon === '*' && dow === '1-5') return `每个工作日 ${time}`;
  if (min.startsWith('*/') && hour === '*') return `每 ${min.slice(2)} 分钟`;
  if (min === '*' && hour.startsWith('*/')) return `每 ${hour.slice(2)} 小时`;
  if (dow !== '*' && dom === '*') {
    const dayNames: Record<string, string> = { '1': '一', '2': '二', '3': '三', '4': '四', '5': '五', '6': '六', '0': '日' };
    const day = dayNames[dow] ?? dow;
    if (min !== '*' && hour !== '*') return `每周${day} ${time}`;
  }
  if (min !== '*' && hour !== '*' && dom !== '*' && mon === '*' && dow === '*') return `每月 ${dom} 日 ${time}`;
  return expr;
}

function formatLastRun(iso: string | null): string {
  if (!iso) return '从未运行';
  const ms = Date.now() - Date.parse(iso);
  if (!Number.isFinite(ms) || ms < 0) return '刚刚';
  const minutes = Math.floor(ms / 60000);
  if (minutes < 1) return '刚刚';
  if (minutes < 60) return `${minutes} 分钟前`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} 小时前`;
  return `${Math.floor(hours / 24)} 天前`;
}

export function CronPromptsPanel({ isVisible }: { isVisible: boolean }) {
  const [tasks, setTasks] = useState<CronPromptTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editing, setEditing] = useState<CronPromptTask | null>(null);
  const [form, setForm] = useState({ name: '', cronExpression: '0 9 * * *', prompt: '', provider: 'claude', projectPath: '' });
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await authenticatedFetch('/api/cron-prompts');
      if (!res.ok) {
        // Guard before parsing: a mid-restart backend can answer with the
        // SPA's HTML, and res.json() would throw a cryptic parse error.
        throw new Error(`加载定时任务失败 (HTTP ${res.status})`);
      }
      const body = await res.json() as { data?: CronPromptTask[] };
      if (body.data) setTasks(body.data);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const openCreate = () => {
    setEditing(null);
    setForm({ name: '', cronExpression: '0 9 * * *', prompt: '', provider: 'claude', projectPath: '' });
    setEditorOpen(true);
  };

  const openEdit = (task: CronPromptTask) => {
    setEditing(task);
    setForm({
      name: task.name,
      cronExpression: task.cronExpression,
      prompt: task.prompt,
      provider: task.provider,
      projectPath: task.projectPath,
    });
    setEditorOpen(true);
  };

  const save = async () => {
    setSaving(true); setError(null);
    try {
      const res = await authenticatedFetch(editing ? `/api/cron-prompts/${editing.id}` : '/api/cron-prompts', {
        method: editing ? 'PATCH' : 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(form),
      });
      if (!res.ok) throw new Error(await res.text());
      setEditorOpen(false);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  const toggle = async (task: CronPromptTask) => {
    setBusyId(task.id);
    try {
      await authenticatedFetch(`/api/cron-prompts/${task.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ enabled: !task.enabled }),
      });
      await load();
    } finally {
      setBusyId(null);
    }
  };

  const remove = async (task: CronPromptTask) => {
    setBusyId(task.id);
    try {
      await authenticatedFetch(`/api/cron-prompts/${task.id}`, { method: 'DELETE' });
      await load();
    } finally {
      setBusyId(null);
    }
  };

  const runNow = async (task: CronPromptTask) => {
    setBusyId(task.id); setError(null);
    try {
      const res = await authenticatedFetch(`/api/cron-prompts/${task.id}/run`, { method: 'POST' });
      if (!res.ok) throw new Error(await res.text());
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusyId(null);
    }
  };

  if (!isVisible) return null;

  return (
    <div className="h-full overflow-y-auto p-4 md:p-6">
      <div className="mx-auto max-w-3xl">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="flex items-center gap-2 text-base font-semibold text-foreground">
            <CalendarClock className="h-4 w-4" />
            定时任务
          </h2>
          <button
            type="button"
            onClick={openCreate}
            className="flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90"
          >
            <Plus className="h-3.5 w-3.5" />
            新建定时任务
          </button>
        </div>

        {error && <p className="mb-3 text-xs text-red-500">{error}</p>}

        {loading ? (
          <div className="flex justify-center py-12">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : tasks.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border py-14 text-center">
            <Clock className="mx-auto mb-3 h-8 w-8 text-muted-foreground/50" />
            <p className="text-sm font-medium text-foreground">还没有定时任务</p>
            <p className="mt-1 text-xs text-muted-foreground">
              按 cron 表达式定时让智能体执行 prompt,每次运行生成一个新会话。
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {tasks.map((task) => (
              <div
                key={task.id}
                className={cn(
                  'rounded-xl border bg-card p-4 transition-opacity',
                  task.enabled ? 'border-border' : 'border-border/60 opacity-60',
                  busyId === task.id && 'opacity-50',
                )}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-sm font-semibold text-foreground">{task.name}</span>
                      <span className="rounded bg-muted px-1.5 py-px font-mono text-[10px] text-muted-foreground">
                        {task.cronExpression}
                      </span>
                    </div>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {describeCron(task.cronExpression)} · {task.provider} · {task.projectPath}
                    </p>
                  </div>
                  <button
                    type="button"
                    disabled={busyId === task.id}
                    onClick={() => void toggle(task)}
                    className={cn(
                      'flex items-center gap-1 rounded px-2 py-1 text-[11px] font-medium transition-colors',
                      task.enabled
                        ? 'bg-emerald-500/10 text-emerald-600 hover:bg-emerald-500/20'
                        : 'bg-muted text-muted-foreground hover:bg-muted/60',
                    )}
                    title={task.enabled ? '已启用,点击禁用' : '已禁用,点击启用'}
                  >
                    <Power className="h-3 w-3" />
                    {task.enabled ? '已启用' : '已禁用'}
                  </button>
                </div>

                <p className="mt-2 line-clamp-2 rounded-md bg-muted/50 px-3 py-2 text-xs leading-relaxed text-muted-foreground">
                  {task.prompt}
                </p>

                <div className="mt-3 flex items-center justify-between">
                  <p className="text-[11px] text-muted-foreground">
                    已运行 {task.runCount} 次 · 上次运行 {formatLastRun(task.lastRunAt)}
                  </p>
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      disabled={busyId === task.id}
                      onClick={() => void runNow(task)}
                      className="flex h-7 items-center gap-1 rounded px-2 text-[11px] text-muted-foreground hover:bg-accent hover:text-foreground"
                      title="立即运行一次"
                    >
                      {busyId === task.id
                        ? <Loader2 className="h-3 w-3 animate-spin" />
                        : <Play className="h-3 w-3" />}
                      立即运行
                    </button>
                    <button
                      type="button"
                      onClick={() => openEdit(task)}
                      className="flex h-7 w-7 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground"
                      title="编辑"
                    >
                      <Pencil className="h-3 w-3" />
                    </button>
                    <button
                      type="button"
                      disabled={busyId === task.id}
                      onClick={() => void remove(task)}
                      className="flex h-7 w-7 items-center justify-center rounded text-muted-foreground hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-900/20"
                      title="删除"
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Create / edit dialog */}
      {editorOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setEditorOpen(false)}>
          <div
            className="w-full max-w-lg rounded-xl border border-border bg-card p-5 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="mb-4 text-sm font-semibold text-foreground">
              {editing ? '编辑定时任务' : '新建定时任务'}
            </h3>
            <div className="space-y-3">
              <div>
                <label className="mb-1 block text-xs text-muted-foreground">名称</label>
                <input
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  placeholder="如:全网热点监控"
                  className="h-9 w-full rounded-md border border-border bg-background px-3 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs text-muted-foreground">
                  cron 表达式 <span className="text-muted-foreground/60">({describeCron(form.cronExpression)})</span>
                </label>
                <input
                  value={form.cronExpression}
                  onChange={(e) => setForm({ ...form, cronExpression: e.target.value })}
                  placeholder="0 9 * * *"
                  className="h-9 w-full rounded-md border border-border bg-background px-3 font-mono text-sm focus:outline-none focus:ring-1 focus:ring-primary"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-xs text-muted-foreground">智能体</label>
                  <select
                    value={form.provider}
                    onChange={(e) => setForm({ ...form, provider: e.target.value })}
                    className="h-9 w-full rounded-md border border-border bg-background px-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
                  >
                    {['claude', 'zcode', 'codex', 'gemini', 'kimi', 'cursor', 'opencode'].map((p) => (
                      <option key={p} value={p}>{p}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-xs text-muted-foreground">项目路径</label>
                  <input
                    value={form.projectPath}
                    onChange={(e) => setForm({ ...form, projectPath: e.target.value })}
                    placeholder="C:\workspace\项目\xxx"
                    className="h-9 w-full rounded-md border border-border bg-background px-3 font-mono text-xs focus:outline-none focus:ring-1 focus:ring-primary"
                  />
                </div>
              </div>
              <div>
                <label className="mb-1 block text-xs text-muted-foreground">Prompt</label>
                <textarea
                  value={form.prompt}
                  onChange={(e) => setForm({ ...form, prompt: e.target.value })}
                  placeholder="到点要执行的任务描述…"
                  rows={5}
                  className="w-full resize-none rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
                />
              </div>
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setEditorOpen(false)}
                className="flex items-center gap-1 rounded-md px-3 py-1.5 text-xs text-muted-foreground hover:bg-accent"
              >
                <X className="h-3.5 w-3.5" />
                取消
              </button>
              <button
                type="button"
                disabled={saving || !form.name.trim() || !form.prompt.trim() || !form.projectPath.trim()}
                onClick={() => void save()}
                className="flex items-center gap-1 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
              >
                {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                保存
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default CronPromptsPanel;
