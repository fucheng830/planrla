import { useCallback, useMemo, useState } from 'react';

import { formatReferenceHints, type SessionReference } from '../utils/sessionReferenceFormat';

export interface UseSessionReferencesResult {
  references: SessionReference[];
  /** 拼好的提示行(发送时 prepend 到 content);空返回 ''。 */
  formattedHints: string;
  addReference: (ref: Omit<SessionReference, 'id'>) => void;
  removeReference: (id: string) => void;
  clearReferences: () => void;
}

const newId = () => {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return `ref-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
};

export function useSessionReferences(): UseSessionReferencesResult {
  const [references, setReferences] = useState<SessionReference[]>([]);
  const addReference = useCallback((ref: Omit<SessionReference, 'id'>) => {
    // Dedupe by sessionId — dragging the same session in twice keeps one chip.
    setReferences((prev) =>
      prev.some((r) => r.sessionId === ref.sessionId) ? prev : [...prev, { ...ref, id: newId() }],
    );
  }, []);
  const removeReference = useCallback((id: string) => {
    setReferences((prev) => prev.filter((r) => r.id !== id));
  }, []);
  const clearReferences = useCallback(() => setReferences([]), []);
  const formattedHints = useMemo(() => formatReferenceHints(references), [references]);
  return { references, formattedHints, addReference, removeReference, clearReferences };
}
