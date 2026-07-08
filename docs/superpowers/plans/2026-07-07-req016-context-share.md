# REQ-016:跨会话 @引用 + 整段历史(L1 × C1+C2)— Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: 用 superpowers:subagent-driven-development(推荐)或 superpowers:executing-plans 逐 task 实施。Steps 用 checkbox(`- [ ]`)跟踪。

**REQ-ID:** REQ-016

**Goal:** 输入框旁「引用会话」按钮 + `Ctrl/Cmd+L` 触发 session picker → 选 session + 单条/整段 → 引用 chip(编辑/截断/多叠)→ 发送时客户端 prepend 到 `content`(零 server 改动)。

**Architecture:** 纯客户端。复用 `api.unifiedSessionMessages` 取 session 消息、sidebar sessions 数据填 picker。新 hook `useSessionReferences` 管引用状态;两个新组件 Picker + Chip;注入走 `useChatComposerState.handleSubmit` 把格式化引用块 prepend 到 `messageContent`;`MessageComponent` 解析并渲染折叠引用块。

**Tech Stack:** React 18 + TypeScript + Tailwind + shadcn PromptInput + lucide-react + react-i18next。测试:纯逻辑用 `node:test`(仓内既有模式,见 `src/shared/theme/themeMode.test.ts`),JSX 走 typecheck+build+手测。

**Worktree:** `.claude/worktrees/req016-context-share`(`feat/req016-context-share`)。所有命令在此 worktree 内执行。

**Spec:** `docs/superpowers/specs/2026-07-07-req016-context-share-design.md`

---

## File Structure

| 文件 | 责任 | 动作 |
|---|---|---|
| `src/components/chat/utils/sessionReferenceFormat.ts` | 纯逻辑:`formatReferenceBlock` / `parseQuotedReference` / `estimateTokens` + 类型 `SessionReference` | **Create** |
| `src/components/chat/utils/sessionReferenceFormat.test.ts` | node:test 覆盖上述纯函数 | **Create** |
| `src/components/chat/hooks/useSessionReferences.ts` | 引用状态管理(add/remove/edit/trim/clear + 总 token + 格式化全文) | **Create** |
| `src/components/chat/view/subcomponents/SessionReferencePicker.tsx` | session 列表 + search + 模式选择 + 单条消息选择器 | **Create** |
| `src/components/chat/view/subcomponents/SessionReferenceChip.tsx` | chip + 编辑/截断面板 | **Create** |
| `src/components/chat/hooks/useChatComposerState.ts` | `handleSubmit` 注入:prepend 引用块到 `messageContent`;发送后清空;Ctrl+L 接入 `handleKeyDown` | **Modify** |
| `src/components/chat/view/subcomponents/ChatComposer.tsx` | `PromptInputTools` 加「引用会话」按钮;`PromptInputHeader` 加 chip 列表;挂 Picker | **Modify** |
| `src/components/chat/view/subcomponents/MessageComponent.tsx` | user 消息 bubble:解析 + 渲染折叠引用块 | **Modify** |
| `src/components/chat/view/ChatInterface.tsx` | 把 useSessionReferences 输出透传给 ChatComposer | **Modify** |
| `src/i18n/locales/en/chat.json`(+其他语言) | 新 key:`references.*` | **Modify** |

不变:server / API contract / `chat.send` payload 结构。

---

## Task 1:sessionReferenceFormat 纯逻辑 + 测试(TDD)

**Files:**
- Create: `src/components/chat/utils/sessionReferenceFormat.ts`
- Create: `src/components/chat/utils/sessionReferenceFormat.test.ts`

- [ ] **Step 1: 写失败测试**

Create `src/components/chat/utils/sessionReferenceFormat.test.ts`:
```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  formatReferenceBlock,
  parseQuotedReference,
  estimateTokens,
} from './sessionReferenceFormat';
import type { SessionReference } from './sessionReferenceFormat';

const fullRef: SessionReference = {
  id: 'r1',
  sessionId: 's-a',
  title: 'Codex 重构讨论',
  provider: 'codex',
  date: '2026-07-05',
  mode: 'full',
  messages: [
    { role: 'user', content: '怎么拆 auth?' },
    { role: 'assistant', content: '用 middleware' },
  ],
};

test('estimateTokens: 粗估 = chars/4', () => {
  assert.equal(estimateTokens(''), 0);
  assert.equal(estimateTokens('abcd'), 1);
  assert.equal(estimateTokens('abcdefgh'), 2);
});

test('formatReferenceBlock: full 模式拼出头 + role 行', () => {
  const out = formatReferenceBlock(fullRef);
  assert.ok(out.startsWith('[引自会话「Codex 重构讨论」(codex, 2026-07-05)]'));
  assert.ok(out.includes('[user] 怎么拆 auth?'));
  assert.ok(out.includes('[assistant] 用 middleware'));
});

test('formatReferenceBlock: single 模式只含选中一条', () => {
  const singleRef: SessionReference = { ...fullRef, mode: 'single', messages: [fullRef.messages[0]] };
  const out = formatReferenceBlock(singleRef);
  assert.ok(out.includes('[user] 怎么拆 auth?'));
  assert.ok(!out.includes('[assistant]'));
});

test('parseQuotedReference: 无引用 → text 全文, quote null', () => {
  const { quote, text } = parseQuotedReference('你好');
  assert.equal(quote, null);
  assert.equal(text, '你好');
});

test('parseQuotedReference: 有引用 → 拆出 quote 头 + text', () => {
  const block = formatReferenceBlock(fullRef);
  const content = `${block}\n\n---\n\n那这套怎么套?`;
  const { quote, text } = parseQuotedReference(content);
  assert.ok(quote);
  assert.equal(quote.title, 'Codex 重构讨论');
  assert.equal(text, '那这套怎么套?');
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd .claude/worktrees/req016-context-share && npx tsx --test src/components/chat/utils/sessionReferenceFormat.test.ts`
Expected: FAIL(`sessionReferenceFormat` 不存在)。

- [ ] **Step 3: 写实现**

Create `src/components/chat/utils/sessionReferenceFormat.ts`:
```ts
export type SessionReferenceMode = 'single' | 'full';

export interface ReferencedMessage {
  role: 'user' | 'assistant' | string;
  content: string;
}

export interface SessionReference {
  /** 客户端生成的唯一 id(Date.now+random 或 crypto.randomUUID)。 */
  id: string;
  sessionId: string;
  title: string;
  provider: string;
  /** ISO date string(展示用)。 */
  date: string;
  mode: SessionReferenceMode;
  messages: ReferencedMessage[];
}

export interface ParsedQuote {
  title: string;
  provider: string;
  date: string;
  /** 含 role 标注的原文块(展示时再按行渲染)。 */
  body: string;
}

/** 粗估 token:总字符数 / 4(YAGNI,不引入 tiktoken)。 */
export function estimateTokens(text: string): number {
  return Math.ceil((text || '').length / 4);
}

/** 把单个引用格式化为注入文本块。 */
export function formatReferenceBlock(ref: SessionReference): string {
  const header = `[引自会话「${ref.title}」(${ref.provider}, ${ref.date})]`;
  const body = ref.messages
    .map((m) => `[${m.role}] ${m.content}`.trimEnd())
    .join('\n');
  return `${header}\n\n${body}`;
}

/** 多引用按顺序拼接成完整引用区(块之间空行分隔)。 */
export function formatReferenceSection(refs: SessionReference[]): string {
  return refs.map(formatReferenceBlock).join('\n\n');
}

const QUOTE_HEADER_RE = /^\[引自会话「([^」]+)」\(([^,]+),\s*([^)]+)\)\]\n\n([\s\S]*?)\n\n---\n\n([\s\S]*)$/;
const SECTION_HEADER_RE = /^\[引自会话「[^”]+»/;

/**
 * 解析发送后的 content:若以引用块开头(单引用,common case),拆出 quote + 用户文本。
 * 多引用 / 无引用 → quote=null, text=全文(展示降级:原样显示)。
 */
export function parseQuotedReference(content: string): { quote: ParsedQuote | null; text: string } {
  if (!content || !content.startsWith('[引自会话「')) {
    return { quote: null, text: content };
  }
  const m = content.match(QUOTE_HEADER_RE);
  if (!m) {
    return { quote: null, text: content };
  }
  const [, title, provider, date, body, text] = m;
  return { quote: { title, provider, date, body }, text };
}
```

注:`parseQuotedReference` 首切片只精确处理**单引用**(common case);多引用场景返回 `quote=null` 降级为原样显示(text 含全文)。多引用解析留给后续优化(YAGNI)。

- [ ] **Step 4: 跑测试确认通过**

Run: `npx tsx --test src/components/chat/utils/sessionReferenceFormat.test.ts`
Expected: 5 tests PASS。

- [ ] **Step 5: typecheck + commit**

```bash
npm run typecheck
git add src/components/chat/utils/sessionReferenceFormat.ts src/components/chat/utils/sessionReferenceFormat.test.ts
git commit -m "feat(chat): REQ-016 session reference 格式化纯逻辑 + 测试"
```

---

## Task 2:useSessionReferences hook

**Files:**
- Create: `src/components/chat/hooks/useSessionReferences.ts`

- [ ] **Step 1: 写 hook**

Create `src/components/chat/hooks/useSessionReferences.ts`:
```ts
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
```

- [ ] **Step 2: typecheck**

Run: `npm run typecheck`
Expected: PASS。

- [ ] **Step 3: commit**

```bash
git add src/components/chat/hooks/useSessionReferences.ts
git commit -m "feat(chat): REQ-016 useSessionReferences hook"
```

---

## Task 3:SessionReferencePicker 组件

**Files:**
- Create: `src/components/chat/view/subcomponents/SessionReferencePicker.tsx`

**依赖 prop:调用方(ChatInterface)传入候选 session 列表 + 选中回调。** session 数据 shape 见 sidebar(参考 `useSidebarController` 的 sessions / `getAllSessions`)。Picker 内部用 `api.unifiedSessionMessages` 取所选 session 的消息(单条模式)。

- [ ] **Step 1: 写组件**

Create `src/components/chat/view/subcomponents/SessionReferencePicker.tsx`:
```tsx
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
    const date = new Date().toISOString().slice(0, 10);
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
```

- [ ] **Step 2: typecheck**

Run: `npm run typecheck`
Expected: PASS。

- [ ] **Step 3: commit**

```bash
git add src/components/chat/view/subcomponents/SessionReferencePicker.tsx
git commit -m "feat(chat): REQ-016 SessionReferencePicker 组件"
```

---

## Task 4:SessionReferenceChip 组件

**Files:**
- Create: `src/components/chat/view/subcomponents/SessionReferenceChip.tsx`

- [ ] **Step 1: 写组件**

Create `src/components/chat/view/subcomponents/SessionReferenceChip.tsx`:
```tsx
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
```

- [ ] **Step 2: typecheck + commit**

```bash
npm run typecheck
git add src/components/chat/view/subcomponents/SessionReferenceChip.tsx
git commit -m "feat(chat): REQ-016 SessionReferenceChip 组件"
```

---

## Task 5:useChatComposerState 注入引用 + Ctrl+L

**Files:**
- Modify: `src/components/chat/hooks/useChatComposerState.ts`

把 `useSessionReferences` 接入 composer:`handleSubmit` 把 `formattedSection` prepend 到 `content`;发送后 `clearReferences`;`handleKeyDown` 加 `Ctrl/Cmd+L` 开 picker。

- [ ] **Step 1: 接入 hook + 暴露 picker 开关态**

在 `useChatComposerState` 顶部(L27 `import { useFileMentions }` 旁)加 import:
```ts
import { useSessionReferences } from './useSessionReferences';
```

在 `useChatComposerState` 函数体内(L201 `const [attachedImages...` 附近)加:
```ts
const {
  references,
  totalTokens: referenceTokens,
  formattedSection,
  addReference,
  removeReference,
  updateReferenceMessages,
  trimToFirstN,
  clearReferences,
} = useSessionReferences();
const [isReferencePickerOpen, setIsReferencePickerOpen] = useState(false);
const openReferencePicker = useCallback(() => setIsReferencePickerOpen(true), []);
const closeReferencePicker = useCallback(() => setIsReferencePickerOpen(false), []);
const handleConfirmReference = useCallback((sessionId: string, title: string, provider: string, mode: 'single' | 'full', messages: { role: string; content: string }[]) => {
  addReference({ sessionId, title, provider, date: new Date().toISOString().slice(0, 10), mode, messages });
  setIsReferencePickerOpen(false);
}, [addReference]);
```

- [ ] **Step 2: handleSubmit 注入 + 清空**

在 `handleSubmit`(L577 `const messageContent = currentInput;`)改为:
```ts
const referenceSection = formattedSection;
const messageContent = referenceSection
  ? `${referenceSection}\n\n---\n\n${currentInput}`
  : currentInput;
```

注意:`userMessage`(`addMessage({type:'user', content: ...})` L660-665)的 `content` 仍用 `currentInput`(聊天记录里展示用户打字 + 折叠引用块由 MessageComponent 解析;但 `sendMessage` 的 `content` 用 `messageContent` 含引用 —— 已是现状,L724 `content: messageContent`)。

**待确认细节**:`addMessage(userMessage)` L667 用的是 `currentInput`(用户原始打字),不含引用块。引用块在记录里展示需改成 `messageContent`(含引用)OR 在 userMessage 上加 `references` 元数据。**首切片取后者**:把 `addMessage` 的 content 改成 `messageContent`(让 MessageComponent 解析),最简 + 一致。L660-665 改:
```ts
const userMessage: ChatMessage = {
  type: 'user',
  content: messageContent,   // 改:原 currentInput
  images: uploadedImages as any,
  timestamp: new Date(),
};
```

发送后清空引用(L737 `setInput('')` 附近)加:
```ts
clearReferences();
```

- [ ] **Step 3: handleKeyDown 加 Ctrl/Cmd+L**

在 `handleKeyDown`(L859,`handleCommandMenuKeyDown` 之前或之后)加:
```ts
if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'l') {
  event.preventDefault();
  openReferencePicker();
  return;
}
```

- [ ] **Step 4: return 暴露新输出**

在 return 对象(L1027-1072)加:
```ts
references,
referenceTokens,
isReferencePickerOpen,
openReferencePicker,
closeReferencePicker,
handleConfirmReference,
removeReference,
updateReferenceMessages,
trimToFirstN,
```

- [ ] **Step 5: typecheck + build + commit**

```bash
npm run typecheck && npm run build
git add src/components/chat/hooks/useChatComposerState.ts
git commit -m "feat(chat): REQ-016 composer 注入引用 + Ctrl/Cmd+L"
```

---

## Task 6:ChatComposer 加按钮 + chip 列表 + 挂 Picker

**Files:**
- Modify: `src/components/chat/view/subcomponents/ChatComposer.tsx`
- Modify: `src/components/chat/view/ChatInterface.tsx`(透传 props)

- [ ] **Step 1: ChatComposer props 加引用相关**

ChatComposerProps(L52-107)加:
```ts
references: import('../../utils/sessionReferenceFormat').SessionReference[];
referenceTokens: number;
onOpenReferencePicker: () => void;
onRemoveReference: (id: string) => void;
onUpdateReferenceMessages: (id: string, messages: import('../../utils/sessionReferenceFormat').ReferencedMessage[]) => void;
onTrimToFirstN: (id: string, n: number) => void;
isReferencePickerOpen: boolean;
onCloseReferencePicker: () => void;
onConfirmReference: (sessionId: string, title: string, provider: string, mode: 'single' | 'full', messages: { role: string; content: string }[]) => void;
/** Picker 候选 sessions(当前 project)。 */
pickerDefaultSessions: import('./SessionReferencePicker').PickerCandidateSession[];
pickerAllSessions?: import('./SessionReferencePicker').PickerCandidateSession[];
```

函数签名解构(L109-161)加这些参数。

- [ ] **Step 2: import + 挂 Picker**

文件顶部 import 加:
```ts
import { Link2 as Link2Icon } from 'lucide-react';
import SessionReferencePicker from './SessionReferencePicker';
import SessionReferenceChip from './SessionReferenceChip';
```

在 return JSX( PromptInput 同级,L266 之前)挂 Picker:
```tsx
{isReferencePickerOpen && (
  <SessionReferencePicker
    defaultSessions={pickerDefaultSessions}
    allSessions={pickerAllSessions}
    onCancel={onCloseReferencePicker}
    onConfirm={onConfirmReference}
  />
)}
```

- [ ] **Step 3: PromptInputHeader 加 chip 列表**

在 `PromptInputHeader`(L288,图片附件块旁)加 chip 区(与图片附件并列,新一个 `PromptInputHeader`):
```tsx
{references.length > 0 && (
  <PromptInputHeader>
    <div className="rounded-xl bg-muted/40 p-2">
      <div className="flex flex-col gap-1.5">
        {references.map((r) => (
          <SessionReferenceChip
            key={r.id}
            reference={r}
            onRemove={onRemoveReference}
            onUpdateMessages={onUpdateReferenceMessages}
            onTrimToFirstN={onTrimToFirstN}
          />
        ))}
      </div>
    </div>
  </PromptInputHeader>
)}
```

- [ ] **Step 4: PromptInputTools 加「引用会话」按钮**

在 `PromptInputTools`(L333 图片附件按钮之前)加:
```tsx
<PromptInputButton
  tooltip={{ content: t('references.openPicker', { defaultValue: '引用会话 (Ctrl+L)' }) }}
  onClick={onOpenReferencePicker}
>
  <Link2Icon />
</PromptInputButton>
```

- [ ] **Step 5: ChatInterface 透传**

`src/components/chat/view/ChatInterface.tsx` 从 `useChatComposerState` 解构出新输出,传给 `<ChatComposer>`:
```ts
references,
referenceTokens,
isReferencePickerOpen,
openReferencePicker,
closeReferencePicker,
handleConfirmReference,
removeReference,
updateReferenceMessages,
trimToFirstN,
```
+ 构造 `pickerDefaultSessions` / `pickerAllSessions`(从 sidebar sessions 数据 / projects 映射成 `PickerCandidateSession[]`)。映射逻辑参考 sidebar 的 `getAllSessions(project)`(`src/components/sidebar/utils/utils.ts`)—— 把当前 project 的 sessions 映射成 `{sessionId, title, provider, lastActivity}`,全主机同理 flatten 所有 projects。

(若 ChatInterface 不便取 sidebar sessions,可在 useChatComposerState 里加一个 fetch(`/api/projects` + sessions)的 effect;首切片优先复用 ChatInterface 已有的 projects prop。)

- [ ] **Step 6: typecheck + build + commit**

```bash
npm run typecheck && npm run build
git add src/components/chat/view/subcomponents/ChatComposer.tsx src/components/chat/view/ChatInterface.tsx
git commit -m "feat(chat): REQ-016 ChatComposer 引用按钮 + chip + Picker 接线"
```

---

## Task 7:MessageComponent 渲染折叠引用块

**Files:**
- Modify: `src/components/chat/view/subcomponents/MessageComponent.tsx`

- [ ] **Step 1: import parseQuotedReference**

文件顶部加:
```ts
import { parseQuotedReference } from '../../utils/sessionReferenceFormat';
```

- [ ] **Step 2: user 消息分支解析 + 渲染**

在 user 消息 bubble(L114-119 `{message.type === 'user' ? (...)`)内,把 `{message.content}` 直接渲染改为解析后渲染。L116-120 当前:
```tsx
<div className="group flex-1 rounded-2xl ...">
  <div dir="auto" className="whitespace-pre-wrap break-words text-sm">
    {message.content}
  </div>
  {message.images && ...}
```
改为:
```tsx
<div className="group flex-1 rounded-2xl ...">
  <UserMessageBody content={String(message.content || '')} />
  {message.images && ...}
```

新增组件(同文件底部 export 一个 helper,或内联):
```tsx
function UserMessageBody({ content }: { content: string }) {
  const [collapsed, setCollapsed] = useState(true);
  const { quote, text } = parseQuotedReference(content);
  if (!quote) {
    return <div dir="auto" className="whitespace-pre-wrap break-words text-sm">{text}</div>;
  }
  return (
    <div className="text-sm">
      <div className="mb-1 rounded-md bg-blue-500/20 px-2 py-1 text-[11px]">
        <button type="button" onClick={() => setCollapsed((v) => !v)} className="flex items-center gap-1">
          {collapsed ? <ChevronDown className="h-3 w-3" /> : <ChevronUp className="h-3 w-3" />}
          <span>引自「{quote.title}」({quote.provider}, {quote.date})</span>
        </button>
        {!collapsed && (
          <div className="mt-1 whitespace-pre-wrap break-words opacity-90">{quote.body}</div>
        )}
      </div>
      <div dir="auto" className="whitespace-pre-wrap break-words">{text}</div>
    </div>
  );
}
```

(import `ChevronDown`/`ChevronUp` from lucide-react + `useState` from react —— 文件顶部确保已 import。)

- [ ] **Step 3: typecheck + build + commit**

```bash
npm run typecheck && npm run build
git add src/components/chat/view/subcomponents/MessageComponent.tsx
git commit -m "feat(chat): REQ-016 用户消息渲染折叠引用块"
```

---

## Task 8:i18n keys

**Files:**
- Modify: `src/i18n/locales/en/chat.json`(其他语言可选,缺则 fallback en)

- [ ] **Step 1: 加 references 段**

在 `chat.json` 顶层加:
```json
"references": {
  "openPicker": "Reference session (Ctrl+L)",
  "pickerTitle": "Reference session",
  "searchPlaceholder": "Search (empty=current project, type=all)",
  "noSessions": "No matching sessions",
  "modeFull": "Full history",
  "modeSingle": "Single message",
  "fullCount": "{{count}} messages",
  "chipFrom": "From \"{{title}}\"",
  "trimFirstN": "First N:",
  "edit": "Edit",
  "save": "Save",
  "cancel": "Cancel",
  "confirm": "Reference"
}
```

(组件里已用 `t('references.x', { defaultValue: '...' })`,缺 key 走 fallback,非阻塞。中文 zh-CN 同步加一份更佳,见 `src/i18n/locales/zh-CN/chat.json`。)

- [ ] **Step 2: commit**

```bash
git add src/i18n/locales/en/chat.json src/i18n/locales/zh-CN/chat.json
git commit -m "feat(i18n): REQ-016 references 段"
```

---

## Task 9:全预检 + dev 手测 + push

**Files:** 无改动,纯验证。

- [ ] **Step 1: 全预检**

```bash
npm run typecheck && npm run build && npm run lint && git diff --check
```
Expected:全 PASS(lint 的 2 个 server import-x/no-unresolved 是既有假阳性,非本需求)。

- [ ] **Step 2: dev 手测**

`npm run dev`(worktree 共享主仓 node_modules —— 若 server:dev 撞 ABI,先在**主 worktree** 跑 `npm run sync:node`,见 memory `planrla-desktop-native-abi.md`)。

浏览器 `http://localhost:5173`,对照 spec 验收 10 条逐项验:
1. 输入框旁有「引用会话」按钮 + `Ctrl+L` 弹 Picker
2. Picker 默认当前 project sessions;search 切全部
3. 单条 / 整段两种模式
4. chip 可编辑/截断/删除/多叠
5. 发送后 LLM 收到引用块+问题(看 server 日志或 provider 响应);聊天记录显示折叠块+问题
6. Claude session 引用 Codex session 正常(跨 Provider)
7. chip 显示 token;>4k 软警告(amber)
8. 现有 `@` 文件 / `/` slash / 图片附件 / `Tab` 权限 不受影响(回归)
9. mobile 视口按钮 + chip 正常

- [ ] **Step 3: push feat**

```bash
git push -u origin feat/req016-context-share
```

(后续:Archie 验收 → 合并 main → 13 构建 → 发版,独立流程。)

---

## Self-Review

**1. Spec 覆盖**:
- §1 触发(按钮 + Ctrl+L)→ Task 5 Step 3 + Task 6 Step 4 ✓
- §2 picker 范围(默认当前 project + search 全部)→ Task 3(list useMemo + search)✓
- §3 选择流程(单条/整段)→ Task 3(mode select + message picker)✓
- §4 chip(编辑/截断/多叠/删除)→ Task 4 ✓
- §5 注入(client prepend + LLM 收到 + 记录折叠)→ Task 5 Step 2 + Task 7 ✓
- §6 token 预算(chars/4 + 4k 软警告)→ Task 1 estimateTokens + Task 4 overBudget ✓
- §7 数据 / API(零 server)→ Task 3 用 api.unifiedSessionMessages ✓
- 验收 1-10 → Task 9 Step 2 覆盖 ✓

**2. Placeholder 扫描**:
- Task 6 Step 5「若 ChatInterface 不便取 sidebar sessions…」给了两种路径 —— 实施时二选一,不算 placeholder(有明确 fallback)。
- Task 7「同文件底部 export helper 或内联」—— 给了组件代码,内联即可。
- 无 TBD/TODO ✓

**3. Type 一致性**:
- `SessionReference` shape(id/sessionId/title/provider/date/mode/messages)跨 Task 1/2/3/4/6 一致 ✓
- `ReferencedMessage`(role/content)跨 Task 1/2/3/4/6 一致 ✓
- `addReference` 接 `Omit<SessionReference,'id'>`(Task 2)→ Task 5 `handleConfirmReference` 调 addReference 传完整 Omit 对象 ✓
- `onConfirm` 签名(sessionId/title/provider/mode/messages)Task 3 ↔ Task 5 handleConfirmReference ↔ Task 6 onConfirmReference 一致 ✓

**4. 风险点**:
- Task 5 Step 2 改 `addMessage(userMessage)` 的 content 到 `messageContent`(含引用块)—— 实施后回归看现有 chat 记录显示是否正常(MessageComponent Task 7 兜底解析)。
- Task 6 Step 5 sidebar sessions → PickerCandidateSession 映射,参考 `getAllSessions`(utils.ts)。
- commit message 全中文起头(避 commitlint subject-case)✓
- worktree 共享主仓 node_modules —— dev 前可能需主仓 sync:node(Task 9 已注)。
