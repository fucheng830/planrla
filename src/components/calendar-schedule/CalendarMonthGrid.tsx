import { ChevronDown, ChevronLeft, ChevronRight } from 'lucide-react';

import { cn } from '../../lib/utils';
import { calendarEvents, monthWeeks } from './calendarData';

type CalendarMonthGridProps = {
  year: number;
  month: number;
  selectedDay: number;
  onSelectDay: (day: number) => void;
  onMonthChange: (direction: 'previous' | 'next') => void;
  todayDay?: number;
};

const weekdays = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

export function CalendarMonthGrid({
  year,
  month,
  selectedDay,
  onSelectDay,
  onMonthChange,
  todayDay,
}: CalendarMonthGridProps) {
  const monthLabel = `${year} 年 ${month + 1} 月`;

  return (
    <section className="calendar-month-panel" aria-labelledby="calendar-month-title">
      <div className="calendar-toolbar">
        <div className="calendar-month-actions"><button type="button" aria-label="上个月" onClick={() => onMonthChange('previous')}><ChevronLeft /></button><button type="button" aria-label="下个月" onClick={() => onMonthChange('next')}><ChevronRight /></button><button type="button" id="calendar-month-title" className="calendar-month-label" onClick={() => onMonthChange('next')}>{monthLabel} <ChevronDown /></button>{typeof todayDay === 'number' && <button type="button" className="calendar-today" onClick={() => onSelectDay(todayDay)}>今天</button>}</div>
        <div className="calendar-view-switch" role="group" aria-label="日历视图"><button type="button" className="is-active">月</button><button type="button">周</button><button type="button">日</button></div>
      </div>
      <div className="calendar-grid" role="grid" aria-label={`${monthLabel}日历`}>
        <div className="calendar-weekdays" role="row">{weekdays.map((weekday) => <span key={weekday} role="columnheader">{weekday}</span>)}</div>
        {monthWeeks.map((week, weekIndex) => <div className="calendar-week" role="row" key={`week-${weekIndex}`}>{week.map((day, dayIndex) => <CalendarDay key={`${weekIndex}-${dayIndex}`} day={day} isOutside={(weekIndex === 0 && day > 20) || (weekIndex === 4 && day === 1)} isSelected={day === selectedDay && weekIndex === 1} events={calendarEvents.filter((event) => event.day === day)} onSelectDay={onSelectDay} />)}</div>)}
      </div>
      <button type="button" className="calendar-more-link" onClick={() => onMonthChange('next')}>查看更多日程</button>
    </section>
  );
}

function CalendarDay({ day, isOutside, isSelected, events, onSelectDay }: { day: number; isOutside: boolean; isSelected: boolean; events: typeof calendarEvents; onSelectDay: (day: number) => void }) {
  const visibleEvents = isOutside ? [] : events;
  return <button type="button" role="gridcell" aria-label={`选择日期 ${day} 日`} className={cn('calendar-day', isOutside && 'is-outside', isSelected && 'is-selected')} onClick={() => onSelectDay(day)}><span className="calendar-day-number">{isSelected ? <b>{day}</b> : day}</span><span className="calendar-day-events">{visibleEvents.slice(0, 2).map((event) => <span className={cn('calendar-event-pill', `tone-${event.tone}`)} key={event.id}><i />{event.title}<time>{event.time}</time></span>)}{visibleEvents.length > 2 && <span className="calendar-more-pill">+{visibleEvents.length - 2} 更多</span>}</span></button>;
}
