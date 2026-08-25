import { CalendarClock, CalendarDays, Check, ChevronDown, X } from 'lucide-react';
import { useState, type FormEvent, type ReactNode } from 'react';

type CalendarTaskFormsProps = {
  defaultDate: string;
  onSaved?: (message: string) => void;
};

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="calendar-field">
      <span>{label}</span>
      {children}
    </label>
  );
}

export function CalendarTaskForms({ defaultDate, onSaved }: CalendarTaskFormsProps) {
  return (
    <aside className="calendar-task-forms" aria-label="新建任务面板">
      <RecurringTaskForm defaultDate={defaultDate} onSaved={onSaved} />
      <OneTimeTaskForm defaultDate={defaultDate} onSaved={onSaved} />
    </aside>
  );
}

function RecurringTaskForm({ defaultDate, onSaved }: { defaultDate: string; onSaved?: (message: string) => void }) {
  const [name, setName] = useState('每日定时总结');
  const [time, setTime] = useState('18:00');
  const [prompt, setPrompt] = useState('自动生成当日项目进展和风险摘要');

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    onSaved?.(`已保存定时任务：${name || '未命名任务'}`);
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
              <select defaultValue="daily">
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
          <Field label="开始日期"><input type="date" defaultValue={defaultDate} /></Field>
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
        <Field label="执行内容"><input value={prompt} onChange={(event) => setPrompt(event.target.value)} /></Field>
        <span className="calendar-field-label">通知方式</span>
        <div className="calendar-checkboxes">
          <label><input type="checkbox" defaultChecked />站内消息</label>
          <label><input type="checkbox" defaultChecked />邮件</label>
          <label><input type="checkbox" />飞书</label>
        </div>
      </div>
      <div className="calendar-form-actions">
        <button type="submit" className="calendar-primary-button" aria-label="保存定时任务"><Check />保存</button>
        <button type="button" className="calendar-secondary-button">取消</button>
      </div>
    </form>
  );
}

function OneTimeTaskForm({ defaultDate, onSaved }: { defaultDate: string; onSaved?: (message: string) => void }) {
  const [name, setName] = useState('成片最终验收');

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    onSaved?.(`已保存一次性任务：${name || '未命名任务'}`);
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
        <Field label="任务名称"><input value={name} onChange={(event) => setName(event.target.value)} /></Field>
        <div className="calendar-field-row">
          <Field label="时间"><input type="datetime-local" defaultValue={`${defaultDate}T16:00`} /></Field>
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
