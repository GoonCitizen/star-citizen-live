'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const Key = require('@fabric/core/types/key');
const siteLogin = require('../../functions/fabricSiteLogin');
const { buildFabricIdentitySignedPayload } = require('@fabric/http/functions/fabricSiteLoginVerify');
const { keyFromIdentity } = require('../../functions/identity');

function fakeRes () {
  return {
    statusCode: 200,
    body: '',
    json: null,
    writeHead (code) { this.statusCode = code; },
    end (buf) {
      this.body = buf == null ? '' : String(buf);
      try { this.json = JSON.parse(this.body); } catch (_) { this.json = null; }
    }
  };
}

function req (method, headers = {}) {
  return {
    method,
    headers,
    socket: { remoteAddress: '127.0.0.1' }
  };
}

describe('fabricSiteLogin adapter', () => {
  it('re-exports http session helpers and uses an 8h Bearer TTL', () => {
    const pkg = require('@fabric/http/functions/fabricSiteLogin');
    assert.equal(siteLogin.SESSION_TTL_MS, pkg.SESSION_TTL_MS);
    assert.equal(siteLogin.createSession, pkg.createSession);
    assert.equal(siteLogin.buildLoginMessage, pkg.buildLoginMessage);
    assert.equal(siteLogin.BEARER_TTL_MS, 8 * 60 * 60 * 1000);
  });

  it('ignores non-session paths', async () => {
    const res = fakeRes();
    const hit = await siteLogin.tryHandleSiteLogin({}, req('GET'), res, '/device-links', async () => ({}));
    assert.equal(hit, false);
  });

  it('GET /sessions is spa unless Accept is JSON-only', async () => {
    const relay = {};
    const spa = fakeRes();
    assert.equal(await siteLogin.tryHandleSiteLogin(relay, req('GET'), spa, '/sessions', async () => ({})), 'spa');
    assert.equal(spa.json, null);

    const both = fakeRes();
    assert.equal(await siteLogin.tryHandleSiteLogin(relay, req('GET', {
      accept: 'application/json, text/html'
    }), both, '/sessions', async () => ({})), 'spa');

    const json = fakeRes();
    assert.equal(await siteLogin.tryHandleSiteLogin(relay, req('GET', {
      accept: 'application/json'
    }), json, '/sessions', async () => ({})), true);
    assert.equal(json.statusCode, 404);
    assert.match(json.json.error, /use POST \/sessions/);
  });

  it('POST /sessions creates a challenge; GET polls it', async () => {
    const relay = {};
    const origin = 'http://127.0.0.1:3041';
    const created = fakeRes();
    const hit = await siteLogin.tryHandleSiteLogin(relay, req('POST', {
      origin,
      accept: 'application/json'
    }), created, '/sessions', async () => ({ origin }));
    assert.equal(hit, true);
    assert.equal(created.statusCode, 200);
    assert.equal(created.json.ok, true);
    assert.match(created.json.sessionId, /^[a-f0-9]{48}$/);
    if (created.json.pollSecret) {
      assert.match(created.json.pollSecret, /^[a-f0-9]{64}$/);
      assert.ok(!String(created.json.protocolUrl).includes(created.json.pollSecret));
    }
    assert.ok(relay._siteLoginSessions instanceof Map);

    const polled = fakeRes();
    await siteLogin.tryHandleSiteLogin(relay, req('GET', {
      origin,
      accept: 'application/json'
    }), polled, `/sessions/${created.json.sessionId}`, async () => ({}));
    assert.equal(polled.statusCode, 200);
    assert.equal(polled.json.status, 'pending');
  });

  it('POST /sessions without origin is 400', async () => {
    const res = fakeRes();
    await siteLogin.tryHandleSiteLogin({}, req('POST'), res, '/sessions', async () => ({}));
    assert.equal(res.statusCode, 400);
    assert.match(res.json.error, /origin required/i);
  });

  it('unknown nested session path is 404', async () => {
    const res = fakeRes();
    const hit = await siteLogin.tryHandleSiteLogin({}, req('PUT'), res, '/sessions/abc', async () => ({}));
    assert.equal(hit, true);
    assert.equal(res.statusCode, 404);
    assert.equal(res.json.path, '/sessions/abc');
  });

  it('rejects empty signature; client complete issues an 8h Bearer', async () => {
    const relay = {};
    const origin = 'http://127.0.0.1:3041';
    const created = fakeRes();
    await siteLogin.tryHandleSiteLogin(relay, req('POST', { origin }), created, '/sessions', async () => ({ origin }));
    const sessionId = created.json.sessionId;
    const message = created.json.message;

    const empty = fakeRes();
    await siteLogin.tryHandleSiteLogin(relay, req('POST', { origin }), empty,
      `/sessions/${sessionId}/signatures`, async () => ({}));
    assert.equal(empty.statusCode, 400);
    assert.match(empty.json.error, /client signature required/i);

    const key = new Key();
    const identity = {
      mnemonic: key.mnemonic,
      xprv: key.xprv,
      xpub: key.xpub,
      pubkey: key.pubkey,
      id: key.pubkey
    };
    const payload = buildFabricIdentitySignedPayload(keyFromIdentity(identity), message);
    const signed = fakeRes();
    const before = Date.now();
    await siteLogin.tryHandleSiteLogin(relay, req('POST', { origin }), signed,
      `/sessions/${sessionId}/signatures`, async () => payload);
    assert.equal(signed.statusCode, 200, signed.body);
    assert.equal(signed.json.ok, true);
    assert.ok(signed.json.delegationToken);
    const row = relay._sessions[signed.json.delegationToken];
    assert.ok(row);
    assert.equal(row.via, 'fabric-site-login');
    const ttl = row.expiresAt - row.createdAt;
    assert.ok(ttl >= siteLogin.BEARER_TTL_MS - 50);
    assert.ok(ttl <= siteLogin.BEARER_TTL_MS + 50);
    assert.ok(row.createdAt >= before);
  });
});
