'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const crypto = require('crypto');
const Key = require('@fabric/core/types/key');
const Identity = require('@fabric/core/types/identity');
const LiveRelay = require('../../services/LiveRelay');
const { buildLoginMessage } = require('../../functions/fabricSiteLoginVerify');
const { completeClientSignedLogin } = require('../../functions/fabricLoginClient');

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

describe('LiveRelay Fabric site login (/sessions)', () => {
  let relay;
  let base;

  before(async () => {
    relay = new LiveRelay({
      mode: 'server',
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

  it('POST /sessions creates a client-signable challenge', async () => {
    const origin = base;
    const r = await jsonFetch(`${base}/sessions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        Origin: origin
      },
      body: JSON.stringify({ origin })
    });
    assert.equal(r.status, 200);
    assert.equal(r.j.ok, true);
    assert.equal(r.j.acceptsClientSignature, true);
    assert.match(r.j.sessionId, /^[a-f0-9]{48}$/);
    assert.match(r.j.protocolUrl, /^fabric:\/\/login\?/);
    assert.ok(r.j.message.startsWith('fabric:hub-login:1:'));
  });

  it('completes with Passport/desktop client signature and issues Bearer', async () => {
    const origin = base;
    const create = await jsonFetch(`${base}/sessions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        Origin: origin
      },
      body: JSON.stringify({ origin })
    });
    assert.equal(create.j.ok, true);
    const { sessionId, message } = create.j;

    const key = new Key();
    const ident = new Identity(key);
    const identity = {
      mnemonic: key.mnemonic,
      xprv: key.xprv,
      xpub: key.xpub,
      pubkey: key.pubkey,
      id: key.pubkey
    };

    const done = await completeClientSignedLogin(identity, base, sessionId, message);
    assert.equal(done.ok, true, done.error);
    assert.equal(done.signer, 'client');
    assert.equal(done.identity.id, ident.id);

    const poll = await jsonFetch(`${base}/sessions/${sessionId}`, {
      headers: { Accept: 'application/json', Origin: origin }
    });
    assert.equal(poll.status, 200);
    assert.equal(poll.j.status, 'signed');
    assert.ok(poll.j.delegationToken);
    assert.equal(poll.j.signer, 'client');

    // delegationToken is a LiveRelay Bearer for server-mode API auth.
    const auth = await jsonFetch(`${base}/services/star-citizen/chat/channels`, {
      headers: { Authorization: `Bearer ${poll.j.delegationToken}` }
    });
    assert.equal(auth.status, 200);
    assert.equal(auth.j.type, 'Collection');
  });

  it('rejects empty signature body (no Hub self-sign on LiveRelay)', async () => {
    const origin = base;
    const create = await jsonFetch(`${base}/sessions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        Origin: origin
      },
      body: JSON.stringify({ origin })
    });
    const sessionId = create.j.sessionId;
    const r = await jsonFetch(`${base}/sessions/${sessionId}/signatures`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        Origin: origin
      },
      body: JSON.stringify({})
    });
    assert.equal(r.status, 400);
    assert.match(r.j.error, /client signature required/i);
  });

  it('buildLoginMessage matches desktop client expectations', () => {
    const sid = crypto.randomBytes(24).toString('hex');
    const nonce = crypto.randomBytes(32).toString('hex');
    const msg = buildLoginMessage(sid, 'https://relay.goon.vc', nonce);
    assert.equal(msg, `fabric:hub-login:1:${nonce}:${sid}:https://relay.goon.vc`);
  });
});
