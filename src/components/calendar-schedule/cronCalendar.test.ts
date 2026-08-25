import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildAgendaItems,
  buildCronExpression,
  buildMonthEvents,
  cronMatchesDate,
  cronTimeLabel,
} from './cronCalendar';

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

test('buildMonthEvents expands project cron tasks and kanban schedules', () => {
  const events = buildMonthEvents({
    year: 2026,
    month: 7,
    cronTasks: [
      cronTask(),
      // Different project / disabled tasks must not leak in.
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
  assert.equal(events.some((event) => event.title === '别的项目'), false);
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
