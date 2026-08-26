// server/modules/calendar-events/calendar-events.routes.ts
//
// REST API for the 日历 一次性事件 (auth: user JWT, mounted like /api/cron-prompts).

import { Router } from 'express';

import { calendarEventsStore } from './calendar-events.store.js';

// 'YYYY-MM-DDTHH:mm' — the datetime-local shape, local time, no timezone math.
const STARTS_AT_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;

export function createCalendarEventsRouter(): Router {
  const router = Router();

  router.get('/', (req, res) => {
    const projectPath = typeof req.query.projectPath === 'string' ? req.query.projectPath : undefined;
    res.json({ success: true, data: calendarEventsStore.list(projectPath) });
  });

  router.post('/', (req, res) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const title = typeof body.title === 'string' ? body.title.trim() : '';
    const startsAt = typeof body.startsAt === 'string' ? body.startsAt.trim() : '';
    const projectPath = typeof body.projectPath === 'string' ? body.projectPath.trim() : '';
    if (!title) return res.status(400).json({ error: 'title is required' });
    if (!STARTS_AT_PATTERN.test(startsAt)) {
      return res.status(400).json({ error: `invalid startsAt (expect YYYY-MM-DDTHH:mm): ${startsAt}` });
    }
    if (!projectPath) return res.status(400).json({ error: 'projectPath is required' });
    const durationMinutes = Number(body.durationMinutes);
    const remindRaw = body.remindMinutes;
    const remindMinutes =
      remindRaw === null || remindRaw === undefined || remindRaw === '' ? null : Number(remindRaw);
    const assignees = Array.isArray(body.assignees)
      ? body.assignees.filter((item): item is string => typeof item === 'string')
      : [];
    const notes = typeof body.notes === 'string' && body.notes.trim() ? body.notes.trim() : null;
    const record = calendarEventsStore.create({
      title,
      startsAt,
      durationMinutes: Number.isFinite(durationMinutes) && durationMinutes > 0 ? Math.round(durationMinutes) : 60,
      remindMinutes: remindMinutes !== null && Number.isFinite(remindMinutes) && remindMinutes >= 0 ? Math.round(remindMinutes) : null,
      assignees,
      notes,
      projectPath,
    });
    res.status(201).json({ success: true, data: record });
  });

  router.delete('/:id', (req, res) => {
    const deleted = calendarEventsStore.delete(String(req.params.id));
    if (!deleted) return res.status(404).json({ error: 'event not found' });
    res.json({ success: true });
  });

  return router;
}
