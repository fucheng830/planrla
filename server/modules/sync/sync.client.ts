// server/modules/sync/sync.client.ts
//
// The client side of team sync: talks to planrla-cloud over HTTP, drives the
// push/pull cycle, and wires results into the local kanban DB via the
// tasks-adapter. Holds no global state beyond the single shared instance.

import { getConnection } from '@/modules/database/index.js';
import {
  createSyncConfigRepository,
  drainTombstones,
  clearTombstone,
  type SyncConfigRepository,
} from './sync.db.js';
import { serializeChangedTasks, applyCloudTasks, type CloudTask } from './tasks-adapter.js';

const SYNC_INTERVAL_MS = 30_000;
const PUSH_LOOKBACK_MS = 5 * 60 * 1000; // initial push window if last_push_at missing

type SyncResult = {
  pushed: number;
  pulled: number;
  skipped: number;
  deleted: number;
  serverTime?: number;
  error?: string;
};

let instance: SyncEngine | null = null;
let timer: NodeJS.Timeout | null = null;

/**
 * Lazily builds the singleton engine. Returns null (not an error) when sync is
 * not configured — callers should no-op in that case.
 */
export function getSyncEngine(): SyncEngine | null {
  if (instance) return instance;
  const db = getConnection();
  const repo = createSyncConfigRepository(db);
  if (!repo.isConfigured()) return null;
  instance = new SyncEngine(repo);
  return instance;
}

/** Starts the background sync loop (idempotent). No-op if not configured. */
export function startSyncScheduler(): void {
  if (timer) return;
  timer = setInterval(() => {
    getSyncEngine()?.runCycle().catch((e) => {
      console.error('[sync] cycle failed:', e instanceof Error ? e.message : String(e));
    });
  }, SYNC_INTERVAL_MS);
  timer.unref();
}

export class SyncEngine {
  private readonly repo: SyncConfigRepository;
  private inFlight = false;

  constructor(repo: SyncConfigRepository) {
    this.repo = repo;
  }

  /** One push + pull cycle. Safe to call concurrently (second call is a no-op). */
  async runCycle(): Promise<SyncResult> {
    if (this.inFlight) return { pushed: 0, pulled: 0, skipped: 0, deleted: 0 };
    this.inFlight = true;
    try {
      return await this.cycle();
    } finally {
      this.inFlight = false;
    }
  }

  private async cycle(): Promise<SyncResult> {
    const cloudUrl = this.repo.get('cloud_url');
    const token = this.repo.get('instance_token');
    if (!cloudUrl || !token) {
      return { pushed: 0, pulled: 0, skipped: 0, deleted: 0, error: 'not configured' };
    }

    const base = cloudUrl.replace(/\/+$/, '');
    const db = getConnection();
    const result: SyncResult = { pushed: 0, pulled: 0, skipped: 0, deleted: 0 };

    // ---- push ----
    const lastPushStr = this.repo.get('last_pull_at'); // reuse last_pull as the push watermark start
    const sincePush = lastPushStr ? Number(lastPushStr) : Date.now() - PUSH_LOOKBACK_MS;
    const changed = serializeChangedTasks(db, Number.isFinite(sincePush) ? sincePush : 0);
    const tombstones = drainTombstones(db);
    const pushTasks = [
      ...changed,
      ...tombstones.map((t) => ({
        id: t.taskId,
        root_id: t.rootId,
        payload: { status: 'deleted', priority: 'medium', labels: [], dependencies: [], createdAt: '', updatedAt: '' },
        updated_at: t.deletedAt,
        deleted: true,
      })),
    ];
    if (pushTasks.length > 0) {
      try {
        const res = await fetch(`${base}/api/sync/push`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
          body: JSON.stringify({ tasks: pushTasks }),
        });
        if (!res.ok) {
          result.error = `push failed: ${res.status}`;
        } else {
          const body = await res.json() as { accepted: number; serverTime: number };
          result.pushed = body.accepted ?? 0;
          // Tombstones that were accepted can be cleared (cloud now holds the deletion).
          for (const t of tombstones) clearTombstone(db, t.taskId);
        }
      } catch (e) {
        result.error = `push error: ${e instanceof Error ? e.message : String(e)}`;
      }
    }

    // ---- pull ----
    const lastPullStr = this.repo.get('last_pull_at');
    const since = lastPullStr ? Number(lastPullStr) : 0;
    try {
      const res = await fetch(`${base}/api/sync/pull?since=${since}`, {
        headers: { authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        result.error = result.error ?? `pull failed: ${res.status}`;
      } else {
        const body = await res.json() as { tasks: CloudTask[]; serverTime: number };
        const applied = applyCloudTasks(db, Array.isArray(body.tasks) ? body.tasks : []);
        result.pulled = applied.applied;
        result.skipped = applied.skipped;
        result.deleted = applied.deleted;
        result.serverTime = body.serverTime;
        this.repo.set('last_pull_at', String(body.serverTime ?? Date.now()));
      }
    } catch (e) {
      result.error = result.error ?? `pull error: ${e instanceof Error ? e.message : String(e)}`;
    }

    return result;
  }

  /** For status reporting. */
  getStatus(): { configured: boolean; lastPullAt?: string } {
    return { configured: this.repo.isConfigured(), lastPullAt: this.repo.get('last_pull_at') };
  }
}
