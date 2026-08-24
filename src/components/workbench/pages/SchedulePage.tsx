import { useMemo, useState } from 'react';
import { CalendarDays, ChevronLeft, ChevronRight } from 'lucide-react';

import { useKanban } from '../../kanban';
import { WorkbenchStatus } from '../WorkbenchStatus';

import { FilterChip, PageShell, PageToolbar } from './PageShell';

type ScheduleKind = 'meeting' | 'cron' | 'once' | 'deadline';

type ScheduleItem = {
  id: string;
  title: string;
  kind: ScheduleKind;
  time: string;
  detail: string;
  state: 'running' | 'waiting' | 'complete';
  stateLabel: string;
};

const KIND_LABEL: Record<ScheduleKind, string> = {
  meeting: '会议',
  cron: '定时任务',
  once: '一次性任务',
  deadline: '交付节点',
};

const KIND_COLOR: Record<ScheduleKind, string> = {
  meeting: 'bg-workbench-accent',
  cron: 'bg-workbench-success',
  once: 'bg-workbench-waiting',
  deadline: 'bg-workbench-danger',
};

const WEEKDAYS = ['一', '二', '三', '四', '五', '六', '日'];

function buildCalendarMap(year: number, month: number) {
  const map = new Map<string, ScheduleItem[]>();
  const add = (day: number, item: ScheduleItem) => {
    const key = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    map.set(key, [...(map.get(key) ?? []), item]);
  };
  add(3, { id: 'm1', title: '需求评审会', kind: 'meeting', time: '10:00', detail: '消息盒子信息架构评审', state: 'waiting', stateLabel: '待参加' });
  add(5, { id: 'c1', title: '每日进展摘要', kind: 'cron', time: '09:30', detail: 'AI 汇总昨日任务并推送项目频道', state: 'complete', stateLabel: '已执行' });
  add(12, { id: 'c2', title: '每周风险扫描', kind: 'cron', time: '18:00', detail: '扫描阻塞任务并创建跟进消息', state: 'waiting', stateLabel: '待执行' });
  add(15, { id: 'o1', title: '客户演示准备', kind: 'once', time: '14:00', detail: '准备演示环境与脚本', state: 'waiting', stateLabel: '待执行' });
  add(20, { id: 'd1', title: 'V0.15 交付节点', kind: 'deadline', time: '18:00', detail: '完成测试验证并整理交付说明', state: 'running', stateLabel: '推进中' });
  return map;
}

export function SchedulePage({ projectName }: { projectName: string }) {
  const { schedules } = useKanban();
  const today = new Date();
  const [year, setYear] = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth());
  const [selectedDay, setSelectedDay] = useState(today.getDate());

  const calendarMap = useMemo(() => buildCalendarMap(year, month), [year, month]);

  const firstDay = new Date(year, month, 1);
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const leadingBlanks = (firstDay.getDay() + 6) % 7;

  const selectedKey = `${year}-${String(month + 1).padStart(2, '0')}-${String(selectedDay).padStart(2, '0')}`;
  const selectedItems = calendarMap.get(selectedKey) ?? [];

  const changeMonth = (delta: number) => {
    const next = new Date(year, month + delta, 1);
    setYear(next.getFullYear());
    setMonth(next.getMonth());
    setSelectedDay(1);
  };

  return (
    <PageShell>
      <PageToolbar
        title="日历与定时任务"
        description={`${projectName} · 会议、提醒、AI 自动任务与交付节点`}
        actions={
          <>
            <FilterChip label="新建定时任务" />
            <FilterChip label="新建一次性任务" />
          </>
        }
      />

      <div className="grid gap-4 xl:grid-cols-[1fr_320px]">
        <section className="ds-panel p-4" aria-label="月历">
          <header className="mb-3 flex items-center justify-between">
            <h2 className="ds-mono text-sm font-semibold text-workbench-ink">{year} 年 {month + 1} 月</h2>
            <div className="flex items-center gap-1">
              <button type="button" onClick={() => changeMonth(-1)} className="ds-focus-ring rounded-md p-1.5 text-workbench-subtle hover:bg-workbench-muted hover:text-workbench-ink" aria-label="上个月">
                <ChevronLeft className="size-4" aria-hidden="true" />
              </button>
              <button type="button" onClick={() => changeMonth(1)} className="ds-focus-ring rounded-md p-1.5 text-workbench-subtle hover:bg-workbench-muted hover:text-workbench-ink" aria-label="下个月">
                <ChevronRight className="size-4" aria-hidden="true" />
              </button>
            </div>
          </header>

          <div className="grid grid-cols-7 gap-1 text-center text-xs text-workbench-subtle">
            {WEEKDAYS.map((d) => <div key={d} className="py-1">{d}</div>)}
          </div>
          <div className="grid grid-cols-7 gap-1">
            {Array.from({ length: leadingBlanks }).map((_, i) => <div key={`blank-${i}`} />)}
            {Array.from({ length: daysInMonth }).map((_, i) => {
              const day = i + 1;
              const key = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
              const items = calendarMap.get(key) ?? [];
              const isToday = day === today.getDate() && month === today.getMonth() && year === today.getFullYear();
              const isSelected = day === selectedDay;
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => setSelectedDay(day)}
                  className={`ds-focus-ring flex min-h-[72px] flex-col rounded-md border p-1.5 text-left transition-colors ${
                    isSelected ? 'border-workbench-accent bg-workbench-accent/5' : 'border-workbench-border bg-workbench-surface hover:bg-workbench-muted'
                  }`}
                >
                  <span className={`ds-mono inline-flex size-5 items-center justify-center rounded-full text-xs ${isToday ? 'bg-workbench-accent font-semibold text-white' : 'text-workbench-ink'}`}>
                    {day}
                  </span>
                  <span className="mt-1 space-y-0.5">
                    {items.slice(0, 2).map((item) => (
                      <span key={item.id} className="flex items-center gap-1 truncate text-[10px] text-workbench-subtle">
                        <span className={`size-1.5 flex-shrink-0 rounded-full ${KIND_COLOR[item.kind]}`} />
                        {item.title}
                      </span>
                    ))}
                    {items.length > 2 && <span className="text-[10px] text-workbench-subtle">+{items.length - 2} 更多</span>}
                  </span>
                </button>
              );
            })}
          </div>
        </section>

        <div className="flex flex-col gap-4">
          <section className="ds-panel p-4" aria-label="当日日程">
            <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-workbench-ink">
              <CalendarDays className="size-4" aria-hidden="true" />
              {month + 1} 月 {selectedDay} 日
            </h2>
            {selectedItems.length === 0 ? (
              <p className="py-6 text-center text-sm text-workbench-subtle">当天没有日程</p>
            ) : (
              <ul className="space-y-2">
                {selectedItems.map((item) => (
                  <li key={item.id} className="rounded-md border border-workbench-border bg-workbench-surface p-3">
                    <div className="flex items-center justify-between gap-2">
                      <span className="min-w-0 truncate text-sm font-medium text-workbench-ink">{item.title}</span>
                      <WorkbenchStatus state={item.state} label={item.stateLabel} />
                    </div>
                    <p className="mt-1 text-xs text-workbench-subtle">{item.time} · {KIND_LABEL[item.kind]}</p>
                    <p className="mt-1 text-xs text-workbench-subtle">{item.detail}</p>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="ds-panel p-4" aria-label="项目定时任务">
            <h2 className="mb-3 text-sm font-semibold text-workbench-ink">项目定时任务</h2>
            {schedules.length === 0 ? (
              <p className="py-4 text-center text-xs text-workbench-subtle">暂无看板定时任务</p>
            ) : (
              <ul className="space-y-2">
                {schedules.slice(0, 4).map((s) => (
                  <li key={s.id} className="rounded-md border border-workbench-border bg-workbench-surface p-2.5">
                    <p className="truncate text-sm font-medium text-workbench-ink">{s.input || '未命名任务'}</p>
                    <p className="ds-mono mt-0.5 text-xs text-workbench-subtle">{s.cronExpression} · {s.enabled ? '已启用' : '已停用'}</p>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </div>
    </PageShell>
  );
}
