import { CalendarDays, MoreHorizontal, Plus } from 'lucide-react';

import { cn } from '../../lib/utils';

import type { AgendaItem } from './calendarData';

type CalendarAgendaProps = {
  year: number;
  month: number;
  selectedDay: number;
  items?: AgendaItem[];
  onAdd?: () => void;
  onSelect?: (item: AgendaItem) => void;
};

export function CalendarAgenda({ year, month, selectedDay, items = [], onAdd, onSelect }: CalendarAgendaProps) {
  const weekday = ['日', '一', '二', '三', '四', '五', '六'][new Date(year, month, selectedDay).getDay()];
  return (
    <section className="calendar-agenda" aria-labelledby="calendar-agenda-title">
      <div className="calendar-agenda-heading"><div><h2 id="calendar-agenda-title">日程列表</h2><p>（{month + 1} 月 {selectedDay} 日 星期{weekday}）</p></div><button type="button" className="calendar-agenda-add" aria-label="新增日程" onClick={onAdd}><Plus /></button></div>
      <div className="calendar-agenda-list">{items.map((item) => <button type="button" className="calendar-agenda-item" key={item.id} onClick={() => onSelect?.(item)}><span className="calendar-agenda-time">{item.time}<small>{item.duration}</small></span><span className="calendar-agenda-copy"><strong>{item.title}</strong><small><i className={cn('calendar-agenda-dot', `tone-${item.tone}`)} />{item.meta}</small></span><MoreHorizontal className="calendar-agenda-more" /></button>)}</div>
      <div className="calendar-agenda-footer"><CalendarDays />共 {items.length} 项日程</div>
    </section>
  );
}
