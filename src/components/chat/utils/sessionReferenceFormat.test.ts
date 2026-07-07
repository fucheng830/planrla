import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  formatReferenceBlock,
  parseQuotedReference,
  estimateTokens,
} from './sessionReferenceFormat';
import type { SessionReference } from './sessionReferenceFormat';

const fullRef: SessionReference = {
  id: 'r1',
  sessionId: 's-a',
  title: 'Codex 重构讨论',
  provider: 'codex',
  date: '2026-07-05',
  mode: 'full',
  messages: [
    { role: 'user', content: '怎么拆 auth?' },
    { role: 'assistant', content: '用 middleware' },
  ],
};

test('estimateTokens: 粗估 = chars/4', () => {
  assert.equal(estimateTokens(''), 0);
  assert.equal(estimateTokens('abcd'), 1);
  assert.equal(estimateTokens('abcdefgh'), 2);
});

test('formatReferenceBlock: full 模式拼出头 + role 行', () => {
  const out = formatReferenceBlock(fullRef);
  assert.ok(out.startsWith('[引自会话「Codex 重构讨论」(codex, 2026-07-05)]'));
  assert.ok(out.includes('[user] 怎么拆 auth?'));
  assert.ok(out.includes('[assistant] 用 middleware'));
});

test('formatReferenceBlock: single 模式只含选中一条', () => {
  const singleRef: SessionReference = { ...fullRef, mode: 'single', messages: [fullRef.messages[0]] };
  const out = formatReferenceBlock(singleRef);
  assert.ok(out.includes('[user] 怎么拆 auth?'));
  assert.ok(!out.includes('[assistant]'));
});

test('parseQuotedReference: 无引用 → text 全文, quote null', () => {
  const { quote, text } = parseQuotedReference('你好');
  assert.equal(quote, null);
  assert.equal(text, '你好');
});

test('parseQuotedReference: 有引用 → 拆出 quote 头 + text', () => {
  const block = formatReferenceBlock(fullRef);
  const content = `${block}\n\n---\n\n那这套怎么套?`;
  const { quote, text } = parseQuotedReference(content);
  assert.ok(quote);
  assert.equal(quote.title, 'Codex 重构讨论');
  assert.equal(text, '那这套怎么套?');
});
