'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { shouldEnforceRemoteAuth } = require('../../functions/httpRemoteAuth');

function req (addr) {
  return { socket: { remoteAddress: addr }, headers: {} };
}

describe('httpRemoteAuth', () => {
  it('always enforces hosted server mode', () => {
    assert.equal(shouldEnforceRemoteAuth({ mode: 'server', req: req('127.0.0.1') }), true);
    assert.equal(shouldEnforceRemoteAuth({
      mode: 'server',
      httpSharedMode: false,
      req: req('10.0.0.8')
    }), true);
  });

  it('leaves loopback desktop writes unlocked even when LAN bind is on', () => {
    assert.equal(shouldEnforceRemoteAuth({
      mode: 'relay',
      httpSharedMode: true,
      req: req('127.0.0.1')
    }), false);
    assert.equal(shouldEnforceRemoteAuth({
      mode: '',
      httpSharedMode: true,
      req: req('::1')
    }), false);
    assert.equal(shouldEnforceRemoteAuth({
      httpSharedMode: true,
      req: req('::ffff:127.0.0.1')
    }), false);
  });

  it('requires a session for non-loopback peers on shared bind', () => {
    assert.equal(shouldEnforceRemoteAuth({
      httpSharedMode: true,
      req: req('192.168.1.50')
    }), true);
    assert.equal(shouldEnforceRemoteAuth({
      httpSharedMode: true,
      req: req('10.8.0.2')
    }), true);
  });

  it('does not enforce when shared mode is off', () => {
    assert.equal(shouldEnforceRemoteAuth({
      httpSharedMode: false,
      req: req('192.168.1.50')
    }), false);
    assert.equal(shouldEnforceRemoteAuth({ req: req('8.8.8.8') }), false);
  });
});
