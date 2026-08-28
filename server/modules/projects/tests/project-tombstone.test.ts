// 「已忘记」项目墓碑:DELETE 已归档项目 = 删行+记墓碑(保留会话数据),
// 会话同步再次扫到该路径必须保持归档不复活;显式恢复清墓碑。
// DB 隔离:DATABASE_PATH 指向临时文件 + 动态 import(getConnection 单例惰性)。
import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

process.env.DATABASE_PATH = path.join(mkdtempSync(path.join(tmpdir(), 'tombstone-')), 'test.db');
const { getConnection } = await import('@/modules/database/index.js');
const { INIT_SCHEMA_SQL } = await import('@/modules/database/index.js');
getConnection().exec(INIT_SCHEMA_SQL);

const { projectsDb } = await import('@/modules/database/index.js');
const { deleteOrArchiveProject, restoreArchivedProject } = await import('@/modules/projects/services/project-delete.service.js');

const HOME_DIR = path.join(tmpdir(), 'fake-home', 'HONOR');

test('非 force 删除已归档项目 = 忘记:删行 + 墓碑,会话数据不动', async () => {
  const created = projectsDb.createProjectPath(HOME_DIR);
  assert.ok(created.project, 'created returns a project row');
  const id = created.project.project_id;
  assert.equal(created.outcome, 'created');
  assert.equal(created.project.isArchived, 0);

  // 第一次删除(活动)→ 归档(旧行为)
  await deleteOrArchiveProject(id, false);
  assert.equal(projectsDb.getProjectById(id)!.isArchived, 1);

  // 第二次删除(已归档)→ 忘记:行删、墓碑记、jsonl 未被碰(无会话行可验,至少不炸)
  await deleteOrArchiveProject(id, false);
  assert.equal(projectsDb.getProjectById(id), null, 'projects row removed');
  assert.ok(projectsDb.isProjectPathTombstoned(HOME_DIR), 'tombstone recorded');
});

test('会话同步扫到墓碑路径:重建行必须归档,不复活进活动列表', () => {
  const revived = projectsDb.createProjectPath(HOME_DIR);
  assert.ok(revived.project, 're-created returns a project row');
  assert.equal(revived.outcome, 'created');
  assert.equal(revived.project.isArchived, 1, 'tombstoned path re-created as archived');

  // 已有墓碑行再次同步(被外部误恢复后)也会压回归档
  projectsDb.updateProjectIsArchivedById(revived.project.project_id, false); // 模拟外部误恢复
  const again = projectsDb.createProjectPath(HOME_DIR);
  assert.equal(again.outcome, 'reactivated_archived');
  assert.equal(projectsDb.getProjectById(revived.project.project_id)!.isArchived, 1, 'forced back to archived');
});

test('显式恢复清墓碑:用户意图胜过同步压制', async () => {
  const row = projectsDb.getProjectPath(HOME_DIR)!;
  restoreArchivedProject(row.project_id);
  assert.equal(projectsDb.getProjectById(row.project_id)!.isArchived, 0);
  assert.equal(projectsDb.isProjectPathTombstoned(HOME_DIR), false, 'tombstone cleared');

  // 此后同步不再压制
  const after = projectsDb.createProjectPath(HOME_DIR);
  assert.equal(after.outcome, 'active_conflict');
  assert.equal(projectsDb.getProjectById(row.project_id)!.isArchived, 0);
});

test.after(() => {
  getConnection().close();
  rmSync(path.dirname(process.env.DATABASE_PATH!), { recursive: true, force: true });
});
