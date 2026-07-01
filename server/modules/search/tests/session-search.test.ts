import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { extractSessionText } from '../session-search-text.js';
import { escapeFtsQuery } from '../session-search-query.js';

test('extractSessionText 提取 user/assistant 消息文本', async () => {
  const tmp = path.join(process.env.TEMP ?? '/tmp', `sess-${Date.now()}.jsonl`);
  fs.writeFileSync(tmp, [
    JSON.stringify({ type: 'last-prompt', leafUuid: 'x', sessionId: 's1' }),  // meta 行跳过
    JSON.stringify({ type: 'user', message: { role: 'user', content: '讨论 React 性能优化' } }),
    JSON.stringify({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: '可以用 memo' }] } }),
    '',  // 空行跳过
    'not-json',  // 坏行跳过
  ].join('\n'));
  const text = await extractSessionText(tmp);
  assert.match(text, /user: 讨论 React 性能优化/);
  assert.match(text, /assistant: 可以用 memo/);
  fs.unlinkSync(tmp);
});

test('extractSessionText 文件不存在返回空字符串', async () => {
  const text = await extractSessionText('/nonexistent/path.jsonl');
  assert.equal(text, '');
});

test('escapeFtsQuery 包成 FTS5 短语查询并转义双引号', () => {
  assert.equal(escapeFtsQuery('性能优化'), '"性能优化"');
  assert.equal(escapeFtsQuery('含"引号"的查询'), '"含""引号""的查询"');
  assert.equal(escapeFtsQuery(''), '""');
});
