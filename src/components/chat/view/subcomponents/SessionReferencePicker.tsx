import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Search, X, Loader2 } from 'lucide-react';
import { api } from '../../../../utils/api';
import type { SessionReferenceMode, ReferencedMessage } from '../../utils/sessionReferenceFormat';

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
  onConfirm: (sessionId: string, title: string, provider: string, mode: SessionReferenceMode, messages: ReferencedMessage[]) => void;
}

export default function SessionReferencePicker({
  defaultSessions,
  allSessions,
  onCancel,
  onConfirm,
}: SessionReferencePickerProps) {
  const { t } = useTranslation('chat');
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<PickerCandidateSession | null>(null);
  const [mode, setMode] = useState<SessionReferenceMode>('full');
  const [messages, setMessages] = useState<ReferencedMessage[] | null>(null);
  const [pickedMessageIdx, setPickedMessageIdx] = useState<number>(-1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 命中列表:query 非空且有 allSessions → 在 allSessions 过滤;否则在 defaultSessions 过滤
  const list = useMemo(() => {
    const pool = query.trim() && allSessions?.length ? allSessions : defaultSessions;
    if (!query.trim()) return pool.slice(0, 50);
    const q = query.toLowerCase();
    return pool.filter((s) => s.title.toLowerCase().includes(q)).slice(0, 50);
  }, [query, defaultSessions, allSessions]);

  // 选了 session → 拉它的消息
  useEffect(() => {
    if (!selected) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    api.unifiedSessionMessages(selected.sessionId, selected.provider)
      .then(async (res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const body = await res.json();
        const msgs: ReferencedMessage[] = (body?.messages ?? body?.data?.messages ?? [])
          .map((m: { role?: string; content?: string; text?: string }) => ({
            role: m.role || 'user',
            content: m.content ?? m.text ?? '',
          }));
        if (!cancelled) {
          setMessages(msgs);
          setPickedMessageIdx(-1);
          setLoading(false);
        }
      })
      .catch((e) => {
        if (!cancelled) {
          setError(e?.message || 'load failed');
          setLoading(false);
        }
      });
    return () => { cancelled = true; };
  }, [selected]);

  const confirm = () => {
    if (!selected || !messages) return;
    if (mode === 'single') {
      const idx = pickedMessageIdx >= 0 ? pickedMessageIdx : 0;
      onConfirm(selected.sessionId, selected.title, selected.provider, 'single', [messages[idx]]);
    } else {
      onConfirm(selected.sessionId, selected.title, selected.provider, 'full', messages);
    }
  };

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

        {!selected ? (
          <>
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
                  onClick={() => setSelected(s)}
                  className="flex w-full items-center justify-between border-b border-border/30 px-4 py-2.5 text-left last:border-b-0 hover:bg-accent/50"
                >
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium">{s.title}</div>
                    <div className="text-xs uppercase text-muted-foreground">{s.provider}</div>
                  </div>
                </button>
              ))}
            </div>
          </>
        ) : (
          <>
            <div className="border-b border-border/40 px-4 py-2 text-sm">
              <button type="button" onClick={() => { setSelected(null); setMessages(null); }} className="text-muted-foreground hover:text-foreground">
                ← {selected.title}
              </button>
            </div>
            <div className="flex gap-1 border-b border-border/40 p-2">
              <button type="button" onClick={() => setMode('full')} className={`flex-1 rounded-md px-3 py-1.5 text-xs ${mode === 'full' ? 'bg-primary text-primary-foreground' : 'bg-muted/50'}`}>{t('references.modeFull', { defaultValue: '整段历史' })}</button>
              <button type="button" onClick={() => setMode('single')} className={`flex-1 rounded-md px-3 py-1.5 text-xs ${mode === 'single' ? 'bg-primary text-primary-foreground' : 'bg-muted/50'}`}>{t('references.modeSingle', { defaultValue: '单条消息' })}</button>
            </div>
            <div className="max-h-[45vh] overflow-y-auto p-2">
              {loading ? (
                <div className="flex items-center justify-center py-8"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
              ) : error ? (
                <div className="px-4 py-8 text-center text-sm text-red-500">{error}</div>
              ) : mode === 'single' && messages ? (
                messages.map((m, i) => (
                  <button
                    key={i}
                    type="button"
                    onClick={() => setPickedMessageIdx(i)}
                    className={`mb-1 w-full rounded-md border px-3 py-2 text-left text-xs ${pickedMessageIdx === i ? 'border-primary bg-primary/5' : 'border-border/40'}`}
                  >
                    <div className="font-medium uppercase text-muted-foreground">{m.role}</div>
                    <div className="line-clamp-2">{m.content}</div>
                  </button>
                ))
              ) : messages ? (
                <div className="space-y-1 px-1 py-2 text-xs text-muted-foreground">
                  {t('references.fullCount', { defaultValue: '{{count}} 条消息', count: messages.length })}
                </div>
              ) : null}
            </div>
            <div className="flex justify-end gap-2 border-t border-border/40 p-2">
              <button type="button" onClick={onCancel} className="rounded-md px-3 py-1.5 text-sm hover:bg-accent">{t('references.cancel', { defaultValue: '取消' })}</button>
              <button
                type="button"
                onClick={confirm}
                disabled={!messages || (mode === 'single' && messages.length === 0)}
                className="rounded-md bg-primary px-3 py-1.5 text-sm text-primary-foreground disabled:opacity-50"
              >{t('references.confirm', { defaultValue: '引用' })}</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
