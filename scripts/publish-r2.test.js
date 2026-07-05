// REQ-011 publish-r2 unit tests. Uses Node's built-in test runner (no vitest dep):
//   node --test scripts/publish-r2.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { buildR2Objects } from './publish-r2.js';

function makeTempRelease(version) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'r2-test-'));
  const base = `${tmp}/planrla-${version}-x64`;
  fs.writeFileSync(`${tmp}/latest.yml`, '');
  fs.writeFileSync(`${base}.exe`, '');
  fs.writeFileSync(`${base}.exe.blockmap`, '');
  fs.writeFileSync(`${base}.zip`, '');
  return tmp;
}

test('buildR2Objects lists latest.yml + exe + blockmap + zip when all exist', () => {
  const version = '0.5.0';
  const tmp = makeTempRelease(version);
  try {
    const base = `${tmp}/planrla-${version}-x64`;
    const objs = buildR2Objects({ version, releaseDir: tmp });
    assert.deepEqual(objs, [
      { local: `${tmp}/latest.yml`, remote: 'desktop/latest.yml' },
      { local: `${base}.exe`, remote: `desktop/planrla-${version}-x64.exe` },
      { local: `${base}.exe.blockmap`, remote: `desktop/planrla-${version}-x64.exe.blockmap` },
      { local: `${base}.zip`, remote: `desktop/planrla-${version}-x64.zip` },
    ]);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('buildR2Objects returns empty array when no artifacts present', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'r2-test-'));
  try {
    const objs = buildR2Objects({ version: '0.5.0', releaseDir: tmp });
    assert.deepEqual(objs, []);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('buildR2Objects filters out missing intermediate files (e.g. no blockmap)', () => {
  const version = '0.5.0';
  const tmp = makeTempRelease(version);
  fs.rmSync(`${tmp}/planrla-${version}-x64.exe.blockmap`);
  try {
    const objs = buildR2Objects({ version, releaseDir: tmp });
    assert.equal(objs.length, 3);
    assert.ok(!objs.some((o) => o.remote.endsWith('.blockmap')));
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
