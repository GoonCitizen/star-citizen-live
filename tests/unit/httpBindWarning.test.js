'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { httpBindWarning } = require('../../functions/httpBindWarning');

describe('httpBindWarning', () => {
  it('is silent on loopback', () => {
    assert.equal(httpBindWarning({ host: '127.0.0.1' }), null);
    assert.equal(httpBindWarning({ host: '::1', httpSharedMode: true }), null);
    assert.equal(httpBindWarning({ host: 'localhost', mode: 'server' }), null);
  });

  it('warns when server mode binds the public NIC', () => {
    const msg = httpBindWarning({ host: '65.21.231.149', mode: 'server' });
    assert.match(msg, /SC_MODE=server/);
    assert.match(msg, /loopback behind Caddy/);
    assert.match(msg, /X-Forwarded-For/);
  });

  it('warns when shared bind lacks server mode', () => {
    const msg = httpBindWarning({ host: '0.0.0.0', httpSharedMode: true });
    assert.match(msg, /without SC_MODE=server/);
    assert.match(msg, /unlocked operator/);
  });
});
