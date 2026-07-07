import type { PickerCandidateSession } from '../view/subcomponents/SessionReferencePicker';
import type { ProjectSession } from '../../../types/app';

/**
 * Maps a session into the picker candidate shape. Shared by:
 *  - ChatInterface (`pickerDefaultSessions` — current project only)
 *  - AppContent (`allPickerSessions` — flattened across all projects)
 *
 * Centralizing this keeps the two lists consistent so the picker's
 * "search all" mode never disagrees with "current project" mode on the
 * same session. Title precedence mirrors the sidebar's display logic
 * (summary → title → name → id). Provider falls back to the optional
 * `fallbackProvider` (the active composer provider) before defaulting
 * to 'claude'.
 */
export const toCandidateSession = (
  session: ProjectSession,
  fallbackProvider?: string,
): PickerCandidateSession => {
  const titleSource =
    (typeof session.summary === 'string' && session.summary.trim()) ||
    (typeof session.title === 'string' && session.title.trim()) ||
    (typeof session.name === 'string' && session.name.trim());

  const lastActivityRaw = session.lastActivity || session.updatedAt || session.createdAt || session.updated_at || session.created_at;

  return {
    sessionId: String(session.id),
    title: titleSource || String(session.id),
    provider: (session.__provider || session.provider || fallbackProvider || 'claude') as string,
    lastActivity: typeof lastActivityRaw === 'string' ? lastActivityRaw : undefined,
  };
};
