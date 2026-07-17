import fsSync from 'node:fs';
import path from 'node:path';
import { readFile } from 'node:fs/promises';

import { sessionsDb } from '@/modules/database/index.js';
import type { IProviderSessionSynchronizer } from '@/shared/interfaces.js';
import type { AnyRecord } from '@/shared/types.js';
import { getKimiCodeHome } from '@/modules/providers/list/kimi/kimi-auth.provider.js';
import {
  normalizeSessionName,
  readJsonRecord,
  readOptionalString,
} from '@/shared/utils.js';

type KimiSessionIndexEntry = {
  sessionId: string;
  sessionDir: string;
  workDir: string;
};

type ParsedSession = {
  sessionId: string;
  projectPath: string;
  sessionName?: string;
  createdAt?: string;
  updatedAt?: string;
  transcriptPath: string | null;
};

const FALLBACK_TITLE = 'Untitled Kimi Session';

/**
 * Session indexer for Kimi Code's per-session directories.
 *
 * The CLI keeps a global index at $KIMI_CODE_HOME/session_index.jsonl
 * ({sessionId, sessionDir, workDir} per line) and per-session metadata in
 * <sessionDir>/state.json; the transcript lives at
 * <sessionDir>/agents/main/wire.jsonl.
 */
export class KimiSessionSynchronizer implements IProviderSessionSynchronizer {
  private readonly provider = 'kimi' as const;

  /**
   * Scans the global session index and upserts sessions into DB.
   */
  async synchronize(since?: Date): Promise<number> {
    const entries = await this.readSessionIndex();

    let processed = 0;
    for (const entry of entries) {
      const parsed = await this.processSessionEntry(entry);
      if (!parsed) {
        continue;
      }

      if (since && parsed.updatedAt) {
        const updatedAt = Date.parse(parsed.updatedAt);
        if (Number.isFinite(updatedAt) && updatedAt < since.getTime()) {
          continue;
        }
      }

      this.upsertSession(parsed);
      processed += 1;
    }

    return processed;
  }

  /**
   * Handles watcher changes under $KIMI_CODE_HOME/sessions. Only state.json
   * and wire.jsonl carry session facts; logs and other files are ignored.
   */
  async synchronizeFile(filePath: string): Promise<string | null> {
    const basename = path.basename(filePath);
    if (basename !== 'state.json' && basename !== 'wire.jsonl') {
      return null;
    }

    const sessionDir = basename === 'state.json'
      ? path.dirname(filePath)
      // <sessionDir>/agents/main/wire.jsonl -> <sessionDir>
      : path.dirname(path.dirname(path.dirname(filePath)));
    const sessionId = path.basename(sessionDir);
    if (!sessionId) {
      return null;
    }

    const entries = await this.readSessionIndex();
    const entry = entries.find((item) => item.sessionId === sessionId)
      ?? { sessionId, sessionDir, workDir: '' };

    const parsed = await this.processSessionEntry(entry);
    if (!parsed) {
      return null;
    }

    return this.upsertSession(parsed);
  }

  private async readSessionIndex(): Promise<KimiSessionIndexEntry[]> {
    const indexPath = path.join(getKimiCodeHome(), 'session_index.jsonl');

    let content: string;
    try {
      content = await readFile(indexPath, 'utf8');
    } catch {
      return [];
    }

    const entries: KimiSessionIndexEntry[] = [];
    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed) {
        continue;
      }

      const parsed = readJsonRecord(trimmed);
      const sessionId = readOptionalString(parsed?.sessionId);
      const sessionDir = readOptionalString(parsed?.sessionDir);
      const workDir = readOptionalString(parsed?.workDir) ?? '';
      if (sessionId && sessionDir) {
        entries.push({ sessionId, sessionDir, workDir });
      }
    }

    return entries;
  }

  private async processSessionEntry(entry: KimiSessionIndexEntry): Promise<ParsedSession | null> {
    const statePath = path.join(entry.sessionDir, 'state.json');

    let state: AnyRecord | null = null;
    try {
      state = readJsonRecord(await readFile(statePath, 'utf8'));
    } catch {
      // The index can point at pruned session directories; skip them quietly.
      return null;
    }
    if (!state) {
      return null;
    }

    const projectPath = entry.workDir.trim();
    if (!projectPath) {
      return null;
    }

    const transcriptPath = path.join(entry.sessionDir, 'agents', 'main', 'wire.jsonl');
    const sessionName = readOptionalString(state.title)
      ?? await this.readFirstUserPrompt(transcriptPath);

    return {
      sessionId: entry.sessionId,
      projectPath,
      sessionName: normalizeSessionName(sessionName, FALLBACK_TITLE),
      createdAt: readOptionalString(state.createdAt),
      updatedAt: readOptionalString(state.updatedAt),
      transcriptPath: fsSync.existsSync(transcriptPath) ? transcriptPath : null,
    };
  }

  private upsertSession(parsed: ParsedSession): string | null {
    const pendingAppSession = sessionsDb.getSessionByProviderSessionId(parsed.sessionId)
      ?? sessionsDb.getSessionById(parsed.sessionId)
      ?? sessionsDb.findLatestPendingAppSession(this.provider, parsed.projectPath);
    if (pendingAppSession && !pendingAppSession.provider_session_id) {
      // The wire.jsonl watcher can index a session before the runtime reports
      // its provider id back through the websocket mapping. Bind that id to
      // the fresh app row first so the watcher does not create a temporary
      // provider-id sidebar entry for the same session.
      sessionsDb.assignProviderSessionId(pendingAppSession.session_id, parsed.sessionId);
    }

    // App-created sessions are keyed by an app id, so disk-discovered provider
    // ids must be resolved through the provider-id mapping first.
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

  private async readFirstUserPrompt(transcriptPath: string): Promise<string | undefined> {
    try {
      const content = await readFile(transcriptPath, 'utf8');
      for (const line of content.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed) {
          continue;
        }

        const parsed = readJsonRecord(trimmed);
        if (parsed?.type !== 'turn.prompt') {
          continue;
        }

        const origin = readOptionalString((parsed.origin as AnyRecord | undefined)?.kind);
        if (origin !== 'user' || !Array.isArray(parsed.input)) {
          continue;
        }

        for (const part of parsed.input) {
          const text = readOptionalString((part as AnyRecord | undefined)?.text);
          if (text?.trim()) {
            return text;
          }
        }
      }
    } catch {
      // Missing or unreadable transcript: no fallback title.
    }

    return undefined;
  }
}
