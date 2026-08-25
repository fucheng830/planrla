import { CalendarClock, CalendarDays, Check, ChevronDown, X } from 'lucide-react';
import { useEffect, useState, type FormEvent, type ReactNode } from 'react';

import { api } from '../../utils/api';

import { buildCronExpression, type RecurringRepeat } from './cronCalendar';

export type CalendarFormResult = {
  tone: 'success' | 'error';
  message: string;
  /** Ask the parent to refetch schedule sources (real persistence happened). */
  reload?: boolean;
};

type CalendarTaskFormsProps = {
  defaultDate: string;
  projectPath: string;
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

export function CalendarTaskForms({ defaultDate, projectPath, onResult }: CalendarTaskFormsProps) {
  return (
    <aside className="calendar-task-forms" aria-label="新建任务面板">
      <RecurringTaskForm defaultDate={defaultDate} projectPath={projectPath} onResult={onResult} />
      <OneTimeTaskForm defaultDate={defaultDate} onResult={onResult} />
    </aside>
  );
}

function RecurringTaskForm({ defaultDate, projectPath, onResult }: { defaultDate: string; projectPath: string; onResult?: (result: CalendarFormResult) => void }) {
  const [name, setName] = useState('');
  const [repeat, setRepeat] = useState<RecurringRepeat>('daily');
  const [time, setTime] = useState('18:00');
  const [startDate, setStartDate] = useState(defaultDate);
  const [prompt, setPrompt] = useState('');
  const [saving, setSaving] = useState(false);

  // Picking a day on the calendar re-anchors the form's start date without
  // wiping what the user has typed.
  useEffect(() => {
    setStartDate(defaultDate);
  }, [defaultDate]);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const cronExpression = buildCronExpression({ repeat, time, startDate });
    if (!cronExpression) {
      onResult?.({ tone: 'error', message: '无法生成定时表达式：请检查时间和开始日期' });
      return;
    }
    setSaving(true);
    try {
      const res = await api.post('/cron-prompts', {
        name: name || '未命名定时任务',
        cronExpression,
        prompt: prompt || name || '定时任务',
        projectPath,
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        onResult?.({ tone: 'error', message: `保存失败：${body?.error ?? res.status}` });
        return;
      }
      onResult?.({ tone: 'success', message: `已保存定时任务：${name || '未命名定时任务'}（${cronExpression}）`, reload: true });
      setName('');
      setPrompt('');
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
          <h2>新建定时任务</h2>
        </div>
        <button type="button" aria-label="关闭定时任务表单"><X /></button>
      </div>
      <div className="calendar-form-body">
        <Field label="任务名称"><input value={name} onChange={(event) => setName(event.target.value)} placeholder="例如：每日项目总结" /></Field>
        <div className="calendar-field-row">
          <Field label="重复">
            <span className="calendar-select-wrap">
              <select value={repeat} onChange={(event) => setRepeat(event.target.value as RecurringRepeat)}>
                <option value="daily">每天</option>
                <option value="weekly">每周</option>
                <option value="monthly">每月</option>
              </select>
              <ChevronDown aria-hidden="true" />
            </span>
          </Field>
          <Field label="时间"><input type="time" value={time} onChange={(event) => setTime(event.target.value)} /></Field>
        </div>
        <div className="calendar-field-row">
          <Field label="开始日期"><input type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} /></Field>
          <Field label="结束日期">
            <span className="calendar-select-wrap">
              <select defaultValue="never">
                <option value="never">永不</option>
                <option value="date">指定日期</option>
              </select>
              <ChevronDown aria-hidden="true" />
            </span>
          </Field>
        </div>
        <Field label="执行内容"><input value={prompt} onChange={(event) => setPrompt(event.target.value)} placeholder="到点执行的任务描述" /></Field>
        <span className="calendar-field-label">通知方式</span>
        <div className="calendar-checkboxes">
          <label><input type="checkbox" defaultChecked />站内消息</label>
          <label><input type="checkbox" defaultChecked />邮件</label>
          <label><input type="checkbox" />飞书</label>
        </div>
      </div>
      <div className="calendar-form-actions">
        <button type="submit" className="calendar-primary-button" aria-label="保存定时任务" disabled={saving}><Check />{saving ? '保存中…' : '保存'}</button>
        <button type="button" className="calendar-secondary-button">取消</button>
      </div>
    </form>
  );
}

function OneTimeTaskForm({ defaultDate, onResult }: { defaultDate: string; onResult?: (result: CalendarFormResult) => void }) {
  const [name, setName] = useState('');
  const [dateTime, setDateTime] = useState(`${defaultDate}T16:00`);

  useEffect(() => {
    setDateTime((current) => `${defaultDate}T${current.slice(11) || '16:00'}`);
  }, [defaultDate]);

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    // One-time events still need the calendar_events table (phase 2); the
    // form stays honest instead of pretending the save persisted.
    onResult?.({ tone: 'success', message: `已记录一次性任务：${name || '未命名任务'}（暂未持久化，日历事件表接入后生效）` });
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
        <div className="calendar-field-row">
          <Field label="时间"><input type="datetime-local" value={dateTime} onChange={(event) => setDateTime(event.target.value)} /></Field>
          <Field label="时长">
            <span className="calendar-select-wrap">
              <select defaultValue="1h">
                <option value="30m">30 分钟</option>
                <option value="1h">1 小时</option>
                <option value="2h">2 小时</option>
              </select>
              <ChevronDown aria-hidden="true" />
            </span>
          </Field>
        </div>
        <Field label="参与人">
          <div className="calendar-assignees">
            <span className="calendar-avatar">🐟</span>
            <span className="calendar-avatar">王</span>
            <span className="calendar-avatar">正</span>
            <button type="button">＋添加参与</button>
          </div>
        </Field>
        <Field label="提醒">
          <span className="calendar-select-wrap">
            <select defaultValue="15">
              <option value="0">不提醒</option>
              <option value="15">提前 15 分钟</option>
              <option value="30">提前 30 分钟</option>
            </select>
            <ChevronDown aria-hidden="true" />
          </span>
        </Field>
        <Field label="备注"><textarea defaultValue="请提前准备验收清单" rows={2} /></Field>
      </div>
      <div className="calendar-form-actions">
        <button type="submit" className="calendar-primary-button" aria-label="保存一次性任务"><Check />保存</button>
        <button type="button" className="calendar-secondary-button">取消</button>
      </div>
    </form>
  );
}
