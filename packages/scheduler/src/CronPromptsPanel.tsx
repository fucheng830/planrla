import { useCallback, useEffect, useState } from 'react';
import {
  CalendarClock, Check, Clock, Loader2, Pencil, Play, Plus, Power, Trash2, X,
} from 'lucide-react';

import { authenticatedFetch } from './api';
import { cn } from './utils';

type CronPromptTask = {
  id: string;
  name: string;
  cronExpression: string;
  prompt: string;
  provider: string;
  projectPath: string;
  sessionMode: 'new' | 'resume';
  boundSessionId: string;
  catchUp: boolean;
  nextRunAt: string | null;
  dispatchAttempts: number;
  retryAt: string | null;
  lastFailureKind: string | null;
  permissionMode: string;
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

type ScheduleMode = 'minutes' | 'hourly' | 'daily' | 'weekly' | 'monthly' | 'custom';

const WEEKDAY_OPTIONS = [
  { value: '1', label: '周一' },
  { value: '2', label: '周二' },
  { value: '3', label: '周三' },
  { value: '4', label: '周四' },
  { value: '5', label: '周五' },
  { value: '6', label: '周六' },
  { value: '0', label: '周日' },
];

/** 从 cron 表达式反解析出表单状态（无法识别时落入 custom）。 */
function parseCron(expr: string): { mode: ScheduleMode; interval: string; minute: string; hour: string; weekday: string; dayOfMonth: string } {
  const base = { mode: 'custom' as ScheduleMode, interval: '30', minute: '0', hour: '9', weekday: '1', dayOfMonth: '1' };
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) return base;
  const [min, hour, dom, mon, dow] = parts;
  if (mon !== '*') return base;
  let m;
  if ((m = /^\*\/(\d+)$/.exec(min)) && hour === '*' && dom === '*' && dow === '*') {
    return { ...base, mode: 'minutes', interval: m[1] };
  }
  if (/^\d+$/.test(min) && hour === '*' && dom === '*' && dow === '*') {
    return { ...base, mode: 'hourly', minute: min };
  }
  if (/^\d+$/.test(min) && /^\d+$/.test(hour) && dom === '*' && dow === '*') {
    return { ...base, mode: 'daily', minute: min, hour };
  }
  if (/^\d+$/.test(min) && /^\d+$/.test(hour) && dom === '*' && /^\d+(-\d+)?$/.test(dow)) {
    return { ...base, mode: 'weekly', minute: min, hour, weekday: dow };
  }
  if (/^\d+$/.test(min) && /^\d+$/.test(hour) && /^\d+$/.test(dom) && dow === '*') {
    return { ...base, mode: 'monthly', minute: min, hour, dayOfMonth: dom };
  }
  return base;
}

/** 由表单状态生成 cron 表达式。 */
function buildCron(state: { mode: ScheduleMode; interval: string; minute: string; hour: string; weekday: string; dayOfMonth: string }): string {
  const pad = (v: string) => String(Math.max(0, Number(v) || 0));
  switch (state.mode) {
    case 'minutes': return `*/${pad(state.interval)} * * * *`;
    case 'hourly': return `${pad(state.minute)} * * * *`;
    case 'daily': return `${pad(state.minute)} ${pad(state.hour)} * * *`;
    case 'weekly': return `${pad(state.minute)} ${pad(state.hour)} * * ${state.weekday}`;
    case 'monthly': return `${pad(state.minute)} ${pad(state.hour)} ${pad(state.dayOfMonth)} * *`;
    default: return state.interval; // custom: interval 字段复用为原始表达式载体
  }
}

type ScheduleState = ReturnType<typeof parseCron>;

/**
 * 解析时间戳为 epoch 毫秒。SQLite CURRENT_TIMESTAMP 存的是 UTC 的
 * "YYYY-MM-DD HH:mm:ss" 裸串(无时区标记),直接 Date.parse 会被当本地
 * 时间解读——东八区用户看到「上次运行 8 小时前」。这里识别裸串并补 UTC。
 */
function parseTimestampMs(value: string | null): number {
  if (!value) return Number.NaN;
  const naive = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})$/.exec(value);
  if (naive) {
    return Date.UTC(
      Number(naive[1]), Number(naive[2]) - 1, Number(naive[3]),
      Number(naive[4]), Number(naive[5]), Number(naive[6]),
    );
  }
  return Date.parse(value);
}

function formatLastRun(iso: string | null): string {
  if (!iso) return '从未运行';
  const ms = Date.now() - parseTimestampMs(iso);
  if (!Number.isFinite(ms) || ms < 0) return '刚刚';
  const minutes = Math.floor(ms / 60000);
  if (minutes < 1) return '刚刚';
  if (minutes < 60) return `${minutes} 分钟前`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} 小时前`;
  return `${Math.floor(hours / 24)} 天前`;
}

/** 相对倒计时(移植 ZCode):「9 分钟后」而非绝对时间戳;临近显示「即将运行」。 */
function formatNextRun(iso: string | null): string {
  if (!iso) return '';
  const ms = parseTimestampMs(iso) - Date.now();
  if (!Number.isFinite(ms)) return '';
  if (ms <= 60_000) return '即将运行';
  const minutes = Math.floor(ms / 60000);
  if (minutes < 60) return `${minutes} 分钟后`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} 小时后`;
  return `${Math.floor(hours / 24)} 天后`;
}

/** 星期几中文名列表(dow 逗号表达式)。 */
function weekdayNames(dow: string): string {
  const names: Record<string, string> = { '0': '日', '1': '一', '2': '二', '3': '三', '4': '四', '5': '五', '6': '六', '7': '日' };
  return dow.split(',').map((d) => names[d.trim()] ?? d.trim()).join('、');
}

/**
 * cron → 中文摘要(移植 ZCode automationFormat 思路):
 * 常见模式生成自然语言;覆盖不了回退原始表达式,保证不误导。
 */
function describeCronRich(expr: string): string {
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) return expr;
  const [min, hour, dom, mon, dow] = parts;
  const hhmm = (h: string, m: string) => `${String(Number(h)).padStart(2, '0')}:${String(Number(m)).padStart(2, '0')}`;
  let m: RegExpMatchArray | null;

  if ((m = /^\*\/(\d+)$/.exec(min)) && hour === '*' && dom === '*' && mon === '*' && dow === '*') {
    return `每 ${m[1]} 分钟`;
  }
  if (min !== '*' && (m = /^\*\/(\d+)$/.exec(hour)) && dom === '*' && mon === '*' && dow === '*') {
    return `每 ${m[1]} 小时的第 ${min} 分`;
  }
  if (/^\d+$/.test(min) && hour === '*' && dom === '*' && mon === '*' && dow === '*') {
    return `每小时的第 ${min} 分`;
  }
  if (/^\d+$/.test(min) && /^\d+$/.test(hour) && dom === '*' && mon === '*' && dow === '*') {
    return `每天 ${hhmm(hour, min)}`;
  }
  if (/^\d+$/.test(min) && /^\d+$/.test(hour) && dom === '*' && mon === '*' && dow === '1-5') {
    return `每工作日 ${hhmm(hour, min)}`;
  }
  if (/^\d+$/.test(min) && /^\d+$/.test(hour) && dom === '*' && mon === '*' && dow !== '*') {
    return `每周${weekdayNames(dow)} ${hhmm(hour, min)}`;
  }
  if (/^\d+$/.test(min) && /^\d+$/.test(hour) && /^\d+$/.test(dom) && mon === '*' && dow === '*') {
    return `每月 ${dom} 号 ${hhmm(hour, min)}`;
  }
  return expr;
}

const MODE_LABELS: Record<ScheduleMode, string> = {
  minutes: '每隔几分钟',
  hourly: '每小时',
  daily: '每天',
  weekly: '每周',
  monthly: '每月',
  custom: '自定义 Cron',
};

const inputClass = 'h-9 w-full rounded-md border border-border bg-background px-3 text-sm focus:outline-none focus:ring-1 focus:ring-primary';

type ProviderCapabilities = {
  provider: string;
  permissionModes: string[];
};

type BoundSessionOption = {
  id: string;
  label: string;
};

const PERMISSION_MODE_LABELS: Record<string, string> = {
  default: '默认（需人工确认）',
  auto: '自动',
  acceptEdits: '接受编辑',
  bypassPermissions: '跳过全部权限（无人值守）',
  plan: '计划模式',
  yolo: 'YOLO',
};

export function CronPromptsPanel({ isVisible, onOpenSession }: { isVisible: boolean; onOpenSession?: (sessionId: string) => void }) {
  const [tasks, setTasks] = useState<CronPromptTask[]>([]);
  const [permissionModesByProvider, setPermissionModesByProvider] = useState<Record<string, string[]>>({});
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editing, setEditing] = useState<CronPromptTask | null>(null);
  const [form, setForm] = useState({ name: '', prompt: '', provider: 'claude', projectPath: '', sessionMode: 'new' as 'new' | 'resume', boundSessionId: '', catchUp: true, permissionMode: 'bypassPermissions' });
  const [schedule, setSchedule] = useState<ScheduleState>({ mode: 'daily', interval: '30', minute: '0', hour: '9', weekday: '1', dayOfMonth: '1' });
  const [customCron, setCustomCron] = useState('0 9 * * *');
  const [saving, setSaving] = useState(false);
  const [boundSessions, setBoundSessions] = useState<BoundSessionOption[]>([]);
  const [loadingSessions, setLoadingSessions] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await authenticatedFetch('/api/providers/capabilities');
        if (!res.ok) return;
        const body = await res.json() as { data?: { providers?: ProviderCapabilities[] } };
        const providers = body.data?.providers ?? [];
        if (cancelled || providers.length === 0) return;
        const map: Record<string, string[]> = {};
        for (const p of providers) map[p.provider] = p.permissionModes ?? [];
        setPermissionModesByProvider(map);
      } catch {
        // Keep the hardcoded fallback below when capabilities are unavailable.
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // resume 模式需要选一个既有会话:按 projectPath 找到项目,拉它的会话列表,
  // 只保留 provider 匹配的(driver 会校验 provider 一致性,前端先过滤减少无效选项)。
  useEffect(() => {
    if (form.sessionMode !== 'resume' || !form.projectPath.trim()) {
      setBoundSessions([]);
      return;
    }
    let cancelled = false;
    setLoadingSessions(true);
    (async () => {
      try {
        const normalizedTarget = form.projectPath.trim().replace(/[\\/]+/g, '/').toLowerCase();
        const res = await authenticatedFetch('/api/projects');
        if (!res.ok) return;
        const projects = await res.json() as Array<{
          projectId: string;
          fullPath?: string;
          path?: string;
          sessions?: Array<{ id: string; provider?: string; summary?: string; name?: string; title?: string; lastActivity?: string; updated_at?: string }>;
        }>;
        const project = projects.find((p) => {
          const candidate = (p.fullPath ?? p.path ?? '').replace(/[\\/]+/g, '/').toLowerCase();
          return candidate && candidate === normalizedTarget;
        });
        if (!project || cancelled) return;
        const options = (project.sessions ?? [])
          .filter((s) => (s.provider ?? '') === form.provider)
          .map((s) => ({
            id: String(s.id),
            label: (s.summary || s.name || s.title || s.id).slice(0, 60),
          }));
        if (!cancelled) setBoundSessions(options);
      } catch {
        if (!cancelled) setBoundSessions([]);
      } finally {
        if (!cancelled) setLoadingSessions(false);
      }
    })();
    return () => { cancelled = true; };
  }, [form.sessionMode, form.projectPath, form.provider]);

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

  const cronExpression = schedule.mode === 'custom' ? customCron : buildCron(schedule);
  // Provider changes can invalidate the stored permission mode (e.g. zcode
  // only supports default) — always render a mode the provider accepts.
  const effectivePermissionMode = permissionModesByProvider[form.provider]?.includes(form.permissionMode)
    ? form.permissionMode
    : permissionModesByProvider[form.provider]?.[0] ?? form.permissionMode;

  const openCreate = () => {
    setEditing(null);
    setForm({ name: '', prompt: '', provider: 'claude', projectPath: '', sessionMode: 'new', boundSessionId: '', catchUp: true, permissionMode: 'bypassPermissions' });
    setSchedule({ mode: 'daily', interval: '30', minute: '0', hour: '9', weekday: '1', dayOfMonth: '1' });
    setCustomCron('0 9 * * *');
    setEditorOpen(true);
  };

  const openEdit = (task: CronPromptTask) => {
    setEditing(task);
    setForm({
      name: task.name,
      prompt: task.prompt,
      provider: task.provider,
      projectPath: task.projectPath,
      sessionMode: task.sessionMode === 'resume' ? 'resume' : 'new',
      boundSessionId: task.boundSessionId ?? '',
      catchUp: task.catchUp !== false,
      permissionMode: task.permissionMode || 'bypassPermissions',
    });
    const parsed = parseCron(task.cronExpression);
    setSchedule(parsed);
    setCustomCron(task.cronExpression);
    setEditorOpen(true);
  };

  const save = async () => {
    setSaving(true); setError(null);
    try {
      if (form.sessionMode === 'resume' && !form.boundSessionId) {
        throw new Error('唤醒模式需要选择一个会话');
      }
      const res = await authenticatedFetch(editing ? `/api/cron-prompts/${editing.id}` : '/api/cron-prompts', {
        method: editing ? 'PATCH' : 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          ...form,
          permissionMode: effectivePermissionMode,
          boundSessionId: form.sessionMode === 'resume' ? form.boundSessionId : null,
          cronExpression,
        }),
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
      const body = await res.json() as { data?: { sessionId?: string | null; error?: string } };
      if (body.data?.error) setError(body.data.error);
      if (body.data?.sessionId) onOpenSession?.(body.data.sessionId);
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
              按计划定时让智能体执行 prompt,每次运行生成一个新会话。
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
                      {describeCronRich(task.cronExpression)} · {task.provider} · {task.projectPath}
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
                  <div className="min-w-0">
                    <p className="text-[11px] text-muted-foreground">
                      已运行 {task.runCount} 次 · 上次运行 {formatLastRun(task.lastRunAt)}
                    </p>
                    <p className="mt-0.5 flex items-center gap-1.5 text-[11px]">
                      {task.enabled && (
                        <span className="rounded-full bg-emerald-500/10 px-1.5 py-px font-medium text-emerald-600">
                          下次运行 {formatNextRun(task.nextRunAt)}
                        </span>
                      )}
                      {task.dispatchAttempts > 0 && (
                        <span className="rounded-full bg-amber-500/10 px-1.5 py-px font-medium text-amber-600">
                          {task.retryAt
                            ? `派发失败,${formatNextRun(task.retryAt)}重试(第 ${task.dispatchAttempts + 1} 次)`
                            : `派发失败 ${task.dispatchAttempts} 次,等待下一计划点`}
                        </span>
                      )}
                    </p>
                  </div>
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
            className="flex max-h-[90vh] w-full max-w-lg flex-col overflow-y-auto rounded-xl border border-border bg-card p-5 shadow-2xl"
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
                  className={inputClass}
                />
              </div>

              {/* 频率选择器:自动生成 cron,无需手写表达式 */}
              <div>
                <label className="mb-1 block text-xs text-muted-foreground">执行频率</label>
                <div className="flex flex-wrap gap-1.5">
                  {(Object.keys(MODE_LABELS) as ScheduleMode[]).map((mode) => (
                    <button
                      key={mode}
                      type="button"
                      onClick={() => setSchedule({ ...schedule, mode })}
                      className={cn(
                        'rounded-full px-3 py-1 text-xs font-medium transition-colors',
                        schedule.mode === mode
                          ? 'bg-primary text-primary-foreground'
                          : 'bg-muted text-muted-foreground hover:bg-muted/60',
                      )}
                    >
                      {MODE_LABELS[mode]}
                    </button>
                  ))}
                </div>

                <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
                  {schedule.mode === 'minutes' && (
                    <>
                      <span className="text-xs text-muted-foreground">每</span>
                      <input
                        type="number" min={1} max={59}
                        value={schedule.interval}
                        onChange={(e) => setSchedule({ ...schedule, interval: e.target.value })}
                        className="h-8 w-20 rounded-md border border-border bg-background px-2"
                      />
                      <span className="text-xs text-muted-foreground">分钟执行一次</span>
                    </>
                  )}
                  {schedule.mode === 'hourly' && (
                    <>
                      <span className="text-xs text-muted-foreground">每小时的第</span>
                      <input
                        type="number" min={0} max={59}
                        value={schedule.minute}
                        onChange={(e) => setSchedule({ ...schedule, minute: e.target.value })}
                        className="h-8 w-20 rounded-md border border-border bg-background px-2"
                      />
                      <span className="text-xs text-muted-foreground">分钟执行</span>
                    </>
                  )}
                  {(schedule.mode === 'daily' || schedule.mode === 'weekly' || schedule.mode === 'monthly') && (
                    <>
                      {schedule.mode === 'weekly' && (
                        <select
                          value={schedule.weekday}
                          onChange={(e) => setSchedule({ ...schedule, weekday: e.target.value })}
                          className="h-8 rounded-md border border-border bg-background px-2 text-sm"
                        >
                          {WEEKDAY_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                        </select>
                      )}
                      {schedule.mode === 'monthly' && (
                        <>
                          <span className="text-xs text-muted-foreground">每月</span>
                          <input
                            type="number" min={1} max={31}
                            value={schedule.dayOfMonth}
                            onChange={(e) => setSchedule({ ...schedule, dayOfMonth: e.target.value })}
                            className="h-8 w-20 rounded-md border border-border bg-background px-2"
                          />
                          <span className="text-xs text-muted-foreground">日</span>
                        </>
                      )}
                      <input
                        type="time"
                        value={`${String(Math.min(23, Number(schedule.hour) || 0)).padStart(2, '0')}:${String(Math.min(59, Number(schedule.minute) || 0)).padStart(2, '0')}`}
                        onChange={(e) => {
                          const [h, m] = e.target.value.split(':');
                          setSchedule({ ...schedule, hour: h ?? '9', minute: m ?? '0' });
                        }}
                        className="h-8 rounded-md border border-border bg-background px-2 text-sm"
                      />
                      <span className="text-xs text-muted-foreground">执行</span>
                    </>
                  )}
                  {schedule.mode === 'custom' && (
                    <input
                      value={customCron}
                      onChange={(e) => setCustomCron(e.target.value)}
                      placeholder="分 时 日 月 周,如 0 9 * * 1-5"
                      className="h-8 flex-1 rounded-md border border-border bg-background px-2 font-mono text-xs"
                    />
                  )}
                </div>

                <p className="mt-1.5 text-[11px] text-muted-foreground">
                  <span className="font-mono">{cronExpression}</span> · {describeCron(cronExpression)}
                </p>
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
                <label className="mb-1 block text-xs text-muted-foreground">运行权限</label>
                <select
                  value={effectivePermissionMode}
                  onChange={(e) => setForm({ ...form, permissionMode: e.target.value })}
                  className="h-9 w-full rounded-md border border-border bg-background px-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
                >
                  {(permissionModesByProvider[form.provider] ?? ['default', 'acceptEdits', 'bypassPermissions'])
                    .filter((m) => m !== 'plan')
                    .map((m) => (
                      <option key={m} value={m}>
                        {PERMISSION_MODE_LABELS[m] ?? m}
                      </option>
                    ))}
                </select>
                <p className="mt-1 text-[11px] text-muted-foreground">
                  定时运行为无人值守,建议只读/汇总类任务保持默认确认外的模式;改文件的任务需谨慎授权。
                </p>
              </div>
              <div>
                <label className="mb-1 block text-xs text-muted-foreground">错过补跑</label>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={form.catchUp}
                    onChange={(e) => setForm({ ...form, catchUp: e.target.checked })}
                  />
                  服务重启/睡眠错过计划时间时,启动后自动补跑一次(7 天内有效)
                </label>
                <p className="mt-1 text-[11px] text-muted-foreground">
                  每次停机窗口最多补跑一次,不会按错过周期数重复执行;适合日报、巡检类任务。
                </p>
              </div>
              <div>
                <label className="mb-1 block text-xs text-muted-foreground">会话模式</label>
                <div className="flex gap-4">
                  <label className="flex items-center gap-1.5 text-sm">
                    <input
                      type="radio"
                      name="cron-session-mode"
                      checked={form.sessionMode === 'new'}
                      onChange={() => setForm({ ...form, sessionMode: 'new', boundSessionId: '' })}
                    />
                    每次新会话
                  </label>
                  <label className="flex items-center gap-1.5 text-sm">
                    <input
                      type="radio"
                      name="cron-session-mode"
                      checked={form.sessionMode === 'resume'}
                      onChange={() => setForm({ ...form, sessionMode: 'resume' })}
                    />
                    唤醒既有会话
                  </label>
                </div>
                {form.sessionMode === 'resume' && (
                  <>
                    <select
                      value={form.boundSessionId}
                      onChange={(e) => setForm({ ...form, boundSessionId: e.target.value })}
                      className="mt-2 h-9 w-full rounded-md border border-border bg-background px-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
                    >
                      <option value="">
                        {loadingSessions ? '正在加载会话…' : boundSessions.length === 0 ? '该项目下暂无该智能体的会话' : '选择要唤醒的会话'}
                      </option>
                      {boundSessions.map((s) => (
                        <option key={s.id} value={s.id}>{s.label}</option>
                      ))}
                    </select>
                    <p className="mt-1 text-[11px] text-muted-foreground">
                      每次触发在该会话内追加一轮执行,智能体保留全部历史上下文(类似 Codex 的线程唤醒)。
                    </p>
                  </>
                )}
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
                disabled={saving || !form.name.trim() || !form.prompt.trim() || !form.projectPath.trim() || (form.sessionMode === 'resume' && !form.boundSessionId)}
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
