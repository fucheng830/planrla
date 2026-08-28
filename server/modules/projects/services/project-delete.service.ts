import { promises as fs } from 'node:fs';
import path from 'node:path';

import { projectsDb, sessionsDb } from '@/modules/database/index.js';
import { AppError } from '@/shared/utils.js';

function uniqueJsonlPathsFromSessions(
  sessions: Array<{ jsonl_path: string | null }>,
): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const row of sessions) {
    const raw = row.jsonl_path?.trim();
    if (!raw) {
      continue;
    }
    const absolute = path.isAbsolute(raw) ? path.normalize(raw) : path.resolve(raw);
    if (seen.has(absolute)) {
      continue;
    }
    seen.add(absolute);
    result.push(absolute);
  }

  return result;
}

async function unlinkJsonlIfExists(filePath: string): Promise<void> {
  try {
    await fs.unlink(filePath);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') {
      return;
    }
    console.warn(`[project-delete] Failed to remove ${filePath}:`, (error as Error).message);
  }
}

/**
 * Loads all session rows for the project path and removes each distinct `jsonl_path` file on disk.
 */
export async function deleteSessionJsonlFilesForProjectPath(projectPath: string): Promise<void> {
  const sessions = sessionsDb.getSessionsByProjectPathIncludingArchived(projectPath);
  const paths = uniqueJsonlPathsFromSessions(sessions);

  for (const filePath of paths) {
    await unlinkJsonlIfExists(filePath);
  }
}

/**
 * - **Soft delete** (`force` false) on an ACTIVE project: set `isArchived` (hide from
 *   the active list; DB only).
 * - **Soft delete on an ALREADY-ARCHIVED project** = "forget": record a tombstone +
 *   remove the `projects` row, but KEEP session rows and jsonl files. A second tap of
 *   delete in the archive view should not force users into destructive mode just to
 *   clean the list. The tombstone guarantees session sync won't resurrect the row.
 * - **Force** (`force` true): for each session row for that `project_path`, delete the
 *   file at `jsonl_path` (when set), then remove session rows and the `projects` row.
 *   A tombstone is recorded as well — other providers' scans may still see the path.
 */
export async function deleteOrArchiveProject(projectId: string, force: boolean): Promise<void> {
  const row = projectsDb.getProjectById(projectId);
  if (!row) {
    throw new AppError(`Unknown projectId: ${projectId}`, {
      code: 'PROJECT_NOT_FOUND',
      statusCode: 404,
    });
  }

  if (!force) {
    if (!row.isArchived) {
      projectsDb.updateProjectIsArchivedById(projectId, true);
      return;
    }
    projectsDb.insertProjectTombstone(row.project_path);
    projectsDb.deleteProjectById(projectId);
    return;
  }

  await deleteSessionJsonlFilesForProjectPath(row.project_path);
  sessionsDb.deleteSessionsByProjectPath(row.project_path);
  projectsDb.insertProjectTombstone(row.project_path);
  projectsDb.deleteProjectById(projectId);
}

/**
 * Restores one archived project row back into the active project list.
 */
export function restoreArchivedProject(projectId: string): void {
  const row = projectsDb.getProjectById(projectId);
  if (!row) {
    throw new AppError(`Unknown projectId: ${projectId}`, {
      code: 'PROJECT_NOT_FOUND',
      statusCode: 404,
    });
  }

  projectsDb.deleteProjectTombstone(row.project_path);
  projectsDb.updateProjectIsArchivedById(projectId, false);
}
