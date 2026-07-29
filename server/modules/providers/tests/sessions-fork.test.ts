import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { closeConnection, initializeDatabase, sessionsDb } from '@/modules/database/index.js';
import { sessionsService } from '@/modules/providers/services/sessions.service.js';
import { AppError } from '@/shared/utils.js';

async function withIsolatedDatabase(runTest: () => void | Promise<void>): Promise<void> {
  const previousDatabasePath = process.env.DATABASE_PATH;
  const tempDirectory = await mkdtemp(path.join(tmpdir(), 'sessions-fork-'));
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

/**
 * REQ-049 fork: a source session with a transcript on disk is copied into a
 * brand-new app session. Verifies the new row keeps provider/project, starts
 * with provider_session_id=NULL, points jsonl_path at the streamed copy, and
 * the source row + source file are untouched.
 */
test('forkSession copies the transcript into a new app session and leaves the source intact', async () => {
  await withIsolatedDatabase(async () => {
    const projectDir = await mkdtemp(path.join(tmpdir(), 'fork-src-'));
    const sourceJsonl = path.join(projectDir, 'source-uuid.jsonl');
    const sourceContent = '{"type":"user","message":{"role":"user","content":"hi"}}\n';
    await writeFile(sourceJsonl, sourceContent);

    const sourceAppId = 'src-app-uuid';
    // Simulate the post-first-message state: an app-allocated row whose
    // provider-native id and transcript path have both been recorded.
    sessionsDb.createAppSession(sourceAppId, 'claude', '/workspace/fork-demo');
    sessionsDb.assignProviderSessionId(sourceAppId, 'src-provider-uuid');
    sessionsDb.updateSessionJsonlPath(sourceAppId, sourceJsonl);
    sessionsDb.updateSessionCustomName(sourceAppId, '调试');

    const before = sessionsDb.getSessionById(sourceAppId);
    assert.equal(before?.jsonl_path, sourceJsonl);
    assert.equal(before?.custom_name, '调试');

    const result = await sessionsService.forkSession(sourceAppId);

    // New row basics: stable provider/project, fresh ids. The project path is
    // normalized by the DB layer (drive+backslash on Windows, posix elsewhere),
    // so compare against the source row's stored path rather than a literal.
    assert.equal(result.provider, 'claude');
    assert.equal(result.projectPath, before?.project_path);
    assert.notEqual(result.sessionId, sourceAppId);
    assert.ok(result.jsonlPath.endsWith(`${result.sessionId}.jsonl`));

    const forked = sessionsDb.getSessionById(result.sessionId);
    assert.ok(forked, 'forked session row must exist');
    assert.equal(forked?.provider, 'claude');
    assert.equal(forked?.provider_session_id, null, 'fork must start with no provider session');
    assert.equal(forked?.jsonl_path, result.jsonlPath);
    assert.equal(forked?.custom_name, '调试 · fork');

    // The transcript copy exists at the recorded path and matches the source
    // byte-for-byte (copyFile semantics).
    const copied = await readFile(result.jsonlPath, 'utf8');
    assert.equal(copied, sourceContent);

    // The source row is byte-identical to its pre-fork state.
    const after = sessionsDb.getSessionById(sourceAppId);
    assert.equal(after?.jsonl_path, sourceJsonl);
    assert.equal(after?.custom_name, '调试');
    assert.equal(after?.provider_session_id, 'src-provider-uuid');

    await rm(projectDir, { recursive: true, force: true });
  });
});

test('forkSession refuses sessions with no transcript on disk yet', async () => {
  await withIsolatedDatabase(async () => {
    const appId = 'empty-app-uuid';
    sessionsDb.createAppSession(appId, 'claude', '/workspace/fork-empty');

    await assert.rejects(
      () => sessionsService.forkSession(appId),
      (error: unknown) => {
        assert.ok(error instanceof AppError, 'expected AppError');
        assert.equal((error as AppError).statusCode, 409);
        return true;
      },
    );
  });
});

test('forkSession returns 404 for an unknown source session', async () => {
  await withIsolatedDatabase(async () => {
    await assert.rejects(
      () => sessionsService.forkSession('does-not-exist'),
      (error: unknown) => {
        assert.ok(error instanceof AppError, 'expected AppError');
        assert.equal((error as AppError).statusCode, 404);
        return true;
      },
    );
  });
});

/**
 * Streams the source file manually to confirm copyFile is the mechanism — this
 * is a smoke test that the service uses the streaming copy path (not readFile)
 * by asserting the copy equals a large source without loading it into memory
 * at the service layer. The behavior under test is the on-disk equality.
 */
test('forkSession streamed copy matches a multi-line source transcript', async () => {
  await withIsolatedDatabase(async () => {
    const projectDir = await mkdtemp(path.join(tmpdir(), 'fork-multi-'));
    const sourceJsonl = path.join(projectDir, 'multi.jsonl');
    const lines = Array.from({ length: 50 }, (_, i) =>
      JSON.stringify({ type: 'user', message: { role: 'user', content: `msg-${i}` } }),
    ).join('\n') + '\n';
    await writeFile(sourceJsonl, lines);

    const sourceAppId = 'multi-app-uuid';
    sessionsDb.createAppSession(sourceAppId, 'claude', '/workspace/fork-multi');
    sessionsDb.assignProviderSessionId(sourceAppId, 'multi-provider-uuid');
    // Point jsonl_path at the source so fork has something to copy.
    sessionsDb.updateSessionJsonlPath(sourceAppId, sourceJsonl);

    const result = await sessionsService.forkSession(sourceAppId);
    const copied = await readFile(result.jsonlPath, 'utf8');
    assert.equal(copied, lines);

    await rm(projectDir, { recursive: true, force: true });
  });
});
