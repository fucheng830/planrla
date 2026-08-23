import { CodexSessionsProvider } from '../server/modules/providers/list/codex/codex-sessions.provider.js';

const provider = new CodexSessionsProvider() as any;

// 1) direct splitter sanity: marker text -> parts
const sample = [
  '需要先安装浏览器组件，正在为你安装：',
  '[external_agent_tool_call: mcp__plugin_playwright_playwright__browser_navigate]\ninput: {"url":"https://www.baidu.com"}\n[/external_agent_tool_call]',
  '[external_agent_tool_result: error]\n### Error\nError: boom\n[/external_agent_tool_result]',
  '[external_agent_tool_call: Bash]\ndescription: Install Playwright Chrome browser\ncommand: npx playwright install chrome\n[/external_agent_tool_call]',
  '[external_agent_tool_result]\nCommand did not complete within its 120s timeout\n[/external_agent_tool_result]',
].join('\n');

const norm = provider.normalizeHistoryEntry(
  { type: 'assistant', timestamp: '2026-08-16T15:55:36Z', message: { role: 'assistant', content: sample } },
  'sid-test',
);
console.log('parts:', norm.map((m: any) => `${m.kind}${m.toolName ? ':' + m.toolName : ''}${m.isError ? ':err' : ''}`).join(' | '));
const toolUse = norm.filter((m: any) => m.kind === 'tool_use');
const toolResult = norm.filter((m: any) => m.kind === 'tool_result');
console.log('tool_use count:', toolUse.length, 'tool_result count:', toolResult.length);
console.log('pairing:', toolResult.map((r: any) => r.toolId).join(','), 'vs', toolUse.map((u: any) => u.toolId).join(','));
console.log('bash input:', toolUse[1]?.toolInput);

// 2) real rollout file through fetchHistory
const real = await provider.fetchHistory('01a00b49-1f32-7681-8038-3cae05e05d08', {});
const kinds: Record<string, number> = {};
let rawMarker = 0;
for (const m of real.messages as any[]) {
  kinds[m.kind] = (kinds[m.kind] || 0) + 1;
  if (typeof m.content === 'string' && m.content.includes('[external_agent_tool_')) rawMarker++;
}
console.log('history kinds:', kinds);
console.log('messages still containing raw markers:', rawMarker);
