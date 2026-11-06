'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');

const LiveRelay = require('../../services/LiveRelay');
const { createIdentity, accountFromIdentity } = require('../../functions/identity');
const { signInToRelayPeer } = require('../../functions/fabricLoginClient');

const BASE = '/services/star-citizen';

let peerModule = null;
try {
  peerModule = require('@fabric/http/functions/passportPeer');
} catch (_) {}

function request (port, method, reqPath, { body, headers } = {}) {
  return new Promise((resolve, reject) => {
    const data = body != null ? (typeof body === 'string' ? body : JSON.stringify(body)) : null;
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
        resolve({ status: res.statusCode, body: json });
      });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

describe('LiveRelay Passport peer sessions', { skip: !peerModule && 'needs @fabric/http with passportPeer' }, () => {
  let svc;
  let dir;
  let port;
  let relayIdentity;
  let player;

  before(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sc-passport-peer-'));
    relayIdentity = createIdentity();
    player = createIdentity();
    svc = new LiveRelay({
      port: 0,
      listen: true,
      mode: 'server',
      settingsDir: dir,
      fabric: { enable: false, listen: false, port: 0, peers: [] },
      missions: { enable: false },
      discord: { enable: false }
    });
    await svc.start();
    svc._identity = relayIdentity;
    port = svc.server.address().port;
  });

  after(async () => {
    if (svc) await svc.stop();
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
  });

  it('names its own key for clients to check', async () => {
    const r = await request(port, 'GET', '/sessions/peer');
    assert.equal(r.status, 200);
    assert.equal(r.body.peer, accountFromIdentity(relayIdentity, { network: r.body.network }).identity.key.pubkey);
  });

  it('signs a player in by the relay key and takes each signed request as the player', async () => {
    const origin = `http://127.0.0.1:${port}`;
    const signed = await signInToRelayPeer(player, origin);
    assert.equal(signed.ok, true, signed.error);
    assert.equal(signed.view.identity.pubkey, player.pubkey);

    const note = JSON.stringify({ subject: 'discord:u1', handle: 'alice', body: 'mine' });
    const header = signed.session.authorize({ method: 'POST', target: `${BASE}/notes`, body: note });
    // Any page origin (or none): the signature, not the origin, says who this is.
    const write = await request(port, 'POST', `${BASE}/notes`, { body: note, headers: { 'X-Fabric-Request': header, Origin: 'https://anywhere.example' } });
    assert.equal(write.status, 200, JSON.stringify(write.body));

    const replay = await request(port, 'POST', `${BASE}/notes`, { body: note, headers: { 'X-Fabric-Request': header } });
    assert.equal(replay.status, 401, 'a request authorization works once');

    const read = await request(port, 'GET', `${BASE}/notes`, { headers: { 'X-Fabric-Request': signed.session.authorize({ method: 'GET', target: `${BASE}/notes` }) } });
    assert.equal(read.status, 200);
  });

  it('refuses a relay whose key changed since the client last saw it', async () => {
    const out = await signInToRelayPeer(player, `http://127.0.0.1:${port}`, { peer: createIdentity().pubkey });
    assert.equal(out.ok, false);
    assert.match(out.error, /another peer/);
  });
});
