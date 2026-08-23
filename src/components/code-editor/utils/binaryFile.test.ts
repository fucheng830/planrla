import assert from 'node:assert/strict';
import test from 'node:test';

import { isBinaryFile, isVideoFile } from './binaryFile';

test('recognizes media files as binary files', () => {
  assert.equal(isBinaryFile('clip.mp4'), true);
  assert.equal(isVideoFile('clip.mp4'), true);
  assert.equal(isVideoFile('clip.MOV'), true);
});

test('does not classify text files as video', () => {
  assert.equal(isBinaryFile('README.md'), false);
  assert.equal(isVideoFile('README.md'), false);
});
