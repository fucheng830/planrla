import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const prototypePath = new URL('./message-hub-prototype.html', import.meta.url);

async function readPrototype() {
  return readFile(prototypePath, 'utf8');
}

async function readBehavior() {
  return readFile(new URL('./message-hub-prototype.js', import.meta.url), 'utf8');
}

test('renders the collaboration hub landmarks', async () => {
  const html = await readPrototype();

  for (const landmark of ['channel-rail', 'inbox-panel', 'thread-panel', 'inspector-panel', 'workflow-strip']) {
    assert.match(html, new RegExp(`id=["']${landmark}["']`));
  }
});

test('exposes keyboard-friendly message and inspector controls', async () => {
  const html = await readPrototype();

  assert.match(html, /aria-label=["']Search messages["']/);
  assert.match(html, /id=["']message-composer["']/);
  assert.match(html, /type=["']submit["']/);
  assert.match(html, /role=["']tablist["']/);
});

test('wires session selection and message submission behavior', async () => {
  const [html, behavior] = await Promise.all([readPrototype(), readBehavior()]);

  assert.match(html, /data-session-id/);
  assert.match(behavior, /addEventListener\(['"]submit['"]/);
  assert.match(behavior, /classList\.toggle\(['"]is-active['"]/);
});
