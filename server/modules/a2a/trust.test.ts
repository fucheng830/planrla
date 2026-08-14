import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { isPrivateLanIp } from './trust.js';

describe('isPrivateLanIp', () => {
  it('accepts RFC1918 private ranges', () => {
    assert.equal(isPrivateLanIp('192.168.0.9'), true);
    assert.equal(isPrivateLanIp('192.168.1.255'), true);
    assert.equal(isPrivateLanIp('10.0.0.1'), true);
    assert.equal(isPrivateLanIp('10.255.255.255'), true);
    assert.equal(isPrivateLanIp('172.16.0.1'), true);
    assert.equal(isPrivateLanIp('172.31.255.255'), true);
  });

  it('rejects public and out-of-range addresses', () => {
    assert.equal(isPrivateLanIp('8.8.8.8'), false);
    assert.equal(isPrivateLanIp('172.32.0.1'), false);
    assert.equal(isPrivateLanIp('172.15.0.1'), false);
    assert.equal(isPrivateLanIp('11.0.0.1'), false);
    assert.equal(isPrivateLanIp('fe80::1'), false);
  });

  it('unwraps IPv4-mapped IPv6 addresses', () => {
    assert.equal(isPrivateLanIp('::ffff:192.168.0.9'), true);
    assert.equal(isPrivateLanIp('::ffff:8.8.8.8'), false);
  });
});
