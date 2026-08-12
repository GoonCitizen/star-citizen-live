'use strict';

/**
 * Fabric expectations: identity HTTP session helpers used by LiveRelay wrappers.
 * Does not boot LiveRelay — covers the portable @fabric/http session API.
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const Key = require('@fabric/core/types/key');
const Identity = require('@fabric/core/types/identity');
const siteLogin = require('@fabric/http/functions/fabricSiteLogin');
const {
  buildLoginMessage,
  buildFabricIdentitySignedPayload
} = require('@fabric/http/functions/fabricSiteLoginVerify');

function fakeReq (origin) {
  return {
    headers: {
      origin,
      referer: `${origin}/`
    },
    socket: { remoteAddress: '127.0.0.1' }
  };
}

describe('Fabric expectations: portable site-login session API', () => {
  it('create → complete client-signed session (no hub self-sign)', () => {
    const store = siteLogin.createSiteLoginStore();
    const origin = 'https://relay.goon.vc';
    const created = siteLogin.createSession(fakeReq(origin), { origin }, store);
    assert.equal(created.status, 200);
    assert.equal(created.json.ok, true);
    assert.equal(created.json.acceptsClientSignature, true);
    assert.deepEqual(created.json.signingModes, ['client']);
    assert.match(created.json.protocolUrl, /^fabric:\/\/login\?/);

    const key = new Key();
    const ident = new Identity(key);
    const message = created.json.message;
    const payload = buildFabricIdentitySignedPayload(ident, message);
    const done = siteLogin.completeSession(
      fakeReq(origin),
      created.json.sessionId,
      payload,
      store,
      { issueBearer: (pk) => `tok-${pk.slice(0, 8)}` }
    );
    assert.equal(done.status, 200);
    assert.equal(done.json.signer, 'client');
    assert.ok(done.json.delegationToken);

    const empty = siteLogin.completeSession(
      fakeReq(origin),
      created.json.sessionId,
      {},
      store
    );
    // Session already completed / removed after sign in http complete path — expect 404
    assert.ok(empty.status === 404 || empty.status === 400);
  });

  it('rejects unsigned completion body', () => {
    const store = siteLogin.createSiteLoginStore();
    const origin = 'http://127.0.0.1:3041';
    const created = siteLogin.createSession(fakeReq(origin), { origin }, store);
    const out = siteLogin.completeSession(fakeReq(origin), created.json.sessionId, {}, store);
    assert.equal(out.status, 400);
    assert.match(out.json.error, /client signature required/);
  });

  it('buildLoginMessage matches createSession challenge prefix', () => {
    const msg = buildLoginMessage('ab'.repeat(24), 'https://hub.fabric.pub', 'cd'.repeat(32));
    assert.ok(msg.startsWith('fabric:hub-login:1:'));
  });
});
