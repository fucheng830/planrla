// debug/spike-stop-hook-block.mjs
//
// Spike (REQ-043 方案 A 可行性): 验证 claude-agent-sdk 的 Stop hook 能否
// 通过返回 block 让 claude 续跑(= Claude Code `/goal` 的底层机制)。
//
// 三个 run 试不同返回形态,看哪种让 claude 跑到 maxTurns(block 生效):
//   A: 顶层 { decision:'block', reason }     ← Claude Code CLI hooks 官方 JSON 形态
//   B: hookSpecificOutput 包装               ← 对照 PreToolUse 的 hookSpecificOutput.permissionDecision
//   C: {} (baseline, 允许停)                 ← 基线, 应 1 轮停
//
// 判定: Stop hook fire 次数 >= 2 → block 生效(claude 被阻止停下, 续跑到 maxTurns)
//
// 用法: node debug/spike-stop-hook-block.mjs
// 成本: 3 个 run × 最多 3 轮, prompt 极小。

import { query } from '@anthropic-ai/claude-agent-sdk';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

// REQ-037 教训: 剖离 GLM 代理 env, 走真 Anthropic(否则多轮/工具塌方挂死)
delete process.env.ANTHROPIC_BASE_URL;
for (const k of Object.keys(process.env)) {
  if (k.endsWith('_MODEL_NAME')) delete process.env[k];
}

const cwd = resolve('.tmp/spike-stop-cwd');
mkdirSync(cwd, { recursive: true });

const PROMPT = 'Reply with exactly one word: OK. Then stop.';

async function run(label, stopReturn) {
  console.log(`\n=== ${label} ===`);
  let stopFireCount = 0;
  const hooks = {
    Stop: [{
      matcher: '',
      hooks: [async () => {
        stopFireCount++;
        console.log(`  [${label}] Stop fired #${stopFireCount}`);
        return stopReturn;
      }],
    }],
  };
  let numTurns = '?';
  let subtype = '?';
  try {
    const q = query({
      prompt: PROMPT,
      options: { cwd, permissionMode: 'bypassPermissions', maxTurns: 3, hooks },
    });
    for await (const msg of q) {
      if (msg.type === 'assistant') {
        const text = msg.message?.content?.filter(c => c.type === 'text').map(c => c.text).join('') ?? '';
        if (text) console.log(`  [${label}] assistant: ${text.slice(0, 60)}`);
      }
      if (msg.type === 'result') {
        numTurns = msg.num_turns;
        subtype = msg.subtype;
        console.log(`  [${label}] RESULT subtype=${msg.subtype} num_turns=${msg.num_turns}`);
      }
    }
  } catch (e) {
    console.log(`  [${label}] ERROR: ${e.message}`);
  }
  const verdict = stopFireCount >= 2 ? '✅ BLOCK 生效(claude 续跑)' : '❌ block 不生效(claude 停)';
  console.log(`  [${label}] verdict: Stop fired ${stopFireCount}x, subtype=${subtype}, num_turns=${numTurns} → ${verdict}`);
  return stopFireCount;
}

const a = await run('A {decision:block}', { decision: 'block', reason: 'Goal not done. Keep working toward it.' });
const b = await run('B hookSpecificOutput', { hookSpecificOutput: { hookEventName: 'Stop', decision: 'block', reason: 'Goal not done. Keep working toward it.' } });
const c = await run('C {} baseline', {});

console.log('\n=== 结论 ===');
if (a >= 2) console.log('方案 A 可行: Stop hook 顶层 {decision:"block"} 让 claude 续跑');
else if (b >= 2) console.log('方案 A 可行: Stop hook hookSpecificOutput.decision="block" 让 claude 续跑');
else console.log('⚠️ 方案 A 不可行: Stop hook 不支持 block → 降级方案 B(runner 自循环)');

process.exit(0);
