'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { shouldEnforceRemoteAuth, isRebindingHost } = require('../../functions/httpRemoteAuth');

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

  it('refuses a DNS name it does not answer to, and nothing else', () => {
    const at = (host) => ({ headers: host == null ? {} : { host } });
    for (const host of ['127.0.0.1:3041', 'localhost:3041', '[::1]:3041', '192.168.1.20:3041', 'relay.goon.vc', 'RELAY.goon.vc:443', null]) {
      assert.equal(isRebindingHost(at(host), { names: ['relay.goon.vc'] }), false, String(host));
    }
    for (const host of ['evil.example:3041', 'evil.example', '127.0.0.1.evil.example', 'localhost.evil.example:3041']) {
      assert.equal(isRebindingHost(at(host), { names: ['relay.goon.vc'] }), true, host);
    }
  });
});
