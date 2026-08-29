// debug/verify-compact-sdk.mjs
//
// REQ-052 R1 spike:验证 headless SDK query 以 '/compact' 作为 prompt 是否真实
// 触发 CLI 内置压缩(与 claude-sdk.js 的 per-turn query 调用方式一致)。
//
// 判定标准(spec §6 R1):
//   1. Run B(resume + prompt '/compact')流中出现 subtype==='compact_boundary'
//      的 system 消息,且 compact_metadata.pre_tokens > 0(有 pre_tokens 说明
//      CLI 真的执行了压缩,而非把 '/compact' 当普通文本发给模型)。
//   2. Run C(resume + 普通问句)仍可正常对话 —— 压缩后的会话活着。
//
// 用法: node debug/verify-compact-sdk.mjs
// 成本: 3 个 haiku query(1 次长文生成 + 1 次压缩 + 1 次短问句)。

import { query } from '@anthropic-ai/claude-agent-sdk';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

// REQ-037 教训: 剥离 GLM 代理 env, 走真 Anthropic
delete process.env.ANTHROPIC_BASE_URL;
for (const k of Object.keys(process.env)) {
  if (k.endsWith('_MODEL_NAME')) delete process.env[k];
}

const cwd = resolve('.tmp/spike-compact');
mkdirSync(cwd, { recursive: true });

async function run(label, prompt, resumeSessionId) {
  console.log(`\n=== ${label} ===`);
  const options = {
    cwd,
    model: 'claude-haiku-4-5-20251001',
    systemPrompt: { type: 'preset', preset: 'claude_code' },
    settingSources: ['project', 'user', 'local'],
    maxTurns: 5,
    permissionMode: 'bypassPermissions',
  };
  if (resumeSessionId) {
    options.resume = resumeSessionId;
  }

  const q = query({ prompt, options });
  let sessionId = null;
  let boundary = null;
  let statusSeen = [];
  let resultUsage = null;
  let assistantTexts = 0;
  let lastAssistantLen = 0;

  for await (const message of q) {
    if (message.session_id && !sessionId) sessionId = message.session_id;

    if (message.type === 'system') {
      if (message.subtype === 'compact_boundary') {
        boundary = message.compact_metadata;
        console.log('[EVENT] compact_boundary:', JSON.stringify(message.compact_metadata));
      } else if (message.subtype === 'status') {
        statusSeen.push(message.status);
        console.log('[EVENT] status:', message.status, message.compact_result ?? '');
      }
    }

    if (message.type === 'assistant') {
      assistantTexts += 1;
      const text = message.message?.content
        ?.filter((b) => b.type === 'text')
        .map((b) => b.text)
        .join('') || '';
      lastAssistantLen = text.length;
    }

    if (message.type === 'result') {
      resultUsage = message.usage || message.modelUsage || null;
      console.log('[EVENT] result subtype:', message.subtype, '| usage.input_tokens:', message.usage?.input_tokens, '| usage.output_tokens:', message.usage?.output_tokens);
    }
  }

  return { sessionId, boundary, statusSeen, resultUsage, assistantTexts, lastAssistantLen };
}

// Run A: 建会话并产生一段足够长的上下文(压缩前后 token 对比才有观感)
const a = await run('Run A: 建会话 + 长文生成',
  '请写一篇约 1200 字的科幻短文,主题是"深空探测器发现沉默文明"。直接开始正文,不要任何前置说明。');

if (!a.sessionId) {
  console.error('\n[FAIL] Run A 未捕获 session_id,无法继续');
  process.exit(1);
}
console.log(`[OK] Run A session: ${a.sessionId}, assistant blocks: ${a.assistantTexts}, last text len: ${a.lastAssistantLen}`);

// Run B: resume + '/compact' —— 本 spike 的核心验证
const b = await run('Run B: resume + /compact', '/compact', a.sessionId);
console.log(`[INFO] Run B boundary: ${JSON.stringify(b.boundary)}, statuses: [${b.statusSeen.join(',')}]`);

// Run C: 压缩后继续对话,确认会话可用
const c = await run('Run C: 压缩后继续对话', '用一句话回答:1+1等于几?', a.sessionId);

console.log('\n========== SPIKE VERDICT ==========');
const compactFired = Boolean(b.boundary && (b.boundary.pre_tokens ?? 0) > 0);
console.log('compact_boundary fired:', compactFired ? 'YES ✅' : 'NO ❌');
if (b.boundary) {
  console.log(`  trigger: ${b.boundary.trigger}, pre_tokens: ${b.boundary.pre_tokens}, post_tokens: ${b.boundary.post_tokens ?? 'n/a'}`);
}
console.log('post-compact conversation alive:', c.assistantTexts > 0 ? 'YES ✅' : 'NO ❌');
if (compactFired && c.assistantTexts > 0) {
  console.log('\nR1 SPIKE: PASS — headless SDK 下 /compact 真实触发 CLI 压缩,可按方案 A 实施。');
  process.exit(0);
} else {
  console.log('\nR1 SPIKE: FAIL — 需评估 fallback(streaming-input 单发式,见 spec §6 R1)。');
  process.exit(2);
}
