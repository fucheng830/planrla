import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildAgendaItems,
  buildCronExpression,
  buildMonthEvents,
  cronMatchesDate,
  cronTimeLabel,
  eventDurationLabel,
  parseRecurringFromExpression,
} from './cronCalendar.ts';

const cronTask = (overrides: Partial<Parameters<typeof buildMonthEvents>[0]['cronTasks'][number]> = {}) => ({
  id: 'task-1',
  name: '每日定时总结',
  cronExpression: '0 18 * * *',
  prompt: '总结',
  provider: 'claude',
  projectPath: 'C:/workspace/项目/planrla',
  enabled: true,
  lastRunAt: null,
  runCount: 3,
  ...overrides,
});

const schedule = (overrides: Partial<Parameters<typeof buildMonthEvents>[0]['schedules'][number]> = {}) => ({
  id: 'sch-1',
  rootId: 'root-1',
  taskTemplateId: 'tpl-1',
  cronExpression: '30 9 * * 1',
  enabled: true,
  input: '每周需求梳理',
  lastRunAt: null,
  ...overrides,
});

const calendarEvent = (overrides: Partial<NonNullable<Parameters<typeof buildMonthEvents>[0]['events']>[number]> = {}) => ({
  id: 'evt-1',
  title: '成片最终验收',
  startsAt: '2026-08-28T16:00',
  durationMinutes: 90,
  remindMinutes: 15,
  notes: '准备验收清单',
  ...overrides,
});

test('cronMatchesDate handles daily expressions', () => {
  assert.equal(cronMatchesDate('0 18 * * *', new Date(2026, 7, 1)), true);
  assert.equal(cronMatchesDate('0 18 * * *', new Date(2026, 7, 31)), true);
});

test('cronMatchesDate handles weekly day-of-week including Sunday as 0 and 7', () => {
  // 2026-08-03 is a Monday
  assert.equal(cronMatchesDate('30 9 * * 1', new Date(2026, 7, 3)), true);
  assert.equal(cronMatchesDate('30 9 * * 1', new Date(2026, 7, 4)), false);
  // 2026-08-02 is a Sunday
  assert.equal(cronMatchesDate('0 10 * * 0', new Date(2026, 7, 2)), true);
  assert.equal(cronMatchesDate('0 10 * * 7', new Date(2026, 7, 2)), true);
});

test('cronMatchesDate handles monthly day-of-month', () => {
  assert.equal(cronMatchesDate('0 10 8 * *', new Date(2026, 7, 8)), true);
  assert.equal(cronMatchesDate('0 10 8 * *', new Date(2026, 7, 9)), false);
});

test('cronMatchesDate applies OR when dom and dow are both restricted', () => {
  // vixie semantics: fires on the 1st OR every Friday. 2026-08-01 is a Saturday.
  assert.equal(cronMatchesDate('0 6 1 * 5', new Date(2026, 7, 1)), true); // dom
  assert.equal(cronMatchesDate('0 6 1 * 5', new Date(2026, 7, 7)), true); // Friday
  assert.equal(cronMatchesDate('0 6 1 * 5', new Date(2026, 7, 2)), false);
});

test('cronMatchesDate supports lists, ranges and steps', () => {
  assert.equal(cronMatchesDate('0 9 1,15 * *', new Date(2026, 7, 1)), true);
  assert.equal(cronMatchesDate('0 9 1,15 * *', new Date(2026, 7, 15)), true);
  assert.equal(cronMatchesDate('0 9 1,15 * *', new Date(2026, 7, 16)), false);
  assert.equal(cronMatchesDate('0 9 10-20 * *', new Date(2026, 7, 12)), true);
  assert.equal(cronMatchesDate('0 9 10-20 * *', new Date(2026, 7, 21)), false);
  assert.equal(cronMatchesDate('0 9 */2 * *', new Date(2026, 7, 3)), true);
  assert.equal(cronMatchesDate('0 9 */2 * *', new Date(2026, 7, 2)), false);
});

test('cronMatchesDate ignores a leading seconds field', () => {
  assert.equal(cronMatchesDate('0 0 18 * * *', new Date(2026, 7, 1)), true);
});

test('cronMatchesDate rejects invalid expressions', () => {
  assert.equal(cronMatchesDate('not a cron', new Date(2026, 7, 1)), false);
  assert.equal(cronMatchesDate('0 18', new Date(2026, 7, 1)), false);
});

test('cronTimeLabel extracts HH:mm when hour and minute are pinned', () => {
  assert.equal(cronTimeLabel('0 18 * * *'), '18:00');
  assert.equal(cronTimeLabel('30 9 * * 1'), '09:30');
  assert.equal(cronTimeLabel('*/15 * * * *'), null);
  assert.equal(cronTimeLabel('0 8,20 * * *'), null);
});

test('buildCronExpression maps the recurring form to cron fields', () => {
  assert.equal(buildCronExpression({ repeat: 'daily', time: '18:00', startDate: '2026-08-25' }), '0 18 * * *');
  // 2026-08-26 is a Wednesday (3)
  assert.equal(buildCronExpression({ repeat: 'weekly', time: '09:30', startDate: '2026-08-26' }), '30 9 * * 3');
  assert.equal(buildCronExpression({ repeat: 'monthly', time: '10:05', startDate: '2026-08-08' }), '5 10 8 * *');
  assert.equal(buildCronExpression({ repeat: 'daily', time: '25:00', startDate: '2026-08-25' }), null);
  assert.equal(buildCronExpression({ repeat: 'daily', time: '18:00', startDate: 'not-a-date' }), null);
});

test('buildCronExpression supports hourly/minutes/custom repeats with validation', () => {
  // hourly 只取分钟位
  assert.equal(buildCronExpression({ repeat: 'hourly', time: '00:45', startDate: '2026-08-25' }), '45 * * * *');
  // minutes: */n 形态,边界外拒绝
  assert.equal(buildCronExpression({ repeat: 'minutes', time: '00:00', startDate: '', intervalMinutes: 20 }), '*/20 * * * *');
  assert.equal(buildCronExpression({ repeat: 'minutes', time: '00:00', startDate: '', intervalMinutes: 0 }), null);
  assert.equal(buildCronExpression({ repeat: 'minutes', time: '00:00', startDate: '', intervalMinutes: 60 }), null);
  // custom: 原样保存 + 完整校验
  assert.equal(buildCronExpression({ repeat: 'custom', time: '18:00', startDate: '', customExpression: '0 9 * * 1-5' }), '0 9 * * 1-5');
  assert.equal(buildCronExpression({ repeat: 'custom', time: '18:00', startDate: '', customExpression: 'not cron' }), null);
});

test('parseRecurringFromExpression round-trips the recurring form shapes', () => {
  const daily = parseRecurringFromExpression('30 14 * * *');
  assert.equal(daily.repeat, 'daily');
  assert.equal(daily.time, '14:30');
  const weekly = parseRecurringFromExpression('15 9 * * 1');
  assert.equal(weekly.repeat, 'weekly');
  assert.equal(weekly.weekdayOverride, 1);
  const monthly = parseRecurringFromExpression('5 10 8 * *');
  assert.equal(monthly.repeat, 'monthly');
  assert.equal(monthly.dayOfMonthOverride, 8);
  const minutes = parseRecurringFromExpression('*/20 * * * *');
  assert.equal(minutes.repeat, 'minutes');
  assert.equal(minutes.intervalMinutes, 20);
  const hourly = parseRecurringFromExpression('45 * * * *');
  assert.equal(hourly.repeat, 'hourly');
  const complex = parseRecurringFromExpression('0 9,18 * * 1-5');
  assert.equal(complex.repeat, 'custom');
  assert.equal(complex.customExpression, '0 9,18 * * 1-5');
});

// 编辑回填的覆盖值:不改开始日期直接保存,星期/日期不得漂移。
test('weekday/dayOfMonth overrides keep edited weekly/monthly tasks anchored', () => {
  // 表达式是每周一;今天不是周一,但覆盖值来自原表达式 → 重建结果不变。
  assert.equal(
    buildCronExpression({ repeat: 'weekly', time: '09:30', startDate: '2026-08-27', weekdayOverride: 1 }),
    '30 9 * * 1',
  );
  assert.equal(
    buildCronExpression({ repeat: 'monthly', time: '10:05', startDate: '2026-08-27', dayOfMonthOverride: 8 }),
    '5 10 8 * *',
  );
});

test('buildMonthEvents expands project cron tasks and kanban schedules', () => {
  const events = buildMonthEvents({
    year: 2026,
    month: 7,
    cronTasks: [
      cronTask(),
      // 全局可见(eadcc7e):其它项目的任务同样展开;停用的必须不出现。
      cronTask({ id: 'task-2', projectPath: 'C:/other', name: '别的项目' }),
      cronTask({ id: 'task-3', enabled: false, name: '已停用' }),
    ],
    schedules: [schedule()],
    projectPath: 'C:\\workspace\\项目\\planrla',
  });

  const dailyEvents = events.filter((event) => event.title === '每日定时总结');
  assert.equal(dailyEvents.length, 31); // every day of August 2026
  assert.equal(dailyEvents[0].time, '18:00');
  assert.equal(dailyEvents[0].tone, 'cyan');
  const weeklyEvents = events.filter((event) => event.title === '每周需求梳理');
  assert.equal(weeklyEvents.length, 5); // Mondays in August 2026 (3/10/17/24/31)
  assert.equal(weeklyEvents[0].day, 3);
  // 定时任务全局可见(eadcc7e):别的项目的任务也要展开;停用的不出现。
  assert.equal(events.some((event) => event.title === '别的项目'), true);
  assert.equal(events.some((event) => event.title === '已停用'), false);
});

test('buildAgendaItems lists occurrences for the selected day', () => {
  // 2026-08-03 is a Monday: daily task + weekly schedule both fire.
  const monday = buildAgendaItems({
    year: 2026,
    month: 7,
    day: 3,
    cronTasks: [cronTask()],
    schedules: [schedule()],
    projectPath: 'C:/workspace/项目/planrla',
  });
  assert.equal(monday.length, 2);
  assert.equal(monday[0].time, '09:30');
  assert.match(monday[0].meta, /看板排程/);
  assert.equal(monday[1].time, '18:00');
  assert.match(monday[1].meta, /已执行 3 次/);

  // Sunday 2026-08-02: only the daily task fires.
  const sunday = buildAgendaItems({
    year: 2026,
    month: 7,
    day: 2,
    cronTasks: [cronTask()],
    schedules: [schedule()],
    projectPath: 'C:/workspace/项目/planrla',
  });
  assert.equal(sunday.length, 1);
});

test('buildMonthEvents maps one-time calendar events onto their day', () => {
  const events = buildMonthEvents({
    year: 2026,
    month: 7,
    cronTasks: [],
    schedules: [],
    events: [
      calendarEvent(),
      calendarEvent({ id: 'evt-2', startsAt: '2026-09-02T10:00' }), // next month — dropped
      calendarEvent({ id: 'evt-3', startsAt: 'bad-shape' }), // malformed — day NaN but filtered by prefix
    ],
    projectPath: 'C:/workspace/项目/planrla',
  });
  const valid = events.filter((event) => event.id.startsWith('event-evt-1'));
  assert.equal(valid.length, 1);
  assert.equal(valid[0].day, 28);
  assert.equal(valid[0].time, '16:00');
  assert.equal(valid[0].tone, 'blue');
  // malformed startsAt doesn't match the month prefix, so it never lands
  assert.equal(events.filter((event) => event.id.startsWith('event-evt-3')).length, 0);
});

test('buildAgendaItems marks one-time events as deletable with duration and reminder', () => {
  const items = buildAgendaItems({
    year: 2026,
    month: 7,
    day: 28,
    cronTasks: [],
    schedules: [],
    events: [calendarEvent()],
    projectPath: 'C:/workspace/项目/planrla',
  });
  assert.equal(items.length, 1);
  assert.equal(items[0].eventId, 'evt-1');
  assert.equal(items[0].time, '16:00');
  assert.equal(items[0].duration, '1 小时 30 分钟');
  assert.match(items[0].meta, /一次性日程/);
  assert.match(items[0].meta, /提前 15 分钟提醒/);
});

test('buildAgendaItems omits events on other days and hides reminder when off', () => {
  const otherDay = buildAgendaItems({
    year: 2026,
    month: 7,
    day: 27,
    cronTasks: [],
    schedules: [],
    events: [calendarEvent()],
    projectPath: 'C:/workspace/项目/planrla',
  });
  assert.equal(otherDay.length, 0);

  const noRemind = buildAgendaItems({
    year: 2026,
    month: 7,
    day: 28,
    cronTasks: [],
    schedules: [],
    events: [calendarEvent({ remindMinutes: null, notes: null })],
    projectPath: 'C:/workspace/项目/planrla',
  });
  assert.doesNotMatch(noRemind[0].meta, /提前/);
  assert.equal(noRemind[0].meta, '一次性日程');
});

test('eventDurationLabel formats hours and minutes', () => {
  assert.equal(eventDurationLabel(90), '1 小时 30 分钟');
  assert.equal(eventDurationLabel(60), '1 小时');
  assert.equal(eventDurationLabel(45), '45 分钟');
  assert.equal(eventDurationLabel(0), '—');
});
