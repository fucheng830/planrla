import { projectsDb } from '@/modules/database/index.js';
import { AppError } from '@/shared/utils.js';

type ReorderProjectsResult = {
  updated: number;
};

/**
 * Persists the sidebar's manual project order (drag-and-drop).
 *
 * Accepts the full ordered list of projectIds as displayed. Unknown or
 * archived ids are ignored by the repository; duplicate ids collapse to the
 * first occurrence so indexes stay stable.
 */
export function reorderProjects(projectIdsInOrder: unknown): ReorderProjectsResult {
  if (!Array.isArray(projectIdsInOrder)) {
    throw new AppError('projectIds must be an array', {
      code: 'PROJECT_IDS_INVALID',
      statusCode: 400,
    });
  }

  const orderedIds: string[] = [];
  const seen = new Set<string>();
  for (const rawId of projectIdsInOrder) {
    const projectId = typeof rawId === 'string' ? rawId.trim() : '';
    if (!projectId || seen.has(projectId)) {
      continue;
    }
    seen.add(projectId);
    orderedIds.push(projectId);
  }

  // Empty list = explicit "back to auto order" reset.
  if (orderedIds.length === 0) {
    projectsDb.clearProjectSortIndexes();
    return { updated: 0 };
  }

  projectsDb.updateProjectSortIndexes(orderedIds);
  return { updated: orderedIds.length };
}
