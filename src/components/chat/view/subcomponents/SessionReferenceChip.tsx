import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronDown, ChevronUp, X } from 'lucide-react';
import { estimateTokens, type SessionReference, type ReferencedMessage } from '../../utils/sessionReferenceFormat';

interface SessionReferenceChipProps {
  reference: SessionReference;
  onRemove: (id: string) => void;
  onUpdateMessages: (id: string, messages: ReferencedMessage[]) => void;
  onTrimToFirstN: (id: string, n: number) => void;
}

export default function SessionReferenceChip({
  reference,
  onRemove,
  onUpdateMessages,
  onTrimToFirstN,
}: SessionReferenceChipProps) {
  const { t } = useTranslation('chat');
  const [expanded, setExpanded] = useState(false);
  const [editText, setEditText] = useState('');
  const [editing, setEditing] = useState(false);

  const tokens = estimateTokens(reference.messages.map((m) => `[${m.role}] ${m.content}`).join('\n'));
  const overBudget = tokens > 4000;

  const startEdit = () => {
    setEditText(reference.messages.map((m) => `[${m.role}] ${m.content}`).join('\n'));
    setEditing(true);
  };
  const saveEdit = () => {
    // 解析回 messages(按 `[role] content` 行拆)
    const msgs: ReferencedMessage[] = editText.split('\n').filter((l) => l.trim()).map((line) => {
      const m = line.match(/^\[([^\]]+)\]\s*(.*)$/);
      return m ? { role: m[1], content: m[2] } : { role: 'user', content: line };
    });
    onUpdateMessages(reference.id, msgs);
    setEditing(false);
  };

  return (
    <div className="rounded-md border border-border/50 bg-muted/30 text-xs">
      <div className="flex items-center gap-1.5 px-2 py-1">
        <button type="button" onClick={() => setExpanded((v) => !v)} className="flex min-w-0 flex-1 items-center gap-1 text-left">
          {expanded ? <ChevronUp className="h-3 w-3 flex-shrink-0" /> : <ChevronDown className="h-3 w-3 flex-shrink-0" />}
          <span className="truncate">📎 {t('references.chipFrom', { defaultValue: '引自「{{title}}」', title: reference.title })}</span>
          <span className="flex-shrink-0 text-muted-foreground">· {reference.mode === 'full' ? t('references.modeFull', { defaultValue: '整段' }) : t('references.modeSingle', { defaultValue: '单条' })}</span>
          <span className={`flex-shrink-0 ${overBudget ? 'text-amber-600 dark:text-amber-400' : 'text-muted-foreground'}`}>· {tokens}t</span>
        </button>
        <button type="button" onClick={() => onRemove(reference.id)} className="rounded p-0.5 hover:bg-accent"><X className="h-3 w-3" /></button>
      </div>
      {expanded && (
        <div className="border-t border-border/40 p-2">
          {reference.mode === 'full' && (
            <div className="mb-2 flex items-center gap-1 text-[11px] text-muted-foreground">
              <label>{t('references.trimFirstN', { defaultValue: '前 N 条:' })}</label>
              <input
                type="number"
                min={1}
                max={reference.messages.length}
                defaultValue={reference.messages.length}
                onBlur={(e) => onTrimToFirstN(reference.id, Math.max(1, Number(e.target.value) || reference.messages.length))}
                className="w-16 rounded border border-border/50 bg-background px-1 py-0.5"
              />
            </div>
          )}
          {editing ? (
            <>
              <textarea
                value={editText}
                onChange={(e) => setEditText(e.target.value)}
                rows={6}
                className="w-full rounded border border-border/50 bg-background p-1.5 font-mono text-[11px]"
              />
              <div className="mt-1 flex gap-1">
                <button type="button" onClick={saveEdit} className="rounded bg-primary px-2 py-0.5 text-primary-foreground">{t('references.save', { defaultValue: '保存' })}</button>
                <button type="button" onClick={() => setEditing(false)} className="rounded px-2 py-0.5 hover:bg-accent">{t('references.cancel', { defaultValue: '取消' })}</button>
              </div>
            </>
          ) : (
            <>
              <div className="max-h-40 overflow-y-auto whitespace-pre-wrap break-words text-[11px] text-muted-foreground">
                {reference.messages.map((m, i) => (
                  <div key={i}><span className="font-medium">[{m.role}]</span> {m.content}</div>
                ))}
              </div>
              <button type="button" onClick={startEdit} className="mt-1 text-[11px] text-primary hover:underline">{t('references.edit', { defaultValue: '编辑' })}</button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
