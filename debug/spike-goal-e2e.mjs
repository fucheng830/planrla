// debug/spike-goal-e2e.mjs
//
// REQ-043 Task 6 Step 3: 端到端验证 goal-stop-hook 的 matcher + Stop block 链路。
//
// 唯一未由单元测试覆盖的风险:PostToolUse matcher `*task_complete` 能否命中
// 真 MCP 工具调用(Claude Code 里 MCP 工具名是 mcp__<server>__<tool>)。
//
// 本 spike 启动临时 http MCP server(模拟 planrla-kanban 的 task_complete)+
// claude query 注入 PostToolUse + Stop goalBlock(复刻 claude-hooks.ts 的 goal 逻辑):
//   Run A: prompt 教 agent 调 task_complete → 看 PostToolUse 是否 fire + tool_name 格式 + Stop 放行
//   Run B: prompt 不让调工具 → Stop block → claude 续跑(多次 Stop fire)
//
// 用法: node debug/spike-goal-e2e.mjs
// 成本: 2 个 claude query × 最多 4 turns,prompt 极小。

import { query } from '@anthropic-ai/claude-agent-sdk';
import { createServer } from 'node:http';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

// REQ-037 教训: 剖离 GLM 代理 env, 走真 Anthropic
delete process.env.ANTHROPIC_BASE_URL;
for (const k of Object.keys(process.env)) {
  if (k.endsWith('_MODEL_NAME')) delete process.env[k];
}

const cwd = resolve('.tmp/spike-goal-e2e');
mkdirSync(cwd, { recursive: true });

// 临时 http MCP server(模拟 planrla-kanban 的 task_complete 工具)
function startMcpServer() {
  let taskCompleteCalls = 0;
  const server = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      let msg = {};
      try { msg = JSON.parse(body || '{}'); } catch {}
      const id = msg.id ?? null;
      res.setHeader('content-type', 'application/json');
      if (msg.method === 'initialize') {
        res.end(JSON.stringify({ jsonrpc: '2.0', id, result: { protocolVersion: '2024-11-05', serverInfo: { name: 'spike-mcp', version: '0.1' }, capabilities: { tools: {} } } }));
      } else if (msg.method === 'tools/list') {
        res.end(JSON.stringify({ jsonrpc: '2.0', id, result: { tools: [{ name: 'task_complete', description: 'Declare goal complete', inputSchema: { type: 'object', properties: { summary: { type: 'string' } }, required: [] } }] } }));
      } else if (msg.method === 'tools/call' && msg.params?.name === 'task_complete') {
        taskCompleteCalls += 1;
        res.end(JSON.stringify({ jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: 'goal marked complete' }] } }));
      } else {
        res.end(JSON.stringify({ jsonrpc: '2.0', id, result: {} }));
      }
    });
  });
  return new Promise((resolveP) => {
    server.listen(0, '127.0.0.1', () => resolveP({ server, port: server.address().port, calls: () => taskCompleteCalls }));
  });
}

async function run(label, { teachTaskComplete }) {
  console.log(`\n=== ${label} ===`);
  const { server, port, calls } = await startMcpServer();
  const postToolEvents = [];
  const completed = { value: false };
  let stopFires = 0;

  const hooks = {
    PostToolUse: [{
      matcher: '',
      hooks: [async (input) => {
        postToolEvents.push(input?.tool_name);
        if (String(input?.tool_name || '').includes('task_complete')) completed.value = true;
        console.log(`  [${label}] PostToolUse FIRED, tool_name=${input?.tool_name}`);
        return {};
      }],
    }],
    Stop: [{
      matcher: '',
      hooks: [async () => {
        stopFires += 1;
        if (completed.value) { console.log(`  [${label}] Stop #${stopFires}: goal done → allow`); return {}; }
        console.log(`  [${label}] Stop #${stopFires}: goal NOT done → block`);
        return { decision: 'block', reason: 'Goal not done. 调 task_complete 声明完成。' };
      }],
    }],
  };

  const prompt = teachTaskComplete
    ? '调用 task_complete 工具声明任务完成(带 summary 参数 "done")。调用后即可停下。'
    : '只回复一个词 OK,不要调用任何工具。';

  try {
    const q = query({
      prompt,
      options: {
        cwd,
        permissionMode: 'bypassPermissions',
        maxTurns: 4,
        hooks,
        mcpServers: { 'planrla-kanban': { type: 'http', url: `http://127.0.0.1:${port}` } },
      },
    });
    for await (const msg of q) {
      if (msg.type === 'result') {
        console.log(`  [${label}] RESULT subtype=${msg.subtype} num_turns=${msg.num_turns}`);
      }
    }
  } catch (e) {
    console.log(`  [${label}] query ERROR: ${e.message}`);
  }

  console.log(`  [${label}] 汇总: PostToolUse fired ${postToolEvents.length}x ${postToolEvents.length ? '(' + postToolEvents.join(',') + ')' : ''}, Stop fired ${stopFires}x, MCP task_complete calls=${calls()}`);
  server.close();
  return { postToolEvents, stopFires, mcpCalls: calls() };
}

const a = await run('A: 教 agent 调 task_complete', { teachTaskComplete: true });
const b = await run('B: 不让调工具(应被 block 续跑)', { teachTaskComplete: false });

console.log('\n=== 结论 ===');
if (a.postToolEvents.length > 0) {
  console.log(`✅ PostToolUse matcher '*task_complete' 命中 MCP 工具(tool_name=${a.postToolEvents[0]})`);
  if (a.stopFires >= 1 && a.mcpCalls >= 1 && a.postToolEvents.length >= 1) {
    console.log('✅ 链路完整: agent 调 task_complete → PostToolUse 设 flag → Stop 放行');
  }
} else {
  console.log('⚠️ PostToolUse *task_complete 未命中 MCP 调用 → 改 claude-hooks.ts matcher 为 mcp__planrla-kanban__task_complete 全名');
}
console.log(b.stopFires >= 2
  ? `✅ 不调 task_complete → Stop block 续跑(Stop fired ${b.stopFires}x)`
  : `⚠️ Stop block 未续跑(只 ${b.stopFires}x)`);

process.exit(0);
