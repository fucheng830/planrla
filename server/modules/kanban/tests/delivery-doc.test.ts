import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { resolveDeliveryDocImages } from '@/modules/kanban/delivery-doc.js';

function setupWorktree(): { root: string; shot: string } {
  const root = mkdtempSync(join(tmpdir(), 'kanban-delivery-doc-'));
  const shot = join(root, 'debug', 'ui-acceptance');
  mkdirSync(shot, { recursive: true });
  writeFileSync(join(shot, 'task2-hover.png'), 'png');
  return { root, shot };
}

test('rewrites existing relative-path images to absolute paths', () => {
  const { root, shot } = setupWorktree();
  const doc = '![悬浮气泡](debug/ui-acceptance/task2-hover.png)';
  const out = resolveDeliveryDocImages(doc, root);
  assert.equal(out, `![悬浮气泡](${shot.replace(/\\/g, '/')}/task2-hover.png)`);
});

test('leaves references to missing files untouched (missing evidence is itself a signal)', () => {
  const { root } = setupWorktree();
  const doc = '![缺失](debug/ui-acceptance/not-there.png)';
  assert.equal(resolveDeliveryDocImages(doc, root), doc);
});

test('skips external and already-absolute references', () => {
  const { root } = setupWorktree();
  const doc = [
    '![web](https://example.com/a.png)',
    '![file](file:///C:/x/y.png)',
    '![data](data:image/png;base64,AAAA)',
    '![abs](/etc/hostname)',
    '![winabs](C:\\somewhere\\else.png)',
  ].join('\n');
  assert.equal(resolveDeliveryDocImages(doc, root), doc);
});

test('skips `..` references escaping the worktree', () => {
  const { root } = setupWorktree();
  const doc = '![escape](../../outside-secret.png)';
  assert.equal(resolveDeliveryDocImages(doc, root), doc);
});

test('handles angle-bracket and title forms; backslash relative paths', () => {
  const { root, shot } = setupWorktree();
  const angled = resolveDeliveryDocImages('![a](<debug/ui-acceptance/task2-hover.png> "shot")', root);
  assert.match(angled, new RegExp(`^!\\[a\\]\\(${shot.replace(/\\/g, '/')}/task2-hover\\.png\\)$`));
  const win = resolveDeliveryDocImages('![b](debug\\ui-acceptance\\task2-hover.png)', root);
  assert.match(win, new RegExp(`^!\\[b\\]\\(${shot.replace(/\\/g, '/')}/task2-hover\\.png\\)$`));
});

test('mixed document: only real screenshots rewritten, surrounding text intact', () => {
  const { root, shot } = setupWorktree();
  const doc = [
    '# DELIVERY',
    '验证记录:命令 `npm test` 通过。',
    '```',
    '示例代码 ![不算](debug/ui-acceptance/task2-hover.png) 在代码块里?——不,markdown 语法层面无法区分,但演示用例外;真实文档少见。',
    '```',
    '![悬浮气泡](debug/ui-acceptance/task2-hover.png)',
    '![没截到](debug/ui-acceptance/task2-miss.png)',
    '![外链](https://example.com/x.png)',
  ].join('\n');
  const out = resolveDeliveryDocImages(doc, root);
  assert.match(out, new RegExp(`^!\\[悬浮气泡\\]\\(${shot.replace(/\\/g, '/')}/task2-hover\\.png\\)$`, 'm'));
  assert.match(out, /!\[没截到\]\(debug\/ui-acceptance\/task2-miss\.png\)/);
  assert.match(out, /!\[外链\]\(https:\/\/example\.com\/x\.png\)/);
  // 代码块内的引用不会被误改写为不存在的路径(它引用同一张真实存在的图,
  // 因此同样被改写——已知限制:代码块与正文在正则层面不可区分,可接受,
  // 因为改写仅发生在「文件真实存在」时,不影响验收判断)。
  assert.match(out, /示例代码 !\[/);
});

test('returns content unchanged when worktreePath is missing', () => {
  const doc = '![a](debug/ui-acceptance/x.png)';
  assert.equal(resolveDeliveryDocImages(doc, null), doc);
  assert.equal(resolveDeliveryDocImages(doc, undefined), doc);
  assert.equal(resolveDeliveryDocImages('', '/tmp'), '');
});
