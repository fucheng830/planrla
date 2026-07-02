import { test } from 'node:test';
import assert from 'node:assert/strict';
import { groupSessionRowsByProject } from './project-session-grouping.js';

// 批量 SQL 返回的行：每行带 project_path / rn（组内序号，1 起）/ total（该项目总数）
const row = (projectPath: string, rn: number, total: number, id: string, updated_at: string) => ({
  session_id: id,
  provider: 'claude',
  custom_name: null,
  project_path: projectPath,
  updated_at,
  created_at: updated_at,
  rn,
  total,
});

test('每个项目的首页 session 按 rn<=limit 取，total/hasMore 正确', () => {
  const rows = [
    row('/a', 1, 3, 'a1', '2026-07-02T10:00:00Z'),
    row('/a', 2, 3, 'a2', '2026-07-02T09:00:00Z'),
    // /a total=3, limit=2 → 2 条返回，hasMore=true
    row('/b', 1, 1, 'b1', '2026-07-02T08:00:00Z'),
  ];
  const map = groupSessionRowsByProject(rows, ['/a', '/b'], { limit: 2, offset: 0 });
  assert.equal(map.size, 2);
  assert.equal(map.get('/a')!.sessions.length, 2);
  assert.equal(map.get('/a')!.total, 3);
  assert.equal(map.get('/a')!.hasMore, true);
  assert.equal(map.get('/b')!.sessions.length, 1);
  assert.equal(map.get('/b')!.hasMore, false);
});

test('0 session 的项目 → 空页 + total 0', () => {
  const map = groupSessionRowsByProject([], ['/empty', '/a'], { limit: 20, offset: 0 });
  assert.equal(map.get('/empty')!.sessions.length, 0);
  assert.equal(map.get('/empty')!.total, 0);
  assert.equal(map.get('/empty')!.hasMore, false);
});

test('每条 session 映射为 SessionSummary（id/provider/summary/lastActivity）', () => {
  const rows = [row('/a', 1, 1, 'a1', '2026-07-02T10:00:00Z')];
  const [s] = groupSessionRowsByProject(rows, ['/a'], { limit: 20, offset: 0 }).get('/a')!.sessions;
  assert.equal(s.id, 'a1');
  assert.equal(s.provider, 'claude');
  assert.equal(s.summary, '');
  assert.equal(s.lastActivity, '2026-07-02T10:00:00Z');
});
