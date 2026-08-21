'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  tryHandleDeviceLink,
  ensureMounted
} = require('../../functions/fabricDeviceLinkRelay');

function fakeRes () {
  return {
    headersSent: false,
    statusCode: 200,
    headers: {},
    body: '',
    json: null,
    setHeader (name, value) {
      this.headers[String(name).toLowerCase()] = value;
    },
    writeHead (code, headers) {
      this.statusCode = code;
      this.headersSent = true;
      if (headers && typeof headers === 'object') {
        for (const [k, v] of Object.entries(headers)) {
          this.headers[String(k).toLowerCase()] = v;
        }
      }
    },
    end (buf) {
      this.headersSent = true;
      this.body = buf == null ? '' : String(buf);
      try { this.json = JSON.parse(this.body); } catch (_) { this.json = null; }
    }
  };
}

function fakeReq (method, extra = {}) {
  return Object.assign({
    method,
    headers: extra.headers || {},
    socket: { remoteAddress: extra.remoteAddress || '127.0.0.1' }
  }, extra);
}

describe('fabricDeviceLinkRelay', () => {
  it('ignores paths outside /device-links', async () => {
    const res = fakeRes();
    const hit = await tryHandleDeviceLink({}, fakeReq('GET'), res, '/sessions', async () => ({}));
    assert.equal(hit, false);
    assert.equal(res.headersSent, false);
  });

  it('404s unmatched /device-links routes', async () => {
    const res = fakeRes();
    const hit = await tryHandleDeviceLink({}, fakeReq('GET'), res, '/device-links', async () => ({}));
    assert.equal(hit, true);
    assert.equal(res.statusCode, 404);
    assert.equal(res.json.ok, false);
    assert.equal(res.json.path, '/device-links');
  });

  it('mounts Hub routes once and POSTs create (origin required)', async () => {
    const relay = {};
    const first = ensureMounted(relay);
    const second = ensureMounted(relay);
    assert.equal(first, second);
    assert.ok(first.routes.some((r) => r.method === 'POST' && r.path === '/device-links'));

    const res = fakeRes();
    const hit = await tryHandleDeviceLink(relay, fakeReq('POST'), res, '/device-links', async () => ({}));
    assert.equal(hit, true);
    assert.equal(res.statusCode, 400);
    assert.equal(res.json.ok, false);
  });

  it('GET unknown session is 404; DELETE unknown is idempotent', async () => {
    const relay = {};
    const sid = 'ab'.repeat(24);
    const getRes = fakeRes();
    assert.equal(await tryHandleDeviceLink(relay, fakeReq('GET'), getRes, `/device-links/${sid}`, async () => ({})), true);
    assert.equal(getRes.statusCode, 404);

    const delRes = fakeRes();
    assert.equal(await tryHandleDeviceLink(relay, fakeReq('DELETE'), delRes, `/device-links/${sid}`, async () => ({})), true);
    assert.equal(delRes.statusCode, 200);
    assert.equal(delRes.json.ok, true);
    assert.equal(delRes.json.cancelled, true);
    assert.equal(delRes.json.existed, false);
  });

  it('POST with a non-object body still reaches the create handler', async () => {
    const relay = {};
    const res = fakeRes();
    const hit = await tryHandleDeviceLink(relay, fakeReq('POST'), res, '/device-links', async () => null);
    assert.equal(hit, true);
    assert.equal(res.statusCode, 400);
  });

  it('500s when a non-cancel route is missing from the mount table', async () => {
    const relay = {};
    const mounted = ensureMounted(relay);
    mounted.routes = [];
    const res = fakeRes();
    const hit = await tryHandleDeviceLink(relay, fakeReq('POST'), res, '/device-links', async () => ({}));
    assert.equal(hit, true);
    assert.equal(res.statusCode, 500);
    assert.match(res.json.error, /route missing/i);
  });

  it('cancel fallback: empty id, origin mismatch, already linked, success', async () => {
    const relay = {};
    const mounted = ensureMounted(relay);
    mounted.routes = mounted.routes.filter((r) => r.method !== 'DELETE');

    const empty = fakeRes();
    await tryHandleDeviceLink(relay, fakeReq('DELETE'), empty, '/device-links/%20', async () => ({}));
    assert.equal(empty.statusCode, 400);
    assert.match(empty.json.error, /sessionId required/i);

    const sid = 'cd'.repeat(24);
    relay._deviceLinkSessions.set(sid, {
      origin: 'https://hub.fabric.pub',
      status: 'pending'
    });
    const forbidden = fakeRes();
    await tryHandleDeviceLink(relay, fakeReq('DELETE', {
      remoteAddress: '8.8.8.8',
      headers: { origin: 'https://evil.example' }
    }), forbidden, `/device-links/${sid}`, async () => ({}));
    assert.equal(forbidden.statusCode, 403);
    assert.equal(relay._deviceLinkSessions.has(sid), true);

    relay._deviceLinkSessions.set(sid, {
      origin: 'https://hub.fabric.pub',
      status: 'linked'
    });
    const conflict = fakeRes();
    await tryHandleDeviceLink(relay, fakeReq('DELETE'), conflict, `/device-links/${sid}`, async () => ({}));
    assert.equal(conflict.statusCode, 409);

    relay._deviceLinkSessions.set(sid, {
      origin: 'https://hub.fabric.pub',
      status: 'pending'
    });
    const ok = fakeRes();
    await tryHandleDeviceLink(relay, fakeReq('DELETE'), ok, `/device-links/${sid}`, async () => ({}));
    assert.equal(ok.statusCode, 200);
    assert.equal(ok.json.existed, true);
    assert.equal(relay._deviceLinkSessions.has(sid), false);
  });
});
