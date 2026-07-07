import { useCallback, useMemo, useState } from 'react';
import {
  estimateTokens,
  formatReferenceSection,
  type SessionReference,
  type SessionReferenceMode,
  type ReferencedMessage,
} from '../utils/sessionReferenceFormat';

export interface UseSessionReferencesResult {
  references: SessionReference[];
  totalTokens: number;
  /** 拼好的引用区文本(发送时 prepend 到 content);空时返回 ''。 */
  formattedSection: string;
  addReference: (ref: Omit<SessionReference, 'id'>) => void;
  removeReference: (id: string) => void;
  updateReferenceMessages: (id: string, messages: ReferencedMessage[]) => void;
  /** 整段历史模式:截到前 N 条。 */
  trimToFirstN: (id: string, n: number) => void;
  clearReferences: () => void;
}

const newId = () => {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return `ref-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
};

export function useSessionReferences(): UseSessionReferencesResult {
  const [references, setReferences] = useState<SessionReference[]>([]);

  const addReference = useCallback((ref: Omit<SessionReference, 'id'>) => {
    setReferences((prev) => [...prev, { ...ref, id: newId() }]);
  }, []);

  const removeReference = useCallback((id: string) => {
    setReferences((prev) => prev.filter((r) => r.id !== id));
  }, []);

  const updateReferenceMessages = useCallback((id: string, messages: ReferencedMessage[]) => {
    setReferences((prev) => prev.map((r) => (r.id === id ? { ...r, messages } : r)));
  }, []);

  const trimToFirstN = useCallback((id: string, n: number) => {
    setReferences((prev) => prev.map((r) => (r.id === id ? { ...r, messages: r.messages.slice(0, n) } : r)));
  }, []);

  const clearReferences = useCallback(() => setReferences([]), []);

  const formattedSection = useMemo(() => formatReferenceSection(references), [references]);
  const totalTokens = useMemo(
    () => estimateTokens(formattedSection),
    [formattedSection],
  );

  return {
    references,
    totalTokens,
    formattedSection,
    addReference,
    removeReference,
    updateReferenceMessages,
    trimToFirstN,
    clearReferences,
  };
}

/** 给 Picker 用:构造一条引用的工厂(单条模式取选中的 message;整段取全部)。 */
export function buildReference(args: {
  sessionId: string;
  title: string;
  provider: string;
  date: string;
  mode: SessionReferenceMode;
  messages: ReferencedMessage[];
}): Omit<SessionReference, 'id'> {
  return {
    sessionId: args.sessionId,
    title: args.title,
    provider: args.provider,
    date: args.date,
    mode: args.mode,
    messages: args.messages,
  };
}
