import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { closeConnection } from '@/modules/database/connection.js';
import { initializeDatabase } from '@/modules/database/init-db.js';
import { projectsDb } from '@/modules/database/repositories/projects.db.js';
import { normalizeProjectPath } from '@/shared/utils.js';

async function withIsolatedDatabase(runTest: () => void | Promise<void>): Promise<void> {
  const previousDatabasePath = process.env.DATABASE_PATH;
  const tempDirectory = await mkdtemp(path.join(tmpdir(), 'projects-db-'));
  const databasePath = path.join(tempDirectory, 'auth.db');

  closeConnection();
  process.env.DATABASE_PATH = databasePath;
  await initializeDatabase();

  try {
    await runTest();
  } finally {
    closeConnection();
    if (previousDatabasePath === undefined) {
      delete process.env.DATABASE_PATH;
    } else {
      process.env.DATABASE_PATH = previousDatabasePath;
    }
    await rm(tempDirectory, { recursive: true, force: true });
  }
}

test('projectsDb.createProjectPath returns created for fresh paths', async () => {
  await withIsolatedDatabase(() => {
    const inputPath = '/workspace/new-project';
    const created = projectsDb.createProjectPath(inputPath);

    assert.equal(created.outcome, 'created');
    assert.ok(created.project);
    // normalizeProjectPath 在 Windows 上会把 posix 分隔符转成反斜杠,
    // 断言用同一归一化逻辑生成期望值,保证跨平台稳定。
    assert.equal(created.project?.project_path, normalizeProjectPath(inputPath));
    assert.equal(created.project?.isArchived, 0);
  });
});

test('projectsDb.createProjectPath returns reactivated_archived for archived duplicates', async () => {
  await withIsolatedDatabase(() => {
    const initial = projectsDb.createProjectPath('/workspace/archived-project', 'Archived Project');
    assert.equal(initial.outcome, 'created');
    assert.ok(initial.project);

    projectsDb.updateProjectIsArchived('/workspace/archived-project', true);

    const reused = projectsDb.createProjectPath('/workspace/archived-project', 'Renamed Project');
    assert.equal(reused.outcome, 'reactivated_archived');
    assert.ok(reused.project);
    assert.equal(reused.project?.project_id, initial.project?.project_id);
    assert.equal(reused.project?.isArchived, 0);
  });
});

test('projectsDb.createProjectPath returns active_conflict for active duplicates', async () => {
  await withIsolatedDatabase(() => {
    const initial = projectsDb.createProjectPath('/workspace/active-project');
    assert.equal(initial.outcome, 'created');
    assert.ok(initial.project);

    const conflict = projectsDb.createProjectPath('/workspace/active-project');
    assert.equal(conflict.outcome, 'active_conflict');
    assert.ok(conflict.project);
    assert.equal(conflict.project?.project_id, initial.project?.project_id);
    assert.equal(conflict.project?.isArchived, 0);
  });
});
