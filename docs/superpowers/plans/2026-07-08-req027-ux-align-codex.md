---
REQ-ID: REQ-027
title: UX 对齐 Codex · 渲染层交互优化实施 plan
date: 2026-07-08
spec: ../specs/2026-07-08-req027-ux-align-codex-design.md
status: plan
owner: Archie
---

# REQ-027 UX 对齐 Codex 渲染层交互优化 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 给 planrla 的 diff 加语法高亮(①)、plan 步骤结构化展示(②)、diff 行级评论+复制为消息(④),对齐 Codex 渲染层交互。

**Architecture:** 三项独立,纯前端,provider 无关。① 复用现有 `react-syntax-highlighter`;② 解析 plan markdown 的 checkbox/编号;④ 本地评论 state + ComposerContext 注入 composer。

**Tech Stack:** React + TypeScript + Vite;`react-syntax-highlighter`(Prism/oneDark,已装);`shared/view/ui`(Collapsible/Badge/Button);测试 `node:test` + `node:assert/strict`(纯逻辑),组件靠 `typecheck` + `build` + 手动验收(planrla 无 React 渲染测试设施)。

**Worktree:** `feat/req027-ux-align-codex`(已建,spec commit `7f47cec`)

---

## File Structure

| 文件 | 责任 | 动作 |
|---|---|---|
| `src/components/chat/tools/utils/languageDetect.ts` | 扩展名 → Prism language | 新建 |
| `src/components/chat/tools/utils/languageDetect.test.ts` | languageDetect 单测 | 新建 |
| `src/components/chat/tools/utils/planSteps.ts` | plan markdown 步骤解析 | 新建 |
| `src/components/chat/tools/utils/planSteps.test.ts` | planSteps 单测 | 新建 |
| `src/components/chat/tools/components/ToolDiffViewer.tsx` | diff 渲染(① 高亮 + ④ 评论入口 + 复制按钮) | 修改 |
| `src/components/chat/tools/components/DiffLineComments.tsx` | ④ 评论 state + popover + 计数 | 新建 |
| `src/components/chat/tools/components/PlanDisplay.tsx` | plan 渲染(② 步骤) | 修改 |
| `src/contexts/ComposerContext.tsx` | ④ composer 注入(insertText) | 新建 |
| `src/components/chat/view/ChatInterface.tsx` | 包 ComposerProvider | 修改 |
| `src/i18n/locales/en/chat.json` | ④/② 文案 en | 修改 |
| `src/i18n/locales/zh-CN/chat.json` | ④/② 文案 zh-CN | 修改 |

**文件卫生:** ToolDiffViewer(93→~150,① 高亮 + ④ 入口)、DiffLineComments(新,~120)、PlanDisplay(139→~190)、languageDetect(~35)、planSteps(~50)、ComposerContext(~25)—— 均 <500。

---

## Task 1: ① getLanguageFromPath util(TDD)

**Files:**
- Create: `src/components/chat/tools/utils/languageDetect.ts`
- Test: `src/components/chat/tools/utils/languageDetect.test.ts`

- [ ] **Step 1: 写失败测试**

`src/components/chat/tools/utils/languageDetect.test.ts`:
```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getLanguageFromPath } from './languageDetect';

test('getLanguageFromPath: .ts/.tsx → typescript', () => {
  assert.equal(getLanguageFromPath('src/foo.ts'), 'typescript');
  assert.equal(getLanguageFromPath('a/b/App.tsx'), 'typescript');
});

test('getLanguageFromPath: .js/.jsx/.mjs → javascript', () => {
  assert.equal(getLanguageFromPath('foo.js'), 'javascript');
  assert.equal(getLanguageFromPath('foo.jsx'), 'javascript');
  assert.equal(getLanguageFromPath('foo.mjs'), 'javascript');
});

test('getLanguageFromPath: 各主流扩展名', () => {
  assert.equal(getLanguageFromPath('a.py'), 'python');
  assert.equal(getLanguageFromPath('a.go'), 'go');
  assert.equal(getLanguageFromPath('a.rs'), 'rust');
  assert.equal(getLanguageFromPath('a.java'), 'java');
  assert.equal(getLanguageFromPath('a.json'), 'json');
  assert.equal(getLanguageFromPath('a.md'), 'markdown');
  assert.equal(getLanguageFromPath('a.css'), 'css');
  assert.equal(getLanguageFromPath('a.html'), 'markup');
  assert.equal(getLanguageFromPath('a.yml'), 'yaml');
  assert.equal(getLanguageFromPath('a.sh'), 'bash');
});

test('getLanguageFromPath: 未知扩展名 → text', () => {
  assert.equal(getLanguageFromPath('a.xyz'), 'text');
  assert.equal(getLanguageFromPath('README'), 'text');
});

test('getLanguageFromPath: 空/无路径 → text', () => {
  assert.equal(getLanguageFromPath(''), 'text');
  assert.equal(getLanguageFromPath(undefined as any), 'text');
});

test('getLanguageFromPath: 大小写不敏感', () => {
  assert.equal(getLanguageFromPath('a.TS'), 'typescript');
  assert.equal(getLanguageFromPath('a.PY'), 'python');
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `node --import tsx --test src/components/chat/tools/utils/languageDetect.test.ts`
Expected: FAIL(`Cannot find module './languageDetect'`)

- [ ] **Step 3: 写实现**

`src/components/chat/tools/utils/languageDetect.ts`:
```ts
const EXT_TO_LANG: Record<string, string> = {
  ts: 'typescript', tsx: 'typescript',
  js: 'javascript', jsx: 'javascript', mjs: 'javascript', cjs: 'javascript',
  py: 'python',
  go: 'go',
  rs: 'rust',
  java: 'java',
  kt: 'kotlin', kts: 'kotlin',
  rb: 'ruby',
  php: 'php',
  css: 'css', scss: 'scss', less: 'css',
  html: 'markup', xml: 'markup', svg: 'markup', vue: 'markup',
  json: 'json', json5: 'json',
  md: 'markdown', markdown: 'markdown',
  yml: 'yaml', yaml: 'yaml', toml: 'ini',
  sh: 'bash', bash: 'bash', zsh: 'bash',
  sql: 'sql',
  c: 'c', h: 'c',
  cpp: 'cpp', cc: 'cpp', hpp: 'cpp',
  cs: 'csharp',
  swift: 'swift',
  dart: 'dart',
  lua: 'lua',
  r: 'r',
};

export function getLanguageFromPath(filePath: string | undefined | null): string {
  if (!filePath) return 'text';
  const dot = filePath.lastIndexOf('.');
  if (dot < 0) return 'text';
  const ext = filePath.slice(dot + 1).toLowerCase();
  return EXT_TO_LANG[ext] ?? 'text';
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `node --import tsx --test src/components/chat/tools/utils/languageDetect.test.ts`
Expected: PASS(6 tests)

- [ ] **Step 5: typecheck + commit**

```bash
npm run typecheck
git add src/components/chat/tools/utils/languageDetect.ts src/components/chat/tools/utils/languageDetect.test.ts
git commit -m "feat(chat): REQ-027 ① getLanguageFromPath util + 单测"
```

---

## Task 2: ① ToolDiffViewer 接入语法高亮

**Files:**
- Modify: `src/components/chat/tools/components/ToolDiffViewer.tsx`

- [ ] **Step 1: 改 ToolDiffViewer 加高亮**

在 `ToolDiffViewer.tsx` 顶部加 import:
```tsx
import { useMemo } from 'react';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { oneDark } from 'react-syntax-highlighter/dist/esm/styles/prism';
import { getLanguageFromPath } from '../utils/languageDetect';
```

在组件内(`diffLines` 的 `useMemo` 之后)加:
```tsx
const language = useMemo(() => getLanguageFromPath(filePath), [filePath]);
const DIFF_HIGHLIGHT_THRESHOLD = 200;
const shouldHighlight = language !== 'text' && diffLines.length <= DIFF_HIGHLIGHT_THRESHOLD;
```

替换「Diff lines」渲染块(当前第 67-90 行的 `<div className="font-mono ...">` 内层),把每行的 `{diffLine.content}` 改为条件高亮:
```tsx
<div className="font-mono text-[11px] leading-[18px]">
  {diffLines.map((diffLine, i) => (
    <div key={i} className="flex">
      <span
        className={`w-6 flex-shrink-0 select-none text-center ${
          diffLine.type === 'removed'
            ? 'bg-red-50 text-red-400 dark:bg-red-950/30 dark:text-red-500'
            : 'bg-green-50 text-green-400 dark:bg-green-950/30 dark:text-green-500'
        }`}
      >
        {diffLine.type === 'removed' ? '-' : '+'}
      </span>
      <span
        className={`flex-1 whitespace-pre-wrap px-2 ${
          diffLine.type === 'removed'
            ? 'bg-red-50/50 text-red-800 dark:bg-red-950/20 dark:text-red-200'
            : 'bg-green-50/50 text-green-800 dark:bg-green-950/20 dark:text-green-200'
        }`}
      >
        {shouldHighlight ? (
          <SyntaxHighlighter
            language={language}
            style={oneDark}
            PreTag="span"
            CodeTag="span"
            customStyle={{
              margin: 0,
              padding: 0,
              background: 'transparent',
              fontSize: '11px',
              lineHeight: '18px',
              display: 'inline',
            }}
            codeTagProps={{ style: { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace' } }}
          >
            {diffLine.content}
          </SyntaxHighlighter>
        ) : (
          diffLine.content
        )}
      </span>
    </div>
  ))}
</div>
```

> 说明:`PreTag="span" CodeTag="span"` 让 SyntaxHighlighter 行内渲染(不产生 pre/code 块),`background: 'transparent'` 让外层红绿背景透出。`shouldHighlight` 在 language='text'(未识别)或 diffLines>200(大 diff 性能保护)时为 false → fallback 纯文本。

- [ ] **Step 2: typecheck + build**

Run: `npm run typecheck && npm run build`
Expected: 无错误(`react-syntax-highlighter` 已在依赖,Markdown.tsx 同款用法)

- [ ] **Step 3: 手动验证**

Run: `npm run dev`(web,localhost:5173),发起一个 Edit 会话(让 provider 改 .ts 文件),观察 diff 块:关键字(`function`/`const`/`return`)应有着色(oneDark 配色),保留 +/- 红绿背景与可点击文件名。

- [ ] **Step 4: commit**

```bash
git add src/components/chat/tools/components/ToolDiffViewer.tsx
git commit -m "feat(chat): REQ-027 ① ToolDiffViewer 语法高亮(+大diff fallback)"
```

---

## Task 3: ② parsePlanSteps util(TDD)

**Files:**
- Create: `src/components/chat/tools/utils/planSteps.ts`
- Test: `src/components/chat/tools/utils/planSteps.test.ts`

- [ ] **Step 1: 写失败测试**

`src/components/chat/tools/utils/planSteps.test.ts`:
```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parsePlanSteps } from './planSteps';

test('parsePlanSteps: checkbox 列表(≥2)→ 步骤', () => {
  const md = '- [ ] 第一步\n- [ ] 第二步\n- [x] 第三步';
  const steps = parsePlanSteps(md);
  assert.ok(steps);
  assert.equal(steps!.length, 3);
  assert.equal(steps![0].checked, false);
  assert.equal(steps![2].checked, true);
  assert.equal(steps![2].text, '第三步');
});

test('parsePlanSteps: 编号列表(≥2)→ 步骤', () => {
  const md = '1. 先做这个\n2. 再做那个';
  const steps = parsePlanSteps(md);
  assert.ok(steps);
  assert.equal(steps!.length, 2);
  assert.equal(steps![0].marker, '1.');
  assert.equal(steps![1].text, '再做那个');
});

test('parsePlanSteps: 仅 1 行步骤 → null(不够)', () => {
  assert.equal(parsePlanSteps('- [ ] 唯一一步'), null);
});

test('parsePlanSteps: 自由文本 plan → null', () => {
  const md = '这是一个自由文本 plan,没有步骤结构。\n第二段描述。';
  assert.equal(parsePlanSteps(md), null);
});

test('parsePlanSteps: 步骤前的引导文本被跳过', () => {
  const md = '我来规划一下:\n\n- [ ] 步骤A\n- [ ] 步骤B';
  const steps = parsePlanSteps(md);
  assert.ok(steps);
  assert.equal(steps!.length, 2);
});

test('parsePlanSteps: 空串 → null', () => {
  assert.equal(parsePlanSteps(''), null);
  assert.equal(parsePlanSteps(undefined as any), null);
});

test('parsePlanSteps: checkbox 与编号不混(遇异类中断)', () => {
  const md = '- [ ] A\n- [ ] B\n然后说明\n- [ ] C';
  const steps = parsePlanSteps(md);
  assert.ok(steps);
  assert.equal(steps!.length, 2); // 遇「然后说明」中断
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `node --import tsx --test src/components/chat/tools/utils/planSteps.test.ts`
Expected: FAIL(`Cannot find module './planSteps'`)

- [ ] **Step 3: 写实现**

`src/components/chat/tools/utils/planSteps.ts`:
```ts
export interface PlanStep {
  marker: string;            // '[ ]' / '[x]' / '1.' / '2.'
  checked: boolean | null;   // true/false for checkbox,null for 编号
  text: string;
}

const CHECKBOX_RE = /^\s*[-*]\s+\[( |x|X)\]\s+(.+)$/;
const ORDERED_RE = /^\s*(\d+)\.\s+(.+)$/;

/**
 * 解析 plan markdown 为步骤。
 * 规则:从首个 checkbox/编号行开始,连续收集同类;遇非步骤行中断。
 * 返回 null 表示非步骤型 plan(调用方走整块 markdown 渲染)。
 */
export function parsePlanSteps(content: string | undefined | null): PlanStep[] | null {
  if (!content) return null;
  const lines = content.split(/\r?\n/);
  const steps: PlanStep[] = [];
  let mode: 'checkbox' | 'ordered' | null = null;

  for (const line of lines) {
    // 跳过尚未开始的空行/引导文本
    if (steps.length === 0 && line.trim() === '') continue;

    const cb = line.match(CHECKBOX_RE);
    const od = line.match(ORDERED_RE);

    if (cb) {
      if (mode === null) mode = 'checkbox';
      if (mode !== 'checkbox') break;
      steps.push({ marker: `[${cb[1].toLowerCase()}]`, checked: cb[1].toLowerCase() === 'x', text: cb[2] });
      continue;
    }
    if (od) {
      if (mode === null) mode = 'ordered';
      if (mode !== 'ordered') break;
      steps.push({ marker: `${od[1].}`, checked: null, text: od[2] });
      continue;
    }
    // 已开始收集却遇到非步骤行 → 中断
    if (steps.length > 0) break;
    // 否则(引导文本)继续
  }

  return steps.length >= 2 ? steps : null;
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `node --import tsx --test src/components/chat/tools/utils/planSteps.test.ts`
Expected: PASS(7 tests)

- [ ] **Step 5: typecheck + commit**

```bash
npm run typecheck
git add src/components/chat/tools/utils/planSteps.ts src/components/chat/tools/utils/planSteps.test.ts
git commit -m "feat(chat): REQ-027 ② parsePlanSteps util + 单测"
```

---

## Task 4: ② PlanDisplay 步骤渲染

**Files:**
- Modify: `src/components/chat/tools/components/PlanDisplay.tsx`

- [ ] **Step 1: PlanDisplay 接入步骤渲染**

在 `PlanDisplay.tsx` 顶部加 import:
```tsx
import { useMemo } from 'react';
import { parsePlanSteps, type PlanStep } from '../utils/planSteps';
import { CheckCircle2, Circle, ListOrdered } from 'lucide-react';
```

在组件内(`content` 下方)加:
```tsx
const steps = useMemo(() => parsePlanSteps(content), [content]);
```

把当前 `<CardContent>` 内的 `{content ? (<MarkdownContent .../>) : ...}` 块替换为:
```tsx
{content ? (
  steps ? (
    <ol className="space-y-2">
      {steps.map((step: PlanStep, i: number) => (
        <li key={i} className="flex items-start gap-2 text-sm">
          {step.checked === true ? (
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-green-500" />
          ) : step.checked === false ? (
            <Circle className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
          ) : (
            <span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-muted text-[10px] font-medium text-muted-foreground">
              {i + 1}
            </span>
          )}
          <span className="flex-1 text-foreground">
            <MarkdownContent
              content={step.text}
              className="prose prose-sm max-w-none dark:prose-invert [&>:last-child]:mb-0"
            />
          </span>
        </li>
      ))}
    </ol>
  ) : (
    <MarkdownContent
      content={content}
      className="prose prose-sm max-w-none dark:prose-invert"
    />
  )
) : isStreaming ? (
  <div className="py-2">
    <Shimmer>{t('plan.generating')}</Shimmer>
  </div>
) : null}
```

- [ ] **Step 2: typecheck + build**

Run: `npm run typecheck && npm run build`
Expected: 无错误

- [ ] **Step 3: 手动验证**

Run: `npm run dev`,触发 ExitPlanMode 且 plan 含 `- [ ]` 或 `1.` 列表 → 渲染为带圈/勾/序号的竖向步骤列表;自由文本 plan → 保持当前 markdown 渲染。

- [ ] **Step 4: commit**

```bash
git add src/components/chat/tools/components/PlanDisplay.tsx
git commit -m "feat(chat): REQ-027 ② PlanDisplay 步骤结构化渲染(checkbox/编号)"
```

---

## Task 5: ④ ComposerContext(注入路径)

**Files:**
- Create: `src/contexts/ComposerContext.tsx`
- Modify: `src/components/chat/view/ChatInterface.tsx`

> 设计依据:`ChatInterface.tsx:160-164` 从 hook 解构出 `input` + `setInput`(已确认),`setInput` 已传到 ChatMessagesPane(L412)。④ 用 Context 暴露 `insertText`,ToolDiffViewer consume,避免 prop 链污染 MessageComponent/ToolRenderer。

- [ ] **Step 1: 新建 ComposerContext**

`src/contexts/ComposerContext.tsx`:
```tsx
import { createContext, useContext } from 'react';

export interface ComposerApi {
  /** 在 composer 当前 input 末尾追加文本(换行分隔)。*/
  insertText: (text: string) => void;
}

const ComposerContext = createContext<ComposerApi | null>(null);

export const ComposerProvider = ComposerContext.Provider;

export function useComposer(): ComposerApi | null {
  return useContext(ComposerContext);
}
```

- [ ] **Step 2: ChatInterface 包 Provider**

在 `ChatInterface.tsx` 顶部加 import:
```tsx
import { ComposerProvider } from '../../../../contexts/ComposerContext';
```

在组件内(`setInput` 可用的作用域)加:
```tsx
const insertTextToComposer = useCallback(
  (text: string) => {
    // setInput 来自组件 hook destructure(标准 React setter,支持 functional update)
    setInput((prev: string) => (prev && prev.trim() ? `${prev}\n${text}` : text));
  },
  [setInput],
);
```
> 若 typecheck 报 `setInput` 不支持 functional update(自定义 hook 包装的 setter 可能只接受 string),改为:`setInput((input ? `${input}\n${text}` : text))`(把 `input` 加入依赖)。以 ChatInterface 实际 `setInput` 签名为准 —— 它已是 hook 解构的 state setter,标准 functional update 应可用。

在 `return (` 的最外层包裹(包住 ChatMessagesPane + ChatComposer):
```tsx
return (
  <ComposerProvider value={{ insertText: insertTextToComposer }}>
    {/* 原有 JSX 不变 */}
    ...
  </ComposerProvider>
);
```

- [ ] **Step 3: typecheck + build**

Run: `npm run typecheck && npm run build`
Expected: 无错误

- [ ] **Step 4: commit**

```bash
git add src/contexts/ComposerContext.tsx src/components/chat/view/ChatInterface.tsx
git commit -m "feat(chat): REQ-027 ④ ComposerContext(insertText 注入路径)"
```

---

## Task 6: ④ ToolDiffViewer 行级评论 + 复制为消息

**Files:**
- Create: `src/components/chat/tools/components/DiffLineComments.tsx`
- Modify: `src/components/chat/tools/components/ToolDiffViewer.tsx`

- [ ] **Step 1: 新建 DiffLineComments 子组件**

`DiffLineComments` 只负责底部汇总条(评论计数 + 复制为消息按钮);行级评论按钮与 popover 放在 ToolDiffViewer 内联(Step 2),避免状态跨组件泄漏。

`src/components/chat/tools/components/DiffLineComments.tsx`:
```tsx
import React from 'react';
import { MessageSquare, Copy, Check } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useComposer } from '../../../../contexts/ComposerContext';

interface DiffLineCommentsProps {
  filePath: string;
  commentsByLine: Record<number, string>;
}

export const DiffLineComments: React.FC<DiffLineCommentsProps> = ({ filePath, commentsByLine }) => {
  const { t } = useTranslation('chat');
  const composer = useComposer();
  const [copied, setCopied] = React.useState(false);

  const entries = Object.entries(commentsByLine).filter(([, text]) => text && text.trim());
  const commentCount = entries.length;

  const handleCopyAsMessage = () => {
    const text = entries
      .map(([idx, text]) => `${filePath}:L${Number(idx) + 1}\n> ${text.trim()}`)
      .join('\n');
    composer?.insertText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  if (!composer) return null;

  return (
    <div className="flex items-center gap-2 border-t border-gray-200/60 px-2.5 py-1 dark:border-gray-700/50">
      {commentCount > 0 && (
        <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
          <MessageSquare className="h-3 w-3" />
          {commentCount}
        </span>
      )}
      <button
        type="button"
        onClick={handleCopyAsMessage}
        disabled={commentCount === 0}
        className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-40 disabled:hover:bg-transparent"
      >
        {copied ? <Check className="h-3 w-3 text-green-500" /> : <Copy className="h-3 w-3" />}
        {copied ? t('diffComments.copied') : t('diffComments.copyAsMessage')}
      </button>
    </div>
  );
};
```

- [ ] **Step 2: ToolDiffViewer 加行级评论交互**

在 `ToolDiffViewer.tsx` 加 import:
```tsx
import { useState } from 'react';
import { MessageSquare } from 'lucide-react';
import { DiffLineComments } from './DiffLineComments';
```

在 ToolDiffViewer 组件内(`shouldHighlight` 附近)加评论 state:
```tsx
const [comments, setComments] = useState<Record<number, string>>({});
const [openCommentLine, setOpenCommentLine] = useState<number | null>(null);
const [commentDraft, setCommentDraft] = useState('');

const setComment = (lineIndex: number, text: string) => {
  setComments((prev) => {
    const next = { ...prev };
    if (text.trim()) next[lineIndex] = text;
    else delete next[lineIndex];
    return next;
  });
};
```

在每行 diff 渲染的 `<span className="flex-1 ...">...</span>` 之后(同 `<div key={i} className="flex">` 内),追加行级评论按钮:
```tsx
<button
  type="button"
  title="评论此行"
  onClick={() => {
    setOpenCommentLine(openCommentLine === i ? null : i);
    setCommentDraft(comments[i] ?? '');
  }}
  className="flex-shrink-0 px-1 text-muted-foreground/40 opacity-0 transition-opacity hover:text-muted-foreground group-hover:line:hover:opacity-100"
>
  <MessageSquare className="h-3 w-3" />
  {comments[i] && <span className="ml-0.5 text-[10px] align-middle">●</span>}
</button>
```
> 行 hover 显示按钮:`group-hover:line:hover:opacity-100` —— 给外层 diff 容器加 `group` class,内层行加 `line`。若 group 嵌套有问题,改用 `peer` 或直接 `hover:opacity-100`(行 hover 即显示)。

在每行 `</div>`(diffLine row 闭合)之后,条件渲染评论 popover:
```tsx
{openCommentLine === i && (
  <div className="flex gap-2 border-l-2 border-blue-300 bg-blue-50/50 px-2 py-1.5 dark:border-blue-700 dark:bg-blue-950/20">
    <textarea
      value={commentDraft}
      onChange={(e) => setCommentDraft(e.target.value)}
      placeholder="对此行的评论…"
      className="flex-1 resize-none rounded border border-gray-300 bg-white px-2 py-1 text-[11px] dark:border-gray-600 dark:bg-gray-800"
      rows={2}
    />
    <div className="flex flex-col gap-1">
      <button
        type="button"
        onClick={() => {
          setComment(i, commentDraft);
          setOpenCommentLine(null);
        }}
        className="rounded bg-blue-600 px-2 py-0.5 text-[10px] text-white hover:bg-blue-700"
      >
        保存
      </button>
      <button
        type="button"
        onClick={() => {
          setComment(i, '');
          setOpenCommentLine(null);
        }}
        className="rounded px-2 py-0.5 text-[10px] text-muted-foreground hover:text-foreground"
      >
        删除
      </button>
    </div>
  </div>
)}
```

在最外层 diff 容器底部(`</div>` 前),加 DiffLineComments 汇总条:
```tsx
<DiffLineComments filePath={filePath} commentsByLine={comments} />
```

- [ ] **Step 3: typecheck + build**

Run: `npm run typecheck && npm run build`
Expected: 无错误

- [ ] **Step 4: 手动验证**

Run: `npm run dev`,发起 Edit,diff 行 hover → 评论按钮 → 输入评论 → 保存(行显示 ●)→ 底部「复制为消息」→ composer input 出现 `文件:L行\n> 评论` 文本。

- [ ] **Step 5: commit**

```bash
git add src/components/chat/tools/components/DiffLineComments.tsx src/components/chat/tools/components/ToolDiffViewer.tsx
git commit -m "feat(chat): REQ-027 ④ diff 行级评论 + 复制为消息(本地 state)"
```

---

## Task 7: i18n(en + zh-CN)

**Files:**
- Modify: `src/i18n/locales/en/chat.json`
- Modify: `src/i18n/locales/zh-CN/chat.json`

- [ ] **Step 1: 加 en 文案**

在 `src/i18n/locales/en/chat.json` 的顶层对象内(与现有 key 同级)加:
```json
"diffComments": {
  "copyAsMessage": "Copy comments as message",
  "copied": "Copied to composer",
  "hint": "Hover a line to comment"
},
"plan": {
  "steps": "Steps"
}
```
> 若 `plan` 对象已存在(PlanDisplay 已用 `plan.toggle`/`plan.generating` 等),只在其中追加 `"steps": "Steps"`,勿覆盖已有 key。

- [ ] **Step 2: 加 zh-CN 文案**

在 `src/i18n/locales/zh-CN/chat.json` 对应位置加:
```json
"diffComments": {
  "copyAsMessage": "复制评论为消息",
  "copied": "已复制到输入框",
  "hint": "悬停行可评论"
},
"plan": {
  "steps": "步骤"
}
```
> 同上,`plan` 已存在则只追加 `steps`。

- [ ] **Step 3: typecheck + build**

Run: `npm run typecheck && npm run build`
Expected: 无错误

- [ ] **Step 4: commit**

```bash
git add src/i18n/locales/en/chat.json src/i18n/locales/zh-CN/chat.json
git commit -m "feat(i18n): REQ-027 ④/② diffComments + plan.steps(en + zh-CN)"
```

---

## Task 8: 预检 + 手动验收(对照 spec 验收标准)

**Files:** 无(验证 task)

- [ ] **Step 1: 预检门**

Run: `npm run typecheck && npm run build && npm run lint && git diff --check`
Expected: 全过,无 lint warning

- [ ] **Step 2: 单测全跑**

Run:
```bash
node --import tsx --test src/components/chat/tools/utils/languageDetect.test.ts
node --import tsx --test src/components/chat/tools/utils/planSteps.test.ts
```
Expected: 两文件全 PASS

- [ ] **Step 3: 功能验收(对照 spec §验收标准)**

Run: `npm run dev`(web),逐项验证:
1. **①** 发起 Edit(改 .ts 文件)→ diff 有语法着色(关键字着色)+/- 红绿保留 + 文件名可点击;改 `.xyz` 文件 → fallback 纯文本红绿;超大 diff(>200 行,可临时把阈值调小验证)→ 不高亮,渲染流畅。
2. **②** provider 输出含 `- [ ] 步骤` / `1. 步骤` 的 plan → 结构化步骤卡片(圈/勾/序号);自由文本 plan → 当前 markdown。
3. **④** diff 行 hover → 评论按钮 → 输入 → 保存(行 ●)→ 底部「复制评论为消息」→ composer 出现汇总文本;切换会话 → 评论清空(本地 state)。
4. **provider 无关**:Claude Code 验 ①②④;Codex/Gemini 至少验 ①。

- [ ] **Step 4: 回归抽查**

确认未破坏:现有 tool 卡片(Bash/Read/Grep 渲染)、reasoning 折叠、Permission banner、非 diff 的 CollapsibleDisplay。

- [ ] **Step 5: 更新 BACKLOG 状态**

`docs/process/BACKLOG.md` 的 REQ-027 行:`状态` 列 `spec` → `review`。

```bash
git add docs/process/BACKLOG.md
git commit -m "chore(backlog): REQ-027 → review(实施完成,待 Archie 三道门验收)"
```

---

## Self-Review

**1. Spec 覆盖**:
- spec ① diff 高亮 → Task 1(util)+ Task 2(集成)✅
- spec ② plan 展示增强 → Task 3(util)+ Task 4(渲染)✅
- spec ④ diff 行级评论 → Task 5(Context)+ Task 6(UI)✅
- spec i18n → Task 7 ✅
- spec 验收标准 → Task 8 ✅
- spec provider 无关 / 大 diff fallback / 评论本地 state / 无执行状态 → 均在对应 Task 落地 ✅

**2. 占位扫描**:无 TBD/TODO;④ setInput functional update 的不确定性在 Task 5 Step 2 给了 fallback(`input` 拼接);④ Task 6 的 group-hover 给了 fallback(`hover:opacity-100`)。Task 6 Step 1 的 DiffLineComments 已收敛为单一最终版(初版思考泄漏已删)。

**3. 类型一致**:`PlanStep`(`marker/checked/text`)Task 3 定义、Task 4 消费一致;`ComposerApi.insertText` Task 5 定义、Task 6 消费一致;`commentsByLine: Record<number, string>` Task 6 内一致。

**4. 风险点**(执行时注意):
- Task 2 `PreTag="span" CodeTag="span"` 是 react-syntax-highlighter 支持的(见其 README custom renderer);若版本差异导致 PreTag 不生效,改用 `renderer` 自定义。验证靠 Task 2 Step 3 手动看。
- Task 5 `setInput` 签名:hook 解构的 setter 标准支持 functional;若 typecheck 报错,用 fallback(直接拼 `input`)。
- Task 6 group-hover class:若 Tailwind group 嵌套问题,用 `hover:opacity-100` 行级 hover。
