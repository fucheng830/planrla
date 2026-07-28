// src/components/markdown-editor/hooks/useAiSelectionEdit.ts
//
// REQ-047 — AI 选段改核心 hook(对标 Codex)。
//
// 流程:用户选段 → 触发 → 填指令 → 创建/复用 editor appSession → silent chat.send
// → 订阅 WS 过滤 silent 事件,累积 stream_delta → complete 取 buffer 为改后文本
// → 构造 old_full/new_full,通过 onApplyDiff 设到 CodeEditor 的 diffInfo
// → CodeEditor unifiedMergeView 自动高亮 → 用户接受/拒绝。
//
// silent 通道复用 REQ-030/046(详见 chat-websocket.service.ts:152),不新造。
// 失败/超时不污染编辑器内容,仅 toast。

import { useCallback, useEffect, useRef, useState } from 'react';

import { authenticatedFetch } from '../../../utils/api';
import { useWebSocket } from '../../../contexts/WebSocketContext';
import type { AiEditStatus } from '../types';

const AI_EDIT_TIMEOUT_MS = 15_000; // 兜底超时;silent run 常态 ≤5s
const DEFAULT_INSTRUCTION = '润色,保持 md 格式,不超原文长度,保留代码块/链接/标题层级';

export interface UseAiSelectionEditParams {
  projectId: string | null | undefined;
  projectPath: string;        // 项目绝对路径(创建 session 用)
  provider: string;            // 默认 claude
  relativePath: string;        // 当前文件相对项目根(/ 分隔)
  // 当前文件全文(构造 old_full/new_full 用)。
  getContent: () => string;
  // 应用 AI diff:把 {old_string, new_string} 设到 CodeEditor 的 diffInfo。
  // CodeEditor useCodeEditorDocument 命中 diffInfo 分支直接用 new_string,不读盘。
  onApplyDiff: (diff: { old_string: string; new_string: string; aiEdit: true }) => void;
  // 清除 AI diff(接受后清 diffInfo 保留 new 内容;拒绝后还原 old 内容)。
  onClearDiff: () => void;
  // 还原文件内容到 old_full(拒绝时用)。
  onRevertTo: (content: string) => void;
}

export interface UseAiSelectionEditResult {
  onSelectionChange: (selectedText: string, range: { from: number; to: number } | null) => void;
  trigger: () => void;
  submitPrompt: (instruction: string) => void;
  cancelInstruction: () => void;
  cancelRun: () => void;
  accept: () => void;
  reject: () => void;
  status: AiEditStatus;
  hasSelection: boolean;
  hasAiDiff: boolean;
  awaitingInstruction: boolean;
  message: string | null;
}

export function useAiSelectionEdit({
  projectId,
  projectPath,
  provider,
  relativePath,
  getContent,
  onApplyDiff,
  onClearDiff,
  onRevertTo,
}: UseAiSelectionEditParams): UseAiSelectionEditResult {
  const { subscribe, sendMessage } = useWebSocket();

  const [status, setStatus] = useState<AiEditStatus>('idle');
  const [hasSelection, setHasSelection] = useState(false);
  const [hasAiDiff, setHasAiDiff] = useState(false);
  const [awaitingInstruction, setAwaitingInstruction] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  // 选区 + session + buffer + diff 快照(用 ref 避免 re-render 抖动 + 闭包陷阱)。
  const selectionRef = useRef<{ text: string; from: number; to: number } | null>(null);
  const editorSessionRef = useRef<string | null>(null);
  const bufferRef = useRef<string>('');
  const runTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // 当前 AI diff 的 old_full 快照(拒绝时还原用)。
  const pendingDiffRef = useRef<{ oldFull: string; newFull: string } | null>(null);
  // 标记当前订阅是否活跃(防 late event 污染)。
  const runEpochRef = useRef(0);

  // 清理定时器。
  useEffect(() => {
    return () => {
      if (runTimerRef.current) clearTimeout(runTimerRef.current);
    };
  }, []);

  const fail = useCallback((msg: string) => {
    if (runTimerRef.current) {
      clearTimeout(runTimerRef.current);
      runTimerRef.current = null;
    }
    runEpochRef.current += 1; // 使任何 late event 失效
    setStatus('error');
    setMessage(msg);
    setAwaitingInstruction(false);
    bufferRef.current = '';
  }, []);

  // lazily 创建 editor 专用 appSession(复用,降低冷启动延迟)。
  const ensureSession = useCallback(async (): Promise<string | null> => {
    if (editorSessionRef.current) return editorSessionRef.current;
    if (!projectId || !projectPath) return null;
    try {
      const res = await authenticatedFetch('/api/providers/sessions', {
        method: 'POST',
        body: JSON.stringify({ provider, projectPath }),
      });
      if (!res.ok) return null;
      const body = (await res.json()) as { data?: { sessionId?: string } };
      const sid = body?.data?.sessionId ?? null;
      if (sid) editorSessionRef.current = sid;
      return sid;
    } catch {
      return null;
    }
  }, [projectId, projectPath, provider]);

  const onSelectionChange = useCallback(
    (selectedText: string, range: { from: number; to: number } | null) => {
      const trimmed = selectedText.trim();
      setHasSelection(trimmed.length > 0 && range !== null);
      if (range && trimmed.length > 0) {
        selectionRef.current = { text: selectedText, from: range.from, to: range.to };
      } else {
        selectionRef.current = null;
      }
    },
    [],
  );

  const trigger = useCallback(() => {
    if (!selectionRef.current) {
      setMessage(null);
      return;
    }
    setAwaitingInstruction(true);
    setMessage(null);
  }, []);

  const cancelInstruction = useCallback(() => {
    setAwaitingInstruction(false);
  }, []);

  const submitPrompt = useCallback(
    async (instruction: string) => {
      const sel = selectionRef.current;
      if (!sel) {
        setAwaitingInstruction(false);
        return;
      }
      setAwaitingInstruction(false);
      setStatus('running');
      setMessage(null);
      bufferRef.current = '';

      const sessionId = await ensureSession();
      if (!sessionId) {
        fail('无法创建 AI 改写会话,请检查 Provider 配置');
        return;
      }

      const prompt = buildPrompt(relativePath, sel.text, instruction);
      const epoch = runEpochRef.current;

      // 兜底超时。
      runTimerRef.current = setTimeout(() => {
        if (runEpochRef.current === epoch) {
          fail('AI 改写超时,请重试');
        }
      }, AI_EDIT_TIMEOUT_MS);

      // silent send —— REQ-030 通道,silent:true 使事件带标记 + 独立 slot 不阻塞。
      sendMessage({ type: 'chat.send', sessionId, content: prompt, options: { silent: true } });
    },
    [ensureSession, fail, relativePath, sendMessage],
  );

  const cancelRun = useCallback(() => {
    fail('已取消');
  }, [fail]);

  // 订阅 silent 事件流。过滤 silent:true + 当前 editorSession。
  useEffect(() => {
    const off = subscribe((event) => {
      const sid = editorSessionRef.current;
      // 只处理当前 editor session 的 silent 事件(防 chat / 其他 session 干扰)。
      if (!sid || event.sessionId !== sid) return;
      if (event.silent !== true) return;

      const kind = event.kind ?? event.type;

      if (kind === 'stream_delta') {
        const chunk = typeof event.content === 'string' ? event.content : '';
        if (chunk) bufferRef.current += chunk;
        return;
      }

      if (kind === 'complete' || kind === 'completed') {
        if (runTimerRef.current) {
          clearTimeout(runTimerRef.current);
          runTimerRef.current = null;
        }
        const success = event.success !== false;
        const epoch = runEpochRef.current;
        if (!success) {
          if (runEpochRef.current === epoch) fail('AI 改写失败');
          return;
        }
        const rewritten = bufferRef.current.trim();
        bufferRef.current = '';
        if (!rewritten) {
          if (runEpochRef.current === epoch) fail('AI 未返回改写内容');
          return;
        }
        // 构造 old_full/new_full:把选段替换进当前全文(纯函数,便于单测)。
        const sel = selectionRef.current;
        const full = getContent();
        if (!sel) {
          fail('选段已失效');
          return;
        }
        const { old_string, new_string } = buildReplacementDiff(full, { from: sel.from, to: sel.to }, rewritten);
        pendingDiffRef.current = { oldFull: old_string, newFull: new_string };
        onApplyDiff({ old_string, new_string, aiEdit: true });
        if (runEpochRef.current === epoch) {
          setStatus('success');
          setHasAiDiff(true);
          setMessage(null);
        }
        return;
      }

      if (kind === 'error') {
        const msg = typeof event.error === 'string' ? event.error : 'AI 改写出错';
        fail(msg);
      }
    });
    return off;
  }, [subscribe, getContent, onApplyDiff, fail]);

  const accept = useCallback(() => {
    // 接受:new_full 保留为编辑器内容(CodeEditor 已在 diffInfo 分支用 new_string,
    // 这里清 diffInfo 即可,内容自然就是 new_full)。
    pendingDiffRef.current = null;
    selectionRef.current = null;
    setHasAiDiff(false);
    setHasSelection(false);
    setStatus('idle');
    onClearDiff();
  }, [onClearDiff]);

  const reject = useCallback(() => {
    const snap = pendingDiffRef.current;
    pendingDiffRef.current = null;
    setHasAiDiff(false);
    setStatus('idle');
    if (snap) onRevertTo(snap.oldFull);
    onClearDiff();
  }, [onClearDiff, onRevertTo]);

  return {
    onSelectionChange,
    trigger,
    submitPrompt,
    cancelInstruction,
    cancelRun,
    accept,
    reject,
    status,
    hasSelection,
    hasAiDiff,
    awaitingInstruction,
    message,
  };
}

export function buildPrompt(relativePath: string, selectedText: string, instruction: string): string {
  const req = instruction.trim() || DEFAULT_INSTRUCTION;
  return [
    '你是一个 Markdown 编辑助手。改写下面【选段】的文本。',
    '',
    `文件:${relativePath}`,
    `改写要求:${req}`,
    '',
    '【选段开始】',
    selectedText,
    '【选段结束】',
    '',
    '只输出改写后的选段文本(纯 md,不要解释、不要代码围栏、不要前后缀),保持与上下文衔接。',
  ].join('\n');
}

/**
 * 构造 AI 选段改的 old_full/new_full diff。
 * 把 [选段前文, 选段] 中的"选段"替换为改后文本,生成 new_full;old_full = 选段前 + 选段 + 选段后。
 * CodeEditor 的 unifiedMergeView 用 old_full 作 original,自动高亮差异块。
 *
 * 抽成纯函数便于单测(选段边界/拼接正确性)。
 */
export function buildReplacementDiff(
  fullContent: string,
  selectionRange: { from: number; to: number },
  rewritten: string,
): { old_string: string; new_string: string } {
  const { from, to } = selectionRange;
  // 边界保护:from/to 越界或倒置时,退化为整文替换(防内容错乱)。
  const safeFrom = Math.max(0, Math.min(from, fullContent.length));
  const safeTo = Math.max(safeFrom, Math.min(to, fullContent.length));
  const old_string = fullContent;
  const new_string = fullContent.slice(0, safeFrom) + rewritten + fullContent.slice(safeTo);
  return { old_string, new_string };
}
