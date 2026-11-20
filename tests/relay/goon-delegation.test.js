'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');

const Message = require('@fabric/core/types/message');
const client = require('@fabric/http/functions/fabricDelegationClient');
const GoonDelegation = require('../../services/GoonDelegation');
const IdentityCluster = require('../../functions/identityCluster');
const { createDelegationHost } = require('../../functions/delegationRendezvous');
const { Store } = require('../../types/Store');
const { createIdentity, protocolKeyFromIdentity, accountFromIdentity } = require('../../functions/identity');

function memoryKv () {
  const map = new Map();
  return {
    async get (k) { return map.has(k) ? map.get(k) : null; },
    async set (k, v) { map.set(k, v); }
  };
}

async function until (fn, what, ms = 20000) {
  const end = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

function participant (origin) {
  const identity = createIdentity({ network: 'regtest' });
  return new GoonDelegation({
    key: protocolKeyFromIdentity(identity),
    network: 'regtest',
    registerStore: new Store(),
    getAccount: ({ network, account }) => accountFromIdentity(identity, { network: network || 'regtest', account: account != null ? account : identity.account }),
    loopback: false,
    mailboxes: [origin]
  });
}

describe('GoonDelegation through a rendezvous and mailbox', () => {
  let server;
  let origin;
  let a;
  let b;

  before(async () => {
    let host = null;
    server = http.createServer(async (req, res) => {
      if (!(await host.handle(req, res))) {
        res.statusCode = 404;
        res.end('{}');
      }
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    origin = `http://127.0.0.1:${server.address().port}`;
    host = createDelegationHost({ origins: [origin], store: memoryKv() });
    assert.equal(host.available, true);
    a = participant(origin);
    b = participant(origin);
  });

  after(async () => {
    if (a) a.stop();
    if (b) b.stop();
    if (server) await new Promise((resolve) => server.close(resolve));
  });

  it('pairs only after both sides see the same code, then grants both ways', async () => {
    const shown = await a.invite(origin);
    assert.equal(shown.status, 'waiting');
    assert.match(shown.invitation, /^fabric:/);
    await assert.rejects(() => a.accept(shown.invitation), /came from this app/);
    await b.accept(shown.invitation);

    await until(() => a.pairing().status === 'confirm' && b.pairing().status === 'confirm', 'both sides to show a code');
    assert.match(a.pairing().sas, /^\d{6}$/);
    assert.equal(a.pairing().sas, b.pairing().sas);
    await assert.rejects(() => a.confirm([]), /choose at least one/);

    await a.confirm(['identity', 'message']);
    await b.confirm(['identity']);
    await until(() => a.pairing().status === 'done' && b.pairing().status === 'done', 'both grants');
    assert.equal(a.pairing().error, null);
    assert.equal(b.pairing().error, null);

    const view = await a.signers();
    assert.equal(view.signers.length, 1);
    const peer = view.signers[0];
    assert.equal(peer.pubkey, b.pubkey);
    assert.deepEqual(peer.given.map((g) => g.scopes), [['identity', 'message']]);
    assert.deepEqual(peer.received.map((g) => g.scopes), [['identity']]);
    assert.equal(peer.sameIdentity, true);

    const cluster = new IdentityCluster();
    for (const uri of (await a.identityFrames()).concat(await b.identityFrames())) cluster.ingest(uri);
    assert.equal(cluster.clusterEquals(a.pubkey, b.pubkey), true);
  });

  it('delivers a signing request through the mailbox and returns the signed result', async () => {
    const asked = [];
    a.on('request', (ev) => asked.push(ev));
    const req = await b.store.request({ target: a.pubkey, request: Message.fromVector(['P2P_CHAT_MESSAGE', 'sign me']) });
    const posted = await client.postMailbox(origin, req.uri, { to: a.pubkey });
    assert.equal(posted.ok, true, posted.error);

    assert.equal(await a.pollMailboxes(), 1);
    assert.equal(asked.length, 1);
    assert.equal(asked[0].notification.kind, 'DelegationRequest');
    const [pending] = await a.pending();
    assert.equal(pending.hash, req.hash);

    const out = await a.answer(req.hash, 'sign');
    assert.equal(out.status, 200);
    assert.equal((await a.pending()).length, 0);

    await b.pollMailboxes();
    const sent = await b.store.outboxItem(req.hash);
    assert.equal(sent.status, 'signed');
  });

  it('revokes: the other side reads the revocation from the mailbox and the link splits', async () => {
    const before = await a.signers();
    const given = before.signers[0].given.find((g) => !g.revoked);
    const out = await a.revoke(given.hash);
    assert.equal(out.revoked, given.hash);

    await b.pollMailboxes();
    const received = await b.store.grants('received', { revoked: true });
    assert.equal(received.find((g) => g.hash === given.hash).revoked, true);

    const cluster = new IdentityCluster();
    for (const uri of (await a.identityFrames()).concat(await b.identityFrames())) cluster.ingest(uri);
    assert.equal(cluster.clusterEquals(a.pubkey, b.pubkey), false);
  });

  it('refuses a rendezvous outside the allowlist', async () => {
    await assert.rejects(() => a.invite('https://evil.example'), /Hubs this app uses/);
  });
});
