import { ChevronDown, ChevronLeft, ChevronRight } from 'lucide-react';

import { cn } from './utils';

import type { CalendarEvent } from './calendarData';

type CalendarMonthGridProps = {
  year: number;
  month: number;
  selectedDay: number;
  events: CalendarEvent[];
  onSelectDay: (day: number) => void;
  onMonthChange: (direction: 'previous' | 'next') => void;
  todayDay?: number;
};

const weekdays = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

type MonthCell = { day: number; outside: boolean };

function buildMonthCells(year: number, month: number): MonthCell[][] {
  const firstWeekday = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells: MonthCell[] = [];
  for (let i = firstWeekday; i > 0; i--) {
    cells.push({ day: new Date(year, month, 1 - i).getDate(), outside: true });
  }
  for (let day = 1; day <= daysInMonth; day++) {
    cells.push({ day, outside: false });
  }
  const tail = (7 - (cells.length % 7)) % 7;
  for (let i = 1; i <= tail; i++) {
    cells.push({ day: new Date(year, month + 1, i).getDate(), outside: true });
  }
  const weeks: MonthCell[][] = [];
  for (let i = 0; i < cells.length; i += 7) {
    weeks.push(cells.slice(i, i + 7));
  }
  return weeks;
}

export function CalendarMonthGrid({
  year,
  month,
  selectedDay,
  events,
  onSelectDay,
  onMonthChange,
  todayDay,
}: CalendarMonthGridProps) {
  const monthLabel = `${year} 年 ${month + 1} 月`;
  const weeks = buildMonthCells(year, month);

  return (
    <section className="calendar-month-panel" aria-labelledby="calendar-month-title">
      <div className="calendar-toolbar">
        <div className="calendar-month-actions"><button type="button" aria-label="上个月" onClick={() => onMonthChange('previous')}><ChevronLeft /></button><button type="button" aria-label="下个月" onClick={() => onMonthChange('next')}><ChevronRight /></button><button type="button" id="calendar-month-title" className="calendar-month-label" onClick={() => onMonthChange('next')}>{monthLabel} <ChevronDown /></button>{typeof todayDay === 'number' && <button type="button" className="calendar-today" onClick={() => onSelectDay(todayDay)}>今天</button>}</div>
        <div className="calendar-view-switch" role="group" aria-label="日历视图"><button type="button" className="is-active">月</button><button type="button">周</button><button type="button">日</button></div>
      </div>
      <div className="calendar-grid" role="grid" aria-label={`${monthLabel}日历`}>
        <div className="calendar-weekdays" role="row">{weekdays.map((weekday) => <span key={weekday} role="columnheader">{weekday}</span>)}</div>
        {weeks.map((week, weekIndex) => <div className="calendar-week" role="row" key={`week-${weekIndex}`}>{week.map((cell, dayIndex) => <CalendarDay key={`${weekIndex}-${dayIndex}`} day={cell.day} isOutside={cell.outside} isSelected={!cell.outside && cell.day === selectedDay} events={cell.outside ? [] : events.filter((event) => event.day === cell.day)} onSelectDay={onSelectDay} />)}</div>)}
      </div>
      <button type="button" className="calendar-more-link" onClick={() => onMonthChange('next')}>查看更多日程</button>
    </section>
  );
}

function CalendarDay({ day, isOutside, isSelected, events, onSelectDay }: { day: number; isOutside: boolean; isSelected: boolean; events: CalendarEvent[]; onSelectDay: (day: number) => void }) {
  return <button type="button" role="gridcell" aria-label={`选择日期 ${day} 日`} className={cn('calendar-day', isOutside && 'is-outside', isSelected && 'is-selected')} onClick={() => onSelectDay(day)}><span className="calendar-day-number">{isSelected ? <b>{day}</b> : day}</span><span className="calendar-day-events">{events.slice(0, 2).map((event) => <span className={cn('calendar-event-pill', `tone-${event.tone}`)} key={event.id}><i />{event.title}<time>{event.time}</time></span>)}{events.length > 2 && <span className="calendar-more-pill">+{events.length - 2} 更多</span>}</span></button>;
}
