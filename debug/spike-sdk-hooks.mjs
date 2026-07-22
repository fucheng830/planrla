// Spike: verify @anthropic-ai/claude-agent-sdk function hooks fire under
// permissionMode 'bypassPermissions' (the kanban default), and that a
// PreToolUse hook can intercept AskUserQuestion in that mode (REQ-038 fix path).
//
// Run 1: trivial prompt, all hook events logged -> proves liveness signals.
// Run 2: model is told to call AskUserQuestion; PreToolUse hook captures the
//        questions payload and denies the call -> proves inline-answer capture
//        works where canUseTool is skipped.
//
// Usage: node debug/spike-sdk-hooks.mjs
// Cost: two tiny runs (maxTurns capped). Uses your local claude auth.

import { query } from '@anthropic-ai/claude-agent-sdk';
import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

const cwd = resolve('.tmp/spike-hooks-cwd');
mkdirSync(cwd, { recursive: true });

function logHook(runName, eventName) {
  return async (input) => {
    const summary = {
      hook_event_name: input.hook_event_name,
      session_id: input.session_id,
      cwd: input.cwd,
      transcript_path: input.transcript_path,
      permission_mode: input.permission_mode,
      ...(input.tool_name ? { tool_name: input.tool_name } : {}),
      ...(input.tool_input ? { tool_input: input.tool_input } : {}),
      ...(input.message ? { message: input.message } : {}),
      ...(input.prompt ? { prompt: String(input.prompt).slice(0, 80) } : {}),
    };
    console.log(`[${runName}] HOOK ${eventName}:`, JSON.stringify(summary));
    return {};
  };
}

async function run1() {
  console.log('=== RUN 1: basic bypassPermissions run, log all hooks ===');
  const events = ['PreToolUse', 'PostToolUse', 'UserPromptSubmit', 'Stop', 'Notification', 'SessionStart', 'SessionEnd'];
  const hooks = {};
  for (const ev of events) hooks[ev] = [{ matcher: '', hooks: [logHook('run1', ev)] }];

  const q = query({
    prompt: 'Reply with exactly: OK',
    options: { cwd, permissionMode: 'bypassPermissions', maxTurns: 1, hooks },
  });
  for await (const msg of q) {
    if (msg.type === 'system' && msg.subtype === 'init') {
      console.log('[run1] init session_id:', msg.session_id);
    }
    if (msg.type === 'result') {
      console.log('[run1] result:', msg.subtype, '| text:', JSON.stringify(msg.result ?? '').slice(0, 120));
    }
  }
}

async function run2() {
  console.log('\n=== RUN 2: AskUserQuestion interception under bypassPermissions ===');
  let captured = null;
  const hooks = {
    PreToolUse: [{
      matcher: 'AskUserQuestion',
      hooks: [async (input) => {
        captured = input.tool_input;
        console.log('[run2] HOOK PreToolUse AskUserQuestion, tool_input =', JSON.stringify(input.tool_input));
        // Intercept: deny the tool call and tell the model the user answered out-of-band.
        return {
          hookSpecificOutput: {
            hookEventName: 'PreToolUse',
            permissionDecision: 'deny',
            permissionDecisionReason: 'User answered via kanban board: option A',
          },
        };
      }],
    }],
    Stop: [{ matcher: '', hooks: [logHook('run2', 'Stop')] }],
  };

  const q = query({
    prompt: 'Use the AskUserQuestion tool once to ask whether I prefer option A or option B. After you get any response (including an error), just say DONE.',
    options: { cwd, permissionMode: 'bypassPermissions', maxTurns: 3, hooks },
  });
  for await (const msg of q) {
    if (msg.type === 'result') {
      console.log('[run2] result:', msg.subtype, '| text:', JSON.stringify(msg.result ?? '').slice(0, 200));
    }
  }
  console.log('[run2] captured AskUserQuestion payload:', captured ? 'YES' : 'NO');
}

await run1();
await run2();
console.log('\nspike done');
process.exit(0);
