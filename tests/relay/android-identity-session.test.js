'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const LiveRelay = require('../../services/LiveRelay');
const { createIdentity } = require('../../functions/identity');

function listen (relay) {
  return new Promise((resolve) => {
    relay.server = http.createServer((req, res) => relay._handle(req, res));
    relay.server.listen(0, '127.0.0.1', () => {
      const { port } = relay.server.address();
      resolve(`http://127.0.0.1:${port}`);
    });
  });
}

async function jsonFetch (url, init = {}) {
  const res = await fetch(url, init);
  const j = await res.json().catch(() => ({}));
  return { status: res.status, ok: res.ok, j };
}

describe('Android LiveRelay identity session', () => {
  let relay;
  let base;
  let ident;

  before(async () => {
    ident = createIdentity();
    relay = new LiveRelay({
      mode: 'android',
      listen: false,
      missions: { enable: false },
      fabric: { enable: false }
    });
    await relay.start();
    base = await listen(relay);
  });

  after(async () => {
    if (relay) await relay.stop();
  });

  it('skips Game.log on Android', () => {
    assert.equal(relay._skipGameLog(), true);
    assert.equal(relay._isAndroidMode(), true);
  });

  it('unlocks the local Fabric identity from loopback only', async () => {
    const r = await jsonFetch(`${base}/services/star-citizen/identity/session`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ xprv: ident.xprv })
    });
    assert.equal(r.status, 200);
    assert.equal(r.j.ok, true);
    assert.ok(r.j.pubkey);
    assert.equal(!!relay._identity, true);

    const locked = await jsonFetch(`${base}/services/star-citizen/identity/session`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ lock: true })
    });
    assert.equal(locked.status, 200);
    assert.equal(locked.j.locked, true);
    assert.equal(relay._identity, null);
  });

  it('sends CORS headers for the Capacitor dashboard origin', async () => {
    const res = await fetch(`${base}/services/star-citizen`, {
      headers: { Origin: 'https://localhost', Accept: 'application/json' }
    });
    assert.equal(res.headers.get('access-control-allow-origin'), 'https://localhost');
    const pre = await fetch(`${base}/services/star-citizen/groups`, {
      method: 'OPTIONS',
      headers: {
        Origin: 'https://localhost',
        'Access-Control-Request-Method': 'GET'
      }
    });
    assert.ok(pre.status === 204 || pre.status === 200);
    assert.equal(pre.headers.get('access-control-allow-origin'), 'https://localhost');
  });

  it('does not expose identity session on hosted server mode', async () => {
    const hosted = new LiveRelay({
      mode: 'server',
      listen: false,
      missions: { enable: false },
      fabric: { enable: false }
    });
    await hosted.start();
    const hostedBase = await listen(hosted);
    const r = await jsonFetch(`${hostedBase}/services/star-citizen/identity/session`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ xprv: ident.xprv })
    });
    assert.equal(r.status, 404);
    await hosted.stop();
  });
});
