import fsSync from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readFile, readdir } from 'node:fs/promises';

import { sessionsDb } from '@/modules/database/index.js';
import type { IProviderSessionSynchronizer } from '@/shared/interfaces.js';
import type { AnyRecord } from '@/shared/types.js';
import { getZcodeCliHome } from '@/modules/providers/list/zcode/zcode-auth.provider.js';
import {
  normalizeSessionName,
  readJsonRecord,
  readObjectRecord,
  readOptionalString,
} from '@/shared/utils.js';

const FALLBACK_TITLE = 'Untitled ZCode Session';

type ParsedSession = {
  sessionId: string;
  projectPath: string;
  sessionName?: string;
  createdAt?: string;
  updatedAt?: string;
  transcriptPath: string | null;
};

/**
 * Session indexer for ZCode. ZCode stores per-turn transcripts as
 * ~/.zcode/cli/rollout/model-io-sess_<id>.jsonl (one `model_io` object per
 * line). There is no separate per-session metadata index file; the first user
 * prompt of the first turn is used as the session title, and the project path
 * falls back to the user's home (ZCode does not persist a per-session cwd in
 * the rollout — that lives in its sqlite DB, which we do not read here yet).
 */
export class ZcodeSessionSynchronizer implements IProviderSessionSynchronizer {
  private readonly provider = 'zcode' as const;

  private rolloutDir(): string {
    return path.join(getZcodeCliHome(), 'rollout');
  }

  /**
   * Full scan of the rollout directory. Used by the watcher's initial sync.
   */
  async synchronize(since?: Date): Promise<number> {
    let files: string[];
    try {
      files = await readdir(this.rolloutDir());
    } catch {
      return 0;
    }

    let processed = 0;
    for (const file of files) {
      if (!file.startsWith('model-io-sess_') || !file.endsWith('.jsonl')) continue;
      const sessionId = file.replace(/^model-io-/, '').replace(/\.jsonl$/, '');
      if (!sessionId) continue;

      const parsed = await this.parseFromRollout(sessionId);
      if (!parsed) continue;

      if (since && parsed.updatedAt) {
        const updatedAt = Date.parse(parsed.updatedAt);
        if (Number.isFinite(updatedAt) && updatedAt < since.getTime()) continue;
      }

      this.upsertSession(parsed);
      processed += 1;
    }
    return processed;
  }

  /**
   * Handles watcher changes under ~/.zcode/cli/rollout. Only
   * `model-io-sess_<id>.jsonl` files carry session facts.
   */
  async synchronizeFile(filePath: string): Promise<string | null> {
    const basename = path.basename(filePath);
    if (!basename.startsWith('model-io-sess_') || !basename.endsWith('.jsonl')) {
      return null;
    }
    const sessionId = basename.replace(/^model-io-/, '').replace(/\.jsonl$/, '');
    if (!sessionId) return null;

    const parsed = await this.parseFromRollout(sessionId);
    if (!parsed) return null;
    return this.upsertSession(parsed);
  }

  /**
   * Reads the first turn of a rollout file to derive a title (first user
   * prompt) and timestamps. Subsequent turns only contribute to history
   * (handled by the sessions provider's fetchHistory).
   */
  private async parseFromRollout(sessionId: string): Promise<ParsedSession | null> {
    const transcriptPath = path.join(this.rolloutDir(), `model-io-${sessionId}.jsonl`);
    if (!fsSync.existsSync(transcriptPath)) return null;

    let content: string;
    try {
      content = await readFile(transcriptPath, 'utf8');
    } catch {
      return null;
    }

    let firstPrompt: string | undefined;
    let createdAt: string | undefined;
    let updatedAt: string | undefined;

    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      const entry = readJsonRecord(trimmed);
      if (!entry) continue;

      const startedAt = readOptionalString(entry.startedAt);
      const completedAt = readOptionalString(entry.completedAt);
      if (startedAt && !createdAt) createdAt = startedAt;
      if (completedAt) updatedAt = completedAt;

      if (!firstPrompt) {
        const body = readObjectRecord(readObjectRecord(entry.request)?.body);
        const messages = Array.isArray(body?.messages) ? body.messages : [];
        for (const raw of messages) {
          const msg = readObjectRecord(raw);
          if (readOptionalString(msg?.role) === 'user') {
            const text = typeof msg?.content === 'string'
              ? msg.content
              : this.extractContentText(msg?.content);
            if (text?.trim()) {
              firstPrompt = text.trim();
              break;
            }
          }
        }
      }
    }

    return {
      sessionId,
      // ZCode does not persist a per-session cwd in the rollout; fall back to
      // home so the session still lands in a valid project bucket.
      projectPath: os.homedir(),
      sessionName: normalizeSessionName(firstPrompt, FALLBACK_TITLE),
      createdAt,
      updatedAt,
      transcriptPath,
    };
  }

  private extractContentText(content: unknown): string | undefined {
    if (typeof content === 'string') return content;
    if (!Array.isArray(content)) return undefined;
    for (const block of content) {
      const record = readObjectRecord(block);
      if (readOptionalString(record?.type) === 'text') {
        const text = readOptionalString(record?.text);
        if (text?.trim()) return text;
      }
    }
    return undefined;
  }

  private upsertSession(parsed: ParsedSession): string | null {
    const pendingAppSession = sessionsDb.getSessionByProviderSessionId(parsed.sessionId)
      ?? sessionsDb.getSessionById(parsed.sessionId)
      ?? sessionsDb.findLatestPendingAppSession(this.provider, parsed.projectPath);
    if (pendingAppSession && !pendingAppSession.provider_session_id) {
      sessionsDb.assignProviderSessionId(pendingAppSession.session_id, parsed.sessionId);
    }

    const existingSession = sessionsDb.getSessionByProviderSessionId(parsed.sessionId)
      ?? sessionsDb.getSessionById(parsed.sessionId);
    const existingName = existingSession?.custom_name;
    const nextName = existingName && existingName !== FALLBACK_TITLE
      ? existingName
      : parsed.sessionName;

    return sessionsDb.createSession(
      parsed.sessionId,
      this.provider,
      parsed.projectPath,
      nextName,
      parsed.createdAt,
      parsed.updatedAt ?? parsed.createdAt,
      parsed.transcriptPath,
    );
  }
}
