import { CalendarClock, CalendarDays, Check, ChevronDown, X } from 'lucide-react';
import { useEffect, useState, type FormEvent, type ReactNode } from 'react';

import { api } from '../../utils/api';

import {
  DEFAULT_INTERVAL_MINUTES,
  buildCronExpression,
  parseCronExpression,
  parseRecurringFromExpression,
  type CronPromptTaskView,
  type RecurringRepeat,
} from './cronCalendar';

export type CalendarFormResult = {
  tone: 'success' | 'error';
  message: string;
  /** Ask the parent to refetch schedule sources (real persistence happened). */
  reload?: boolean;
};

type CalendarTaskFormsProps = {
  defaultDate: string;
  projectPath: string;
  /** 非 null 时进入编辑态(日程列表点选 cron 条目)。 */
  editingTask?: CronPromptTaskView | null;
  onDoneEdit?: () => void;
  onResult?: (result: CalendarFormResult) => void;
};

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="calendar-field">
      <span>{label}</span>
      {children}
    </label>
  );
}

export function CalendarTaskForms({ defaultDate, projectPath = '', editingTask = null, onDoneEdit, onResult }: CalendarTaskFormsProps) {
  return (
    <aside className="calendar-task-forms" aria-label="新建任务面板">
      <RecurringTaskForm
        defaultDate={defaultDate}
        projectPath={projectPath}
        editingTask={editingTask}
        onDoneEdit={onDoneEdit}
        onResult={onResult}
      />
      <OneTimeTaskForm defaultDate={defaultDate} projectPath={projectPath} onResult={onResult} />
    </aside>
  );
}

const REPEAT_LABELS: Record<RecurringRepeat, string> = {
  minutes: '每 N 分钟',
  hourly: '每小时',
  daily: '每天',
  weekly: '每周',
  monthly: '每月',
  custom: '自定义…',
};

function RecurringTaskForm({
  defaultDate,
  projectPath = '',
  editingTask = null,
  onDoneEdit,
  onResult,
}: {
  defaultDate: string;
  projectPath?: string;
  editingTask?: CronPromptTaskView | null;
  onDoneEdit?: () => void;
  onResult?: (result: CalendarFormResult) => void;
}) {
  const [name, setName] = useState('');
  const [repeat, setRepeat] = useState<RecurringRepeat>('daily');
  const [time, setTime] = useState('18:00');
  const [startDate, setStartDate] = useState(defaultDate);
  const [intervalMinutes, setIntervalMinutes] = useState(DEFAULT_INTERVAL_MINUTES);
  const [customExpression, setCustomExpression] = useState('');
  // weekly/monthly 编辑回填时来自原表达式的覆盖值;用户改开始日期即失效。
  const [weekdayOverride, setWeekdayOverride] = useState<number | undefined>(undefined);
  const [dayOfMonthOverride, setDayOfMonthOverride] = useState<number | undefined>(undefined);
  const [notifyInbox, setNotifyInbox] = useState(true);
  const [prompt, setPrompt] = useState('');
  const [saving, setSaving] = useState(false);
  const editing = Boolean(editingTask);

  // Picking a day on the calendar re-anchors the form's start date without
  // wiping what the user has typed. Changing the anchor invalidates the
  // weekday/month-day overrides pulled from an edited expression.
  useEffect(() => {
    setStartDate(defaultDate);
    setWeekdayOverride(undefined);
    setDayOfMonthOverride(undefined);
  }, [defaultDate]);

  // 日程列表点选 → 载入该任务进入编辑态。
  useEffect(() => {
    if (!editingTask) return;
    setName(editingTask.name);
    setPrompt(editingTask.prompt);
    setNotifyInbox(editingTask.notifyInbox !== false);
    const parsed = parseRecurringFromExpression(editingTask.cronExpression);
    setRepeat(parsed.repeat);
    setTime(parsed.time);
    setIntervalMinutes(parsed.intervalMinutes);
    setCustomExpression(parsed.customExpression);
    setWeekdayOverride(parsed.weekdayOverride);
    setDayOfMonthOverride(parsed.dayOfMonthOverride);
  }, [editingTask]);

  const resetForm = () => {
    setName('');
    setPrompt('');
    setRepeat('daily');
    setTime('18:00');
    setIntervalMinutes(DEFAULT_INTERVAL_MINUTES);
    setCustomExpression('');
    setWeekdayOverride(undefined);
    setDayOfMonthOverride(undefined);
    setNotifyInbox(true);
    onDoneEdit?.();
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const cronExpression = buildCronExpression({
      repeat,
      time,
      startDate,
      intervalMinutes,
      customExpression,
      weekdayOverride,
      dayOfMonthOverride,
    });
    if (!cronExpression || !parseCronExpression(cronExpression)) {
      onResult?.({
        tone: 'error',
        message: repeat === 'custom' ? '无效的 cron 表达式,请检查格式(分 时 日 月 周)' : '无法生成定时表达式：请检查时间和开始日期',
      });
      return;
    }
    const payloadName = name || '未命名定时任务';
    setSaving(true);
    try {
      const payload = {
        name: payloadName,
        cronExpression,
        prompt: prompt || payloadName || '定时任务',
        ...(projectPath ? { projectPath } : {}),
        notifyInbox,
        notifyEmail: false,
        notifyFeishu: false,
      };
      const res = await (editing
        ? api.patch(`/cron-prompts/${editingTask!.id}`, payload)
        : api.post('/cron-prompts', payload));
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        onResult?.({ tone: 'error', message: `保存失败：${body?.error ?? res.status}` });
        return;
      }
      onResult?.({
        tone: 'success',
        message: `${editing ? '已更新' : '已保存'}定时任务：${payloadName}（${cronExpression}）`,
        reload: true,
      });
      resetForm();
    } catch (e) {
      onResult?.({ tone: 'error', message: `保存失败：${e instanceof Error ? e.message : String(e)}` });
    } finally {
      setSaving(false);
    }
  };

  return (
    <form className="calendar-task-card" onSubmit={submit}>
      <div className="calendar-task-card-heading">
        <div>
          <CalendarClock aria-hidden="true" />
          <h2>{editing ? `编辑：${editingTask!.name}` : '新建定时任务'}</h2>
        </div>
        <button type="button" aria-label="关闭定时任务表单" onClick={() => (editing ? resetForm() : undefined)}><X /></button>
      </div>
      <div className="calendar-form-body">
        <Field label="任务名称"><input value={name} onChange={(event) => setName(event.target.value)} placeholder="例如：每日项目总结" /></Field>
        <div className="calendar-field-row">
          <Field label="重复">
            <span className="calendar-select-wrap">
              <select value={repeat} onChange={(event) => setRepeat(event.target.value as RecurringRepeat)}>
                {(Object.keys(REPEAT_LABELS) as RecurringRepeat[]).map((value) => (
                  <option key={value} value={value}>{REPEAT_LABELS[value]}</option>
                ))}
              </select>
              <ChevronDown aria-hidden="true" />
            </span>
          </Field>
          {repeat === 'minutes' ? (
            <Field label="间隔（分钟）">
              <input
                type="number"
                min={1}
                max={59}
                value={intervalMinutes}
                onChange={(event) => setIntervalMinutes(Number(event.target.value))}
              />
            </Field>
          ) : repeat === 'custom' ? (
            <Field label="表达式（分 时 日 月 周）">
              <input
                value={customExpression}
                onChange={(event) => setCustomExpression(event.target.value)}
                placeholder="0 9 * * 1-5"
              />
            </Field>
          ) : (
            <Field label={repeat === 'hourly' ? '时间（每小时的第 N 分）' : '时间'}>
              <input type="time" value={time} onChange={(event) => setTime(event.target.value)} />
            </Field>
          )}
        </div>
        {repeat !== 'minutes' && repeat !== 'custom' && (
          <Field label="开始日期"><input type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} /></Field>
        )}
        <Field label="结束日期">
          <span className="calendar-select-wrap">
            <select defaultValue="never">
              <option value="never">永不</option>
              <option value="date">指定日期</option>
            </select>
            <ChevronDown aria-hidden="true" />
          </span>
        </Field>
        <Field label="执行内容"><input value={prompt} onChange={(event) => setPrompt(event.target.value)} placeholder="到点执行的任务描述" /></Field>
        <span className="calendar-field-label">关联项目</span>
        <p className="text-xs text-muted-foreground">{projectPath || '未绑定（agent 在用户主目录执行）'}</p>
        <span className="calendar-field-label">通知方式</span>
        <div className="calendar-checkboxes">
          <label><input type="checkbox" checked={notifyInbox} onChange={(event) => setNotifyInbox(event.target.checked)} />站内消息</label>
          <label title="邮件通道尚未接入"><input type="checkbox" disabled />邮件（未接入）</label>
          <label title="飞书通道尚未接入"><input type="checkbox" disabled />飞书（未接入）</label>
        </div>
      </div>
      <div className="calendar-form-actions">
        <button type="submit" className="calendar-primary-button" aria-label={editing ? '保存定时任务修改' : '保存定时任务'} disabled={saving}><Check />{saving ? '保存中…' : '保存'}</button>
        <button type="button" className="calendar-secondary-button" onClick={() => (editing ? resetForm() : undefined)}>{editing ? '取消编辑' : '取消'}</button>
      </div>
    </form>
  );
}

function OneTimeTaskForm({ defaultDate, projectPath = '', onResult }: { defaultDate: string; projectPath?: string; onResult?: (result: CalendarFormResult) => void }) {
  const [name, setName] = useState('');
  const [dateTime, setDateTime] = useState(`${defaultDate}T16:00`);
  const [duration, setDuration] = useState('60');
  const [remind, setRemind] = useState('15');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setDateTime((current) => `${defaultDate}T${current.slice(11) || '16:00'}`);
  }, [defaultDate]);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(dateTime)) {
      onResult?.({ tone: 'error', message: '无效的时间，请重新选择' });
      return;
    }
    setSaving(true);
    try {
      const res = await api.post('/calendar-events', {
        title: name || '未命名任务',
        startsAt: dateTime,
        durationMinutes: Number(duration),
        remindMinutes: remind === '0' ? null : Number(remind),
        notes: notes.trim() || null,
        ...(projectPath ? { projectPath } : {}),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        onResult?.({ tone: 'error', message: `保存失败：${body?.error ?? res.status}` });
        return;
      }
      onResult?.({ tone: 'success', message: `已保存日程：${name || '未命名任务'}（${dateTime.replace('T', ' ')}）`, reload: true });
      setName('');
      setNotes('');
    } catch (e) {
      onResult?.({ tone: 'error', message: `保存失败：${e instanceof Error ? e.message : String(e)}` });
    } finally {
      setSaving(false);
    }
  };

  return (
    <form className="calendar-task-card calendar-one-time-card" onSubmit={submit}>
      <div className="calendar-task-card-heading">
        <div>
          <CalendarDays aria-hidden="true" />
          <h2>新建一次性任务</h2>
        </div>
        <button type="button" aria-label="关闭一次性任务表单"><X /></button>
      </div>
      <div className="calendar-form-body">
        <Field label="任务名称"><input value={name} onChange={(event) => setName(event.target.value)} placeholder="例如：成片最终验收" /></Field>
        <Field label="时间"><input type="datetime-local" value={dateTime} onChange={(event) => setDateTime(event.target.value)} /></Field>
        <Field label="时长">
          <span className="calendar-select-wrap">
            <select value={duration} onChange={(event) => setDuration(event.target.value)}>
              <option value="30">30 分钟</option>
              <option value="60">1 小时</option>
              <option value="120">2 小时</option>
            </select>
            <ChevronDown aria-hidden="true" />
          </span>
        </Field>
        <Field label="参与人">
          <div className="calendar-assignees">
            <button type="button" disabled title="参与人即将支持团队账号">＋添加参与</button>
          </div>
        </Field>
        <Field label="提醒">
          <span className="calendar-select-wrap">
            <select value={remind} onChange={(event) => setRemind(event.target.value)}>
              <option value="0">不提醒</option>
              <option value="15">提前 15 分钟</option>
              <option value="30">提前 30 分钟</option>
            </select>
            <ChevronDown aria-hidden="true" />
          </span>
        </Field>
        <Field label="备注"><textarea value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="补充说明（可选）" rows={2} /></Field>
      </div>
      <div className="calendar-form-actions">
        <button type="submit" className="calendar-primary-button" aria-label="保存一次性任务" disabled={saving}><Check />{saving ? '保存中…' : '保存'}</button>
        <button type="button" className="calendar-secondary-button">取消</button>
      </div>
    </form>
  );
}
