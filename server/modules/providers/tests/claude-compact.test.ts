import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { closeConnection, initializeDatabase, sessionsDb } from '@/modules/database/index.js';
import { ClaudeSessionsProvider } from '@/modules/providers/list/claude/claude-sessions.provider.js';
import { sessionsService } from '@/modules/providers/services/sessions.service.js';

const PROVIDER_SESSION_ID = 'compact-provider-uuid';

async function withIsolatedDatabase(runTest: () => void | Promise<void>): Promise<void> {
  const previousDatabasePath = process.env.DATABASE_PATH;
  const tempDirectory = await mkdtemp(path.join(tmpdir(), 'claude-compact-'));
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

function userRow(text: string, timestamp: string, uuid: string): string {
  return JSON.stringify({
    type: 'user',
    uuid,
    timestamp,
    sessionId: PROVIDER_SESSION_ID,
    isMeta: false,
    message: { role: 'user', content: text },
  });
}

function assistantRow(text: string, timestamp: string, uuid: string): string {
  return JSON.stringify({
    type: 'assistant',
    uuid,
    timestamp,
    sessionId: PROVIDER_SESSION_ID,
    message: { role: 'assistant', content: [{ type: 'text', text }] },
  });
}

function compactSummaryRow(text: string, timestamp: string, uuid: string): string {
  return JSON.stringify({
    type: 'user',
    uuid,
    timestamp,
    sessionId: PROVIDER_SESSION_ID,
    isCompactSummary: true,
    message: { role: 'user', content: text },
  });
}

/** Writes a transcript with one compaction boundary and registers the session. */
async function setupCompactSession(
  appId: string,
  lines: string[],
): Promise<string> {
  const projectDir = await mkdtemp(path.join(tmpdir(), 'claude-compact-fixture-'));
  const jsonlPath = path.join(projectDir, `${PROVIDER_SESSION_ID}.jsonl`);
  await writeFile(jsonlPath, lines.join('\n') + '\n');

  sessionsDb.createAppSession(appId, 'claude', '/workspace/compact-demo');
  sessionsDb.assignProviderSessionId(appId, PROVIDER_SESSION_ID);
  sessionsDb.updateSessionJsonlPath(appId, jsonlPath);
  return jsonlPath;
}

const provider = new ClaudeSessionsProvider();

test('REQ-052 default history keeps the whole transcript and annotates the boundary', async () => {
  await withIsolatedDatabase(async () => {
    const ts = '2026-08-28T10:00:00.000Z';
    await setupCompactSession('app-all', [
      userRow('before-1', ts, 'u1'),
      assistantRow('before-2', ts, 'a1'),
      compactSummaryRow('summary-text', ts, 'b1'),
      userRow('after-1', ts, 'u2'),
      assistantRow('after-2', ts, 'a2'),
    ]);

    const result = await provider.fetchHistory('app-all', { providerSessionId: PROVIDER_SESSION_ID });
    assert.equal(result.total, 5, 'legacy viewport must still see every message');
    assert.equal(result.view, 'all');
    assert.equal(result.hasArchived, true);
    assert.equal(result.compaction?.epoch, 1);
  });
});

test('REQ-052 view=active returns only the boundary summary plus newer messages', async () => {
  await withIsolatedDatabase(async () => {
    const ts = '2026-08-28T10:00:00.000Z';
    await setupCompactSession('app-active', [
      userRow('before-1', ts, 'u1'),
      assistantRow('before-2', ts, 'a1'),
      compactSummaryRow('summary-text', ts, 'b1'),
      userRow('after-1', ts, 'u2'),
      assistantRow('after-2', ts, 'a2'),
    ]);

    const result = await provider.fetchHistory('app-active', { providerSessionId: PROVIDER_SESSION_ID, view: 'active' });
    assert.equal(result.total, 3, 'boundary summary + two post-compaction messages');
    assert.equal(result.view, 'active');
    assert.equal(result.hasArchived, true);
    assert.equal(result.compaction?.epoch, 1);

    const [summary, after1, after2] = result.messages;
    assert.equal(summary.isCompactSummary, true, 'boundary row stays flagged for the compact card');
    assert.equal(summary.role, 'assistant', 'summary renders as assistant-authored text');
    assert.equal(summary.content, 'summary-text');
    assert.equal((after1 as { content?: string }).content, 'after-1');
    assert.equal((after2 as { content?: string }).content, 'after-2');
    assert.equal(result.hasMore, false);
  });
});

test('REQ-052 view=archived returns the compacted-away epoch with the summary last', async () => {
  await withIsolatedDatabase(async () => {
    const ts = '2026-08-28T10:00:00.000Z';
    await setupCompactSession('app-archived', [
      userRow('before-1', ts, 'u1'),
      assistantRow('before-2', ts, 'a1'),
      compactSummaryRow('summary-text', ts, 'b1'),
      userRow('after-1', ts, 'u2'),
      assistantRow('after-2', ts, 'a2'),
    ]);

    const result = await provider.fetchHistory('app-archived', { providerSessionId: PROVIDER_SESSION_ID, view: 'archived' });
    assert.equal(result.total, 3, 'two archived messages + closing summary');
    assert.equal(result.view, 'archived');
    assert.equal(result.compaction?.epoch, 1);
    assert.equal(result.compaction?.archivedMessages, 3);

    const last = result.messages[result.messages.length - 1];
    assert.equal(last.isCompactSummary, true, 'summary closes the archived epoch');
    assert.equal((result.messages[0] as { content?: string }).content, 'before-1');
  });
});

test('REQ-052 archived pagination walks backwards inside one epoch', async () => {
  await withIsolatedDatabase(async () => {
    const ts = '2026-08-28T10:00:00.000Z';
    await setupCompactSession('app-arch-page', [
      userRow('before-1', ts, 'u1'),
      assistantRow('before-2', ts, 'a1'),
      compactSummaryRow('summary-text', ts, 'b1'),
      userRow('after-1', ts, 'u2'),
      assistantRow('after-2', ts, 'a2'),
    ]);

    const page1 = await provider.fetchHistory('app-arch-page', { providerSessionId: PROVIDER_SESSION_ID, view: 'archived', limit: 1, offset: 0 });
    assert.equal(page1.total, 3);
    assert.equal(page1.hasMore, true);
    assert.equal((page1.messages[0] as { content?: string }).content, 'summary-text',
      'tail page starts from the newest archived message (the summary)');

    const page2 = await provider.fetchHistory('app-arch-page', { providerSessionId: PROVIDER_SESSION_ID, view: 'archived', limit: 1, offset: 1 });
    assert.equal((page2.messages[0] as { content?: string }).content, 'before-2');
    assert.equal(page2.hasMore, true);

    const page3 = await provider.fetchHistory('app-arch-page', { providerSessionId: PROVIDER_SESSION_ID, view: 'archived', limit: 1, offset: 2 });
    assert.equal((page3.messages[0] as { content?: string }).content, 'before-1');
    assert.equal(page3.hasMore, false, 'oldest archived message has nothing before it');

    const page4 = await provider.fetchHistory('app-arch-page', { providerSessionId: PROVIDER_SESSION_ID, view: 'archived', limit: 1, offset: 3 });
    assert.deepEqual(page4.messages, []);
  });
});

test('REQ-052 out-of-range epoch yields an empty page instead of throwing', async () => {
  await withIsolatedDatabase(async () => {
    const ts = '2026-08-28T10:00:00.000Z';
    await setupCompactSession('app-arch-oob', [
      userRow('before-1', ts, 'u1'),
      compactSummaryRow('summary-text', ts, 'b1'),
      userRow('after-1', ts, 'u2'),
    ]);

    const result = await provider.fetchHistory('app-arch-oob', { providerSessionId: PROVIDER_SESSION_ID, view: 'archived', epoch: 7 });
    assert.equal(result.total, 0);
    assert.deepEqual(result.messages, []);
  });
});

test('REQ-052 same-millisecond rows never shift the boundary (file-order detection)', async () => {
  await withIsolatedDatabase(async () => {
    // Every row shares one timestamp: boundary detection must rely on file
    // order (stable sort keeps ties in place), not on timestamp comparisons.
    const ts = '2026-08-28T10:00:00.000Z';
    await setupCompactSession('app-same-ts', [
      userRow('before-1', ts, 'u1'),
      compactSummaryRow('summary-text', ts, 'b1'),
      userRow('after-1', ts, 'u2'),
      assistantRow('after-2', ts, 'a2'),
    ]);

    const result = await provider.fetchHistory('app-same-ts', { providerSessionId: PROVIDER_SESSION_ID, view: 'active' });
    assert.equal(result.total, 3);
    const first = result.messages[0] as { content?: string; isCompactSummary?: boolean };
    assert.equal(first.isCompactSummary, true);
    assert.equal(first.content, 'summary-text');
  });
});

test('REQ-052 session without compaction reports hasArchived=false and keeps everything', async () => {
  await withIsolatedDatabase(async () => {
    const ts = '2026-08-28T10:00:00.000Z';
    await setupCompactSession('app-plain', [
      userRow('hello', ts, 'u1'),
      assistantRow('world', ts, 'a1'),
    ]);

    const result = await provider.fetchHistory('app-plain', { providerSessionId: PROVIDER_SESSION_ID, view: 'active' });
    assert.equal(result.total, 2);
    assert.equal(result.hasArchived, false);
    assert.equal(result.compaction, undefined);
  });
});

test('REQ-052 normalizeMessage maps the SDK compact_boundary system event', () => {
  const messages = provider.normalizeMessage({
    type: 'system',
    subtype: 'compact_boundary',
    timestamp: '2026-08-28T10:00:00.000Z',
    compact_metadata: { trigger: 'auto', pre_tokens: 123456 },
  }, 'some-session');

  assert.equal(messages.length, 1);
  assert.equal(messages[0].kind, 'compact_boundary');
  assert.equal(messages[0].compactTrigger, 'auto');
  assert.equal(messages[0].preTokens, 123456);
  assert.equal(messages[0].sessionId, 'some-session');
});

test('REQ-052 listCompactions returns exact epoch counts and warms the cache', async () => {
  await withIsolatedDatabase(async () => {
    const ts = '2026-08-28T10:00:00.000Z';
    await setupCompactSession('app-list', [
      userRow('before-1', ts, 'u1'),
      assistantRow('before-2', ts, 'a1'),
      compactSummaryRow('summary-text', ts, 'b1'),
      userRow('after-1', ts, 'u2'),
      assistantRow('after-2', ts, 'a2'),
    ]);

    const service = await sessionsService.listCompactions('app-list');
    assert.equal(service.supported, true);
    assert.equal(service.compactions.length, 1);
    assert.equal(service.compactions[0].epoch, 1);
    assert.equal(service.compactions[0].archivedMessages, 3);

    const cached = sessionsDb.listCompactionEpochs('app-list');
    assert.equal(cached.length, 1);
    assert.equal(cached[0].archived_messages, 3);
  });
});

test('REQ-052 listCompactions serves cached counts when the epoch set is unchanged', async () => {
  await withIsolatedDatabase(async () => {
    const ts = '2026-08-28T10:00:00.000Z';
    await setupCompactSession('app-cache-hit', [
      userRow('before-1', ts, 'u1'),
      compactSummaryRow('summary-text', ts, 'b1'),
      userRow('after-1', ts, 'u2'),
    ]);

    await provider.listCompactions('app-cache-hit', { providerSessionId: PROVIDER_SESSION_ID });

    // Sentinel count with a MATCHING boundary signature: if the second call
    // recomputed from the transcript it would answer 2 — answering 999 proves
    // the cached row was served without re-normalizing the archived past.
    sessionsDb.upsertCompactionEpoch({
      sessionId: 'app-cache-hit',
      epoch: 1,
      boundaryUuid: 'b1',
      boundaryTimestamp: ts,
      trigger: null,
      preTokens: null,
      archivedMessages: 999,
    });

    const epochs = await provider.listCompactions('app-cache-hit', { providerSessionId: PROVIDER_SESSION_ID });
    assert.equal(epochs.length, 1);
    assert.equal(epochs[0].archivedMessages, 999, 'unchanged epoch set must be served from cache');
  });
});

test('REQ-052 history-primed cache rows (null counts) are completed, not served', async () => {
  await withIsolatedDatabase(async () => {
    const ts = '2026-08-28T10:00:00.000Z';
    await setupCompactSession('app-lazy-count', [
      userRow('before-1', ts, 'u1'),
      assistantRow('before-2', ts, 'a1'),
      compactSummaryRow('summary-text', ts, 'b1'),
      userRow('after-1', ts, 'u2'),
    ]);

    // History reads cache the epoch lazily with archivedMessages = null —
    // the listing must still resolve an exact count for such rows.
    await provider.fetchHistory('app-lazy-count', { providerSessionId: PROVIDER_SESSION_ID, view: 'active' });
    assert.equal(sessionsDb.listCompactionEpochs('app-lazy-count')[0].archived_messages, null);

    const epochs = await provider.listCompactions('app-lazy-count', { providerSessionId: PROVIDER_SESSION_ID });
    assert.equal(epochs[0].archivedMessages, 3);
    assert.equal(sessionsDb.listCompactionEpochs('app-lazy-count')[0].archived_messages, 3);
  });
});

test('REQ-052 transcript shrink recomputes the changed epoch and prunes ghost cache rows', async () => {
  await withIsolatedDatabase(async () => {
    const ts = '2026-08-28T10:00:00.000Z';
    const jsonlPath = await setupCompactSession('app-shrink', [
      userRow('epoch1-msg', ts, 'u1'),
      compactSummaryRow('summary-1', ts, 'b1'),
      userRow('epoch2-msg', ts, 'u2'),
      compactSummaryRow('summary-2', ts, 'b2'),
      userRow('current-msg', ts, 'u3'),
    ]);

    await provider.listCompactions('app-shrink', { providerSessionId: PROVIDER_SESSION_ID });
    assert.equal(sessionsDb.listCompactionEpochs('app-shrink').length, 2);

    // Simulate a CLI rewrite that keeps only one (different) boundary.
    await writeFile(jsonlPath, [
      userRow('kept-1', ts, 'k1'),
      compactSummaryRow('fresh-summary', ts, 'bX'),
    ].join('\n') + '\n');

    const epochs = await provider.listCompactions('app-shrink', { providerSessionId: PROVIDER_SESSION_ID });
    assert.equal(epochs.length, 1);
    assert.equal(epochs[0].archivedMessages, 2, 'changed boundary uuid must recompute, not serve stale cache');
    const cached = sessionsDb.listCompactionEpochs('app-shrink');
    assert.equal(cached.length, 1, 'ghost epoch rows are pruned on shrink');
    assert.equal(cached[0].boundary_uuid, 'bX');
  });
});

test('REQ-052 two compactions produce two epochs and active reads only the newest', async () => {
  await withIsolatedDatabase(async () => {
    const ts = '2026-08-28T10:00:00.000Z';
    await setupCompactSession('app-multi', [
      userRow('epoch1-msg', ts, 'u1'),
      compactSummaryRow('summary-1', ts, 'b1'),
      userRow('epoch2-msg', ts, 'u2'),
      compactSummaryRow('summary-2', ts, 'b2'),
      userRow('current-msg', ts, 'u3'),
    ]);

    const active = await provider.fetchHistory('app-multi', { providerSessionId: PROVIDER_SESSION_ID, view: 'active' });
    assert.equal(active.total, 2, 'latest summary + current message');
    assert.equal(active.compaction?.epoch, 2);

    const archived1 = await provider.fetchHistory('app-multi', { providerSessionId: PROVIDER_SESSION_ID, view: 'archived', epoch: 1 });
    assert.equal(archived1.total, 2);
    assert.equal((archived1.messages[0] as { content?: string }).content, 'epoch1-msg');
    assert.equal(archived1.messages[archived1.messages.length - 1].isCompactSummary, true);

    const archived2 = await provider.fetchHistory('app-multi', { providerSessionId: PROVIDER_SESSION_ID, view: 'archived', epoch: 2 });
    assert.equal(archived2.total, 2);
    assert.equal((archived2.messages[0] as { content?: string }).content, 'epoch2-msg');

    const listing = await sessionsService.listCompactions('app-multi');
    assert.deepEqual(listing.compactions.map((entry) => entry.epoch), [1, 2]);
    assert.deepEqual(listing.compactions.map((entry) => entry.archivedMessages), [2, 2]);
  });
});
