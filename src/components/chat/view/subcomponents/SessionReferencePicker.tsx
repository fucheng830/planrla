import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Search, X } from 'lucide-react';

/** 候选 session(由调用方从 sidebar 数据构造)。 */
export interface PickerCandidateSession {
  sessionId: string;
  title: string;
  provider: string;
  lastActivity?: string;
}

interface SessionReferencePickerProps {
  /** 默认列表(当前 project 的 sessions)。 */
  defaultSessions: PickerCandidateSession[];
  /** search 切「全部」时的列表(全主机);不传则 search 只过滤 default。 */
  allSessions?: PickerCandidateSession[];
  onCancel: () => void;
  onConfirm: (sessionId: string, title: string, provider: string) => void;
}

export default function SessionReferencePicker({
  defaultSessions,
  allSessions,
  onCancel,
  onConfirm,
}: SessionReferencePickerProps) {
  const { t } = useTranslation('chat');
  const [query, setQuery] = useState('');

  // 命中列表:query 非空且有 allSessions → 在 allSessions 过滤;否则在 defaultSessions 过滤
  const list = useMemo(() => {
    const pool = query.trim() && allSessions?.length ? allSessions : defaultSessions;
    if (!query.trim()) return pool.slice(0, 50);
    const q = query.toLowerCase();
    return pool.filter((s) => s.title.toLowerCase().includes(q)).slice(0, 50);
  }, [query, defaultSessions, allSessions]);

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4" onClick={onCancel}>
      <div
        className="max-h-[80vh] w-full max-w-lg overflow-hidden rounded-2xl border border-border/50 bg-card shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-border/40 px-4 py-3">
          <h3 className="text-sm font-semibold">{t('references.pickerTitle', { defaultValue: '引用会话' })}</h3>
          <button type="button" onClick={onCancel} className="rounded p-1 hover:bg-accent"><X className="h-4 w-4" /></button>
        </div>

        <div className="border-b border-border/40 p-2">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t('references.searchPlaceholder', { defaultValue: '搜索(空=当前 project,输入切全部)' })}
              className="w-full rounded-md border border-border/50 bg-background py-1.5 pl-8 pr-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
            />
          </div>
        </div>
        <div className="max-h-[55vh] overflow-y-auto">
          {list.length === 0 ? (
            <div className="px-4 py-8 text-center text-sm text-muted-foreground">{t('references.noSessions', { defaultValue: '无匹配会话' })}</div>
          ) : list.map((s) => (
            <button
              key={s.sessionId}
              type="button"
              onClick={() => onConfirm(s.sessionId, s.title, s.provider)}
              className="flex w-full items-center justify-between border-b border-border/30 px-4 py-2.5 text-left last:border-b-0 hover:bg-accent/50"
            >
              <div className="min-w-0">
                <div className="truncate text-sm font-medium">{s.title}</div>
                <div className="text-xs uppercase text-muted-foreground">{s.provider}</div>
              </div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
