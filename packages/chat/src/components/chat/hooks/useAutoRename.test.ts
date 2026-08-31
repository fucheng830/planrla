import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createElement } from 'react';
import { renderToString } from 'react-dom/server';

import {
  evaluateAutoRename,
  isUntitledSummary,
  buildSilentRenameFrame,
  countAssistantTurns,
  useAutoRename,
  TITLE_THRESHOLD,
  type AutoRenameDecision,
  type SilentRenameSendFrame,
} from './useAutoRename';

const SID = 'sess-1';

/**
 * Build a merged-message array with `n` completed assistant text turns. Mirrors
 * the shape `useSessionStore.getMessages` returns: `{ kind, role }` is all the
 * pure evaluator reads. Streaming placeholders (`__streaming_*`) and
 * `stream_delta` kinds are intentionally NOT counted (spec §4.2 / plan 前置约定).
 */
function messagesWithAssistantTurns(n: number) {
  const msgs: Array<{ kind: string; role: string; id: string }> = [];
  for (let i = 0; i < n; i++) {
    msgs.push({ kind: 'text', role: 'assistant', id: `a${i}` });
  }
  return msgs;
}

function makeArgs(overrides: {
  sessionId?: string;
  summary?: string | null;
  messages?: Array<{ kind: string; role?: string }>;
  inFlight?: boolean;
}) {
  return {
    selectedSession: {
      id: overrides.sessionId ?? SID,
      summary: overrides.summary ?? '',
    },
    messages: overrides.messages ?? messagesWithAssistantTurns(TITLE_THRESHOLD),
    inFlight: overrides.inFlight ?? false,
  };
}

/* ------------------------------------------------------------------ */
/* isUntitledSummary guard                                            */
/* ------------------------------------------------------------------ */

test('isUntitledSummary: empty / null / undefined → true', () => {
  assert.equal(isUntitledSummary(''), true);
  assert.equal(isUntitledSummary(null), true);
  assert.equal(isUntitledSummary(undefined), true);
});

test('isUntitledSummary: bare "Untitled" + per-provider placeholders → true', () => {
  assert.equal(isUntitledSummary('Untitled'), true);
  // Each provider has its own placeholder (claude-session-synchronizer etc.).
  assert.equal(isUntitledSummary('Untitled Claude Session'), true);
  assert.equal(isUntitledSummary('Untitled Codex Session'), true);
  assert.equal(isUntitledSummary('Untitled Cursor Session'), true);
  assert.equal(isUntitledSummary('Untitled OpenCode Session'), true);
  // Gemini uses a different placeholder that does NOT start with "Untitled".
  assert.equal(isUntitledSummary('New Gemini Chat'), true);
  // Case-insensitive: provider casing drift should not break the guard.
  assert.equal(isUntitledSummary('untitled claude session'), true);
});

test('isUntitledSummary: real titles (incl. "untitled …" user-chosen) → false', () => {
  assert.equal(isUntitledSummary('调试 WS 推送'), false);
  assert.equal(isUntitledSummary('Fix login bug'), false);
  // Spec §4.1.2 calls for EQUALITY with placeholders — a user-chosen title
  // that merely starts with "untitled" must NOT be treated as untitled.
  assert.equal(isUntitledSummary('untitled thoughts draft'), false);
  assert.equal(isUntitledSummary('Untitled Notes On Testing'), false);
});

/* ------------------------------------------------------------------ */
/* isUntitledSummary length heuristic (核心修复)                      */
/*                                                                    */
/* Spec §1 痛点:provider 同步器在无标题时把「首条用户消息全文」写进    */
/* custom_name,导致 4462 条标题 = 长消息全文。占位符守卫漏了它们(不    */
/* 是 "Untitled"),长度启发式补这个洞:>40 字 = 未命名。              */
/* ------------------------------------------------------------------ */

test('isUntitledSummary: 首条消息全文(>40 字) → true(守卫盲点修复)', () => {
  // 模拟 provider 同步器塞进来的「首条消息全文」(spec §1 痛点的真实形态)。
  const firstMessageDump = '帮我看一下这个 WebSocket 推送为什么在客户端收不到,我已经确认服务端 emit 了但是前端订阅那边一直没有触发回调,日志里也看不到任何错误。';
  assert.ok(firstMessageDump.length > 40);
  assert.equal(isUntitledSummary(firstMessageDump), true);

  // 英文长摘要同样命中。
  assert.equal(
    isUntitledSummary('This is a very long first message that the provider synchronizer dumped verbatim into the session title field'),
    true,
  );
});

test('isUntitledSummary: 短真标题(≤40 字) → false(不误伤)', () => {
  // 真正的人工/AI 标题(spec §7 = 5-15 字)不会超过 40 字。
  assert.equal(isUntitledSummary('WS 推送排查'), false);
  assert.equal(isUntitledSummary('Fix login redirect bug'), false);
  // 边界:恰好 40 字仍是真标题(>40 才判 untitled)。
  const exactlyForty = '一二三四五六七八九十'.repeat(4); // 10 字 × 4 = 40 字
  assert.equal([...exactlyForty].length, 40);
  assert.equal(isUntitledSummary(exactlyForty), false);
});

test('evaluateAutoRename: 首条消息全文 summary → 仍触发 fire(覆盖 spec §1 盲点)', () => {
  // 这是本次迁移的核心修复验证:之前 placeholder-only 守卫漏掉的 case,
  // 现在长度启发式让它重新进入 fire 路径。
  const firstMessageDump = '帮我看一下这个 WebSocket 推送为什么在客户端收不到,我已经确认服务端 emit 了但是前端订阅那边一直没有触发回调。';
  const decision = evaluateAutoRename(makeArgs({ summary: firstMessageDump }));
  assert.equal(decision.shouldFire, true);
  assert.equal(decision.reason, 'fire');
});

test('evaluateAutoRename: 短真标题 → 不触发(长度启发式不误伤真标题)', () => {
  const decision = evaluateAutoRename(makeArgs({ summary: 'WS 推送排查' }));
  assert.equal(decision.shouldFire, false);
  assert.equal(decision.reason, 'already-titled');
});

/* ------------------------------------------------------------------ */
/* evaluateAutoRename — fire path                                     */
/* ------------------------------------------------------------------ */

test('evaluateAutoRename: 10 assistant turns + untitled + not in-flight → fire', () => {
  const decision: AutoRenameDecision = evaluateAutoRename(makeArgs({}));
  assert.equal(decision.shouldFire, true);
  assert.equal(decision.reason, 'fire');
});

test('evaluateAutoRename: exactly threshold (10) fires, not 10+', () => {
  // 10 turns = threshold; this is the spec trigger point.
  const at = evaluateAutoRename(makeArgs({ messages: messagesWithAssistantTurns(10) }));
  assert.equal(at.shouldFire, true);
});

/* ------------------------------------------------------------------ */
/* evaluateAutoRename — guard paths                                   */
/* ------------------------------------------------------------------ */

test('evaluateAutoRename: already titled → no fire', () => {
  const decision = evaluateAutoRename(makeArgs({ summary: '调试 WS 推送' }));
  assert.equal(decision.shouldFire, false);
  assert.equal(decision.reason, 'already-titled');
});

test('evaluateAutoRename: "Untitled Claude Session" placeholder → still fires (treated untitled)', () => {
  const decision = evaluateAutoRename(makeArgs({ summary: 'Untitled Claude Session' }));
  assert.equal(decision.shouldFire, true);
});

test('evaluateAutoRename: < 10 assistant turns → no fire', () => {
  const decision = evaluateAutoRename(makeArgs({ messages: messagesWithAssistantTurns(9) }));
  assert.equal(decision.shouldFire, false);
  assert.equal(decision.reason, 'below-threshold');
});

test('evaluateAutoRename: in-flight → no fire (re-entry guard)', () => {
  const decision = evaluateAutoRename(makeArgs({ inFlight: true }));
  assert.equal(decision.shouldFire, false);
  assert.equal(decision.reason, 'in-flight');
});

test('evaluateAutoRename: streaming placeholders + stream_delta do NOT count toward threshold', () => {
  // 9 real assistant turns + 1 stream_delta = still 9 (delta kind excluded).
  const msgs2 = [
    ...messagesWithAssistantTurns(9),
    { kind: 'stream_delta', role: 'assistant', id: '__streaming_sess-1' },
  ];
  const decision = evaluateAutoRename(makeArgs({ messages: msgs2 }));
  assert.equal(decision.shouldFire, false);
  assert.equal(decision.reason, 'below-threshold');
});

test('evaluateAutoRename: non-assistant messages do not count', () => {
  const msgs = [
    ...messagesWithAssistantTurns(9),
    { kind: 'text', role: 'user', id: 'u1' },
    { kind: 'tool_use', role: 'assistant', id: 't1' }, // kind != text, not counted
    { kind: 'tool_result', role: 'user', id: 'tr1' },
  ];
  const decision = evaluateAutoRename(makeArgs({ messages: msgs }));
  assert.equal(decision.shouldFire, false);
  assert.equal(decision.reason, 'below-threshold');
});

/* ------------------------------------------------------------------ */
/* countAssistantTurns + threshold boundary                           */
/* ------------------------------------------------------------------ */

test('countAssistantTurns: only counts kind=text role=assistant', () => {
  const msgs = [
    { kind: 'text', role: 'assistant', id: 'a1' },
    { kind: 'text', role: 'assistant', id: 'a2' },
    { kind: 'text', role: 'user', id: 'u1' },
    { kind: 'tool_use', role: 'assistant', id: 't1' },
    { kind: 'stream_delta', role: 'assistant', id: 's1' },
    { kind: 'thinking', role: 'assistant', id: 'th1' },
  ];
  assert.equal(countAssistantTurns(msgs as never), 2);
});

test('TITLE_THRESHOLD is 10', () => {
  assert.equal(TITLE_THRESHOLD, 10);
});

/* ------------------------------------------------------------------ */
/* buildSilentRenameFrame — exact send payload                        */
/* ------------------------------------------------------------------ */

test('buildSilentRenameFrame: emits chat.send with silent:true + hint content', () => {
  const frame = buildSilentRenameFrame(SID);
  assert.equal(frame.type, 'chat.send');
  assert.equal(frame.sessionId, SID);
  assert.deepEqual(frame.options, { silent: true });
  assert.match(frame.content, /重命名当前会话/);
  assert.match(frame.content, new RegExp(`id=${SID}`));
  assert.match(frame.content, /set_session_title/);
});

test('buildSilentRenameFrame: no-title form (no explicit title arg)', () => {
  // The bare form instructs the agent to GENERATE the title, which is what
  // auto-rename needs (spec §4.3.1). Confirm no double-quote title is embedded.
  const frame = buildSilentRenameFrame(SID);
  assert.ok(!frame.content.includes('"调试'));
  assert.match(frame.content, /生成一个简短/);
});

/* ------------------------------------------------------------------ */
/* Gemini placeholder also treated as untitled (fire path)            */
/* ------------------------------------------------------------------ */

test('evaluateAutoRename: "New Gemini Chat" placeholder → fires (Gemini not excluded)', () => {
  const decision = evaluateAutoRename(makeArgs({ summary: 'New Gemini Chat' }));
  assert.equal(decision.shouldFire, true);
});

test('evaluateAutoRename: no selectedSession → no fire', () => {
  const decision = evaluateAutoRename({
    selectedSession: null,
    messages: messagesWithAssistantTurns(TITLE_THRESHOLD),
    inFlight: false,
  });
  assert.equal(decision.shouldFire, false);
  assert.equal(decision.reason, 'no-session');
});

test('evaluateAutoRename: far below threshold (0 turns) → below-threshold', () => {
  const decision = evaluateAutoRename(makeArgs({ messages: [] }));
  assert.equal(decision.shouldFire, false);
  assert.equal(decision.reason, 'below-threshold');
});

/* ------------------------------------------------------------------ */
/* Hook-level integration (useAutoRename)                              */
/*                                                                    */
/* No `@testing-library/react` / jsdom in this repo, so we exercise    */
/* the hook via a one-shot render of a probe component whose body      */
/* runs the callbacks inline. The in-flight ref persists across those  */
/* synchronous invocations within a single render pass, which is       */
/* exactly the window we need to verify (fire → inFlight set → second  */
/* call blocked → silent completion resets → would-fire again).        */
/* ------------------------------------------------------------------ */

interface ProbeRun {
  /** Steps to run inside the probe's render, in order. Each `normal`/`silent` entry invokes the matching callback. */
  steps: Array<
    | { kind: 'normal'; sessionId?: string; success?: boolean }
    | { kind: 'silent'; sessionId?: string; success?: boolean }
  >;
  selectedSession: { id: string; summary?: string | null };
  messages: Array<{ kind: string; role?: string; id: string }>;
  sent: SilentRenameSendFrame[];
}

function runProbe(run: ProbeRun) {
  const sessionStore = {
    getMessages: () => run.messages,
  } as never;

  function Probe() {
    const sent: SilentRenameSendFrame[] = run.sent;
    const { onNormalRunCompleted, onSilentRunCompleted } = useAutoRename({
      selectedSession: run.selectedSession as never,
      sessionStore,
      sendMessage: (frame) => sent.push(frame),
    });
    // Exercise the callbacks inline so the ref mutation is observable
    // within this single render pass.
    for (const step of run.steps) {
      if (step.kind === 'normal') {
        onNormalRunCompleted(step.sessionId ?? run.selectedSession.id, step.success ?? true);
      } else {
        onSilentRunCompleted(step.sessionId ?? run.selectedSession.id, step.success ?? true);
      }
    }
    return null;
  }

  renderToString(createElement(Probe));
}

test('hook: 10 turns + untitled + success → sends exactly one silent frame', () => {
  const sent: SilentRenameSendFrame[] = [];
  runProbe({
    steps: [{ kind: 'normal' }],
    selectedSession: { id: SID, summary: '' },
    messages: messagesWithAssistantTurns(TITLE_THRESHOLD),
    sent,
  });
  assert.equal(sent.length, 1);
  assert.equal(sent[0].type, 'chat.send');
  assert.deepEqual(sent[0].options, { silent: true });
  assert.equal(sent[0].sessionId, SID);
});

test('hook: failed normal run → no fire (success gate)', () => {
  const sent: SilentRenameSendFrame[] = [];
  runProbe({
    steps: [{ kind: 'normal', success: false }],
    selectedSession: { id: SID, summary: '' },
    messages: messagesWithAssistantTurns(TITLE_THRESHOLD),
    sent,
  });
  assert.equal(sent.length, 0);
});

test('hook: already-titled → no fire', () => {
  const sent: SilentRenameSendFrame[] = [];
  runProbe({
    steps: [{ kind: 'normal' }],
    selectedSession: { id: SID, summary: '调试 WS 推送' },
    messages: messagesWithAssistantTurns(TITLE_THRESHOLD),
    sent,
  });
  assert.equal(sent.length, 0);
});

test('hook: < 10 turns → no fire', () => {
  const sent: SilentRenameSendFrame[] = [];
  runProbe({
    steps: [{ kind: 'normal' }],
    selectedSession: { id: SID, summary: '' },
    messages: messagesWithAssistantTurns(9),
    sent,
  });
  assert.equal(sent.length, 0);
});

test('hook: in-flight guard → no double fire on consecutive normal completions', () => {
  const sent: SilentRenameSendFrame[] = [];
  runProbe({
    // Two back-to-back successful completions of the SAME session without a
    // silent-run terminal event in between. The first arms in-flight; the
    // second must NOT fire a second silent frame.
    steps: [{ kind: 'normal' }, { kind: 'normal' }],
    selectedSession: { id: SID, summary: '' },
    messages: messagesWithAssistantTurns(TITLE_THRESHOLD),
    sent,
  });
  assert.equal(sent.length, 1);
});

test('hook: onSilentRunCompleted resets in-flight → next normal run can fire again', () => {
  const sent: SilentRenameSendFrame[] = [];
  runProbe({
    // fire → silent complete (resets guard) → fire again. Two fires expected.
    // (In production the second fire is also blocked by the already-titled
    // guard once the title lands, but this test isolates the in-flight reset
    // by keeping summary empty.)
    steps: [
      { kind: 'normal' },
      { kind: 'silent' },
      { kind: 'normal' },
    ],
    selectedSession: { id: SID, summary: '' },
    messages: messagesWithAssistantTurns(TITLE_THRESHOLD),
    sent,
  });
  assert.equal(sent.length, 2);
});

test('hook: sessionId mismatch → no fire', () => {
  const sent: SilentRenameSendFrame[] = [];
  runProbe({
    steps: [{ kind: 'normal', sessionId: 'other-session' }],
    selectedSession: { id: SID, summary: '' },
    messages: messagesWithAssistantTurns(TITLE_THRESHOLD),
    sent,
  });
  assert.equal(sent.length, 0);
});
