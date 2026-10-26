'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');

const LiveRelay = require('../../services/LiveRelay');
const { createIdentity, accountFromIdentity } = require('../../functions/identity');
const { readChallenge, signAssertion } = require('@fabric/core/functions/passport');
const { relayPinnedOrigins } = require('../../functions/liveRelayPassport');
const { passportLogin } = require('../helpers/passportLogin');

const BASE = '/services/star-citizen';

function request (port, method, reqPath, { body, headers } = {}) {
  return new Promise((resolve, reject) => {
    const data = body != null ? JSON.stringify(body) : null;
    const h = Object.assign({ Accept: 'application/json' }, headers || {});
    if (data) {
      h['Content-Type'] = 'application/json';
      h['Content-Length'] = Buffer.byteLength(data);
    }
    const req = http.request({ host: '127.0.0.1', port, method, path: reqPath, headers: h }, (res) => {
      let buf = '';
      res.on('data', (c) => { buf += c; });
      res.on('end', () => {
        let json = null;
        try { json = buf ? JSON.parse(buf) : null; } catch (_) { json = buf; }
        resolve({ status: res.statusCode, body: json, cookies: res.headers['set-cookie'] || [] });
      });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

function cookieValue (cookies, name) {
  for (const line of cookies) {
    const [pair] = String(line).split(';');
    const i = pair.indexOf('=');
    if (pair.slice(0, i).trim() === name) return pair.slice(i + 1);
  }
  return null;
}

/** The browser flow Passport drives: challenge → assertion → session cookie. */
async function browserSignIn (port, identity, origin) {
  const issued = await request(port, 'POST', '/sessions/challenges', { body: {}, headers: { Origin: origin } });
  assert.equal(issued.status, 200, JSON.stringify(issued.body));
  const binding = cookieValue(issued.cookies, 'fabric.passport');
  assert.ok(binding, 'binding cookie set');
  const read = readChallenge(issued.body.challenge);
  assert.equal(read.ok, true, read.error);
  const account = accountFromIdentity(identity, { network: read.challenge.network });
  const { uri } = signAssertion({ challenge: issued.body.challenge, origin, signer: 'passport', network: read.challenge.network }, account.identity.key);
  const session = await request(port, 'POST', '/sessions', {
    body: { assertion: uri },
    headers: { Origin: origin, Cookie: `fabric.passport=${binding}` }
  });
  assert.equal(session.status, 200, JSON.stringify(session.body));
  assert.equal(session.body.token, undefined, 'browsers get a cookie, not a token');
  const token = cookieValue(session.cookies, 'fabric.session');
  assert.ok(token, 'session cookie set');
  return { token, session: session.body.session };
}

describe('LiveRelay Passport sign-in', () => {
  let svc;
  let dir;
  let port;
  let player;

  before(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sc-passport-'));
    player = createIdentity();
    svc = new LiveRelay({
      port: 0,
      listen: true,
      mode: 'server',
      settingsDir: dir,
      fabric: { enable: false, listen: false, port: 0, peers: [] },
      missions: { enable: false },
      discord: { enable: false },
      passport: { origins: ['https://relay.example'] }
    });
    await svc.start();
    port = svc.server.address().port;
  });

  after(async () => {
    if (svc) await svc.stop();
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
  });

  it('pins the loopback origins on its own port plus the configured ones', () => {
    const pinned = relayPinnedOrigins(svc, port);
    assert.ok(pinned.includes(`http://127.0.0.1:${port}`));
    assert.ok(pinned.includes(`http://localhost:${port}`));
    assert.ok(pinned.includes('https://relay.example'));
    assert.ok(!pinned.includes('http://127.0.0.1:1'));
  });

  it('refuses challenges for an origin it does not serve', async () => {
    const r = await request(port, 'POST', '/sessions/challenges', { body: {}, headers: { Origin: 'https://evil.example' } });
    assert.equal(r.status, 403);
  });

  it('has no v1 envelope login any more', async () => {
    const r = await request(port, 'POST', `${BASE}/auth`, { body: { pubkey: player.pubkey } });
    assert.notEqual(r.status, 200);
  });

  it('signs a browser in with a cookie that writes only from its own origin', async () => {
    const origin = `http://127.0.0.1:${port}`;
    const { token, session } = await browserSignIn(port, player, origin);
    assert.equal(session.identity.pubkey, player.pubkey);

    const current = await request(port, 'GET', '/sessions/current', { headers: { Cookie: `fabric.session=${token}` } });
    assert.equal(current.status, 200);
    assert.equal(current.body.session.identity.pubkey, player.pubkey);

    const note = { subject: 'discord:u1', handle: 'alice', body: 'mine' };
    const own = await request(port, 'POST', `${BASE}/notes`, {
      body: note,
      headers: { Cookie: `fabric.session=${token}`, Origin: origin }
    });
    assert.equal(own.status, 200, JSON.stringify(own.body));

    const sibling = await request(port, 'POST', `${BASE}/notes`, {
      body: note,
      headers: { Cookie: `fabric.session=${token}`, Origin: `http://localhost:${port}` }
    });
    assert.equal(sibling.status, 401, 'a same-site page on another origin cannot write with the cookie');

    const noOrigin = await request(port, 'POST', `${BASE}/notes`, {
      body: note,
      headers: { Cookie: `fabric.session=${token}` }
    });
    assert.equal(noOrigin.status, 401, 'a cookie write needs its Origin');

    const reads = await request(port, 'GET', `${BASE}/notes`, { headers: { Cookie: `fabric.session=${token}` } });
    assert.equal(reads.status, 200, 'reads take the cookie as is');

    const ended = await request(port, 'DELETE', '/sessions/current', { headers: { Cookie: `fabric.session=${token}`, Origin: origin } });
    assert.equal(ended.status, 200);
    const after = await request(port, 'GET', `${BASE}/notes`, { headers: { Cookie: `fabric.session=${token}` } });
    assert.equal(after.status, 401);
  });

  it('refuses an assertion redeemed from another origin than it was issued for', async () => {
    const origin = `http://127.0.0.1:${port}`;
    const issued = await request(port, 'POST', '/sessions/challenges', { body: {}, headers: { Origin: origin } });
    const binding = cookieValue(issued.cookies, 'fabric.passport');
    const read = readChallenge(issued.body.challenge);
    const account = accountFromIdentity(player, { network: read.challenge.network });
    const { uri } = signAssertion({ challenge: issued.body.challenge, origin, signer: 'passport', network: read.challenge.network }, account.identity.key);
    const r = await request(port, 'POST', '/sessions', {
      body: { assertion: uri },
      headers: { Origin: `http://localhost:${port}`, Cookie: `fabric.passport=${binding}` }
    });
    assert.equal(r.status, 403);
  });

  it('gives native clients a Bearer token through signInToRelay', async () => {
    const token = await passportLogin(port, player);
    assert.match(token, /^[0-9a-f]{64}$/);
    const notes = await request(port, 'GET', `${BASE}/notes`, { headers: { Authorization: `Bearer ${token}` } });
    assert.equal(notes.status, 200);
  });
});
