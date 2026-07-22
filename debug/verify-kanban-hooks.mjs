// End-to-end verification of the kanban Claude hooks through the REAL
// production path: queryClaudeSDK (server/claude-sdk.js) with
// permissionMode 'bypassPermissions' + emitHookEvents (what the kanban
// runner passes). Asserts:
//   1. hook_event UserPromptSubmit arrives (REQ-037 liveness)
//   2. AskUserQuestion surfaces as permission_request even in bypass mode
//      (REQ-038 fix — previously auto-answered invisibly)
//   3. resolveToolApproval unblocks the run and the model continues with the
//      injected answer
//   4. hook_event Stop arrives
//
// Run: TSX_TSCONFIG_PATH=server/tsconfig.json node --import tsx debug/verify-kanban-hooks.mjs
// Cost: one tiny real Claude run.

import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { queryClaudeSDK, resolveToolApproval } from '../server/claude-sdk.js';

const cwd = resolve('.tmp/verify-hooks-cwd');
mkdirSync(cwd, { recursive: true });

const received = [];
const writer = {
  isWebSocketWriter: true,
  userId: null,
  send: (data) => {
    let msg = data;
    if (typeof data === 'string') {
      try { msg = JSON.parse(data); } catch { return; }
    }
    if (!msg || typeof msg !== 'object') return;
    received.push(msg);
    console.log(`[writer] ${msg.kind}${msg.hookEvent ? ':' + msg.hookEvent : ''}${msg.toolName ? ':' + msg.toolName : ''}`);
    // Simulate the kanban answer route: user picks "Option B" after 1s.
    if (msg.kind === 'permission_request' && msg.toolName === 'AskUserQuestion') {
      setTimeout(() => {
        console.log('[writer] answering permission_request with Option B');
        resolveToolApproval(msg.requestId, { allow: true, updatedInput: { answers: ['Option B'] } });
      }, 1000);
    }
  },
  setSessionId: () => {},
  updateWebSocket: () => {},
};

console.log('--- starting real queryClaudeSDK run (bypassPermissions + emitHookEvents) ---');
let failed = null;
try {
  await queryClaudeSDK(
    'Use the AskUserQuestion tool once to ask whether I prefer option A or option B. After you get any response (including an error), tell me in one short sentence which option I picked.',
    { cwd, permissionMode: 'bypassPermissions', emitHookEvents: true },
    writer,
  );
} catch (e) {
  failed = e;
  console.error('queryClaudeSDK threw:', e?.message ?? e);
}

const kinds = received.map((m) => (m.hookEvent ? `${m.kind}:${m.hookEvent}` : m.kind));
const checks = [
  ['hook_event UserPromptSubmit arrived', kinds.includes('hook_event:UserPromptSubmit')],
  ['permission_request AskUserQuestion arrived in bypass mode', received.some((m) => m.kind === 'permission_request' && m.toolName === 'AskUserQuestion')],
  ['hook_event Stop arrived', kinds.includes('hook_event:Stop')],
  ['run completed', received.some((m) => m.kind === 'complete')],
  ['model saw the injected answer (Option B)', received.some((m) => typeof m.content === 'string' && /option b/i.test(m.content))],
];

console.log('\n--- verification ---');
let allPass = !failed;
for (const [name, ok] of checks) {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`);
  if (!ok) allPass = false;
}
console.log(allPass ? '\nALL CHECKS PASSED' : '\nSOME CHECKS FAILED');
process.exit(allPass ? 0 : 1);
