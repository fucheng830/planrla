import { CalendarDays, Plus, X } from 'lucide-react';

import { cn } from '../../lib/utils';

import type { AgendaItem } from './calendarData';

type CalendarAgendaProps = {
  year: number;
  month: number;
  selectedDay: number;
  items?: AgendaItem[];
  onAdd?: () => void;
  onSelect?: (item: AgendaItem) => void;
  /** Delete a one-time calendar event (items carrying eventId). */
  onDeleteEvent?: (eventId: string) => void;
  /** Delete a cron prompt task (items carrying cronId). */
  onDeleteCron?: (cronId: string) => void;
};

export function CalendarAgenda({ year, month, selectedDay, items = [], onAdd, onSelect, onDeleteEvent, onDeleteCron }: CalendarAgendaProps) {
  const weekday = ['日', '一', '二', '三', '四', '五', '六'][new Date(year, month, selectedDay).getDay()];
  return (
    <section className="calendar-agenda" aria-labelledby="calendar-agenda-title">
      <div className="calendar-agenda-heading"><div><h2 id="calendar-agenda-title">日程列表</h2><p>（{month + 1} 月 {selectedDay} 日 星期{weekday}）</p></div><button type="button" className="calendar-agenda-add" aria-label="新增日程" onClick={onAdd}><Plus /></button></div>
      <div className="calendar-agenda-list">{items.map((item) => (
        // div (not button) so one-time events can nest a real delete button.
        <div
          key={item.id}
          role="button"
          tabIndex={0}
          className="calendar-agenda-item"
          onClick={() => onSelect?.(item)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault();
              onSelect?.(item);
            }
          }}
        >
          <span className="calendar-agenda-time">{item.time}<small>{item.duration}</small></span>
          <span className="calendar-agenda-copy"><strong>{item.title}</strong><small><i className={cn('calendar-agenda-dot', `tone-${item.tone}`)} />{item.meta}</small></span>
          {item.eventId && onDeleteEvent ? (
            <button
              type="button"
              className="calendar-agenda-delete"
              aria-label={`删除日程 ${item.title}`}
              onClick={(event) => {
                event.stopPropagation();
                onDeleteEvent(item.eventId!);
              }}
            >
              <X />
            </button>
          ) : null}
          {item.cronId && onDeleteCron ? (
            <button
              type="button"
              className="calendar-agenda-delete"
              aria-label={`删除定时任务 ${item.title}`}
              title="删除整个定时任务(不只是今天这条)"
              onClick={(event) => {
                event.stopPropagation();
                onDeleteCron(item.cronId!);
              }}
            >
              <X />
            </button>
          ) : null}
        </div>
      ))}</div>
      <div className="calendar-agenda-footer"><CalendarDays />共 {items.length} 项日程</div>
    </section>
  );
}
