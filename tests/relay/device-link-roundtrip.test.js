'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const LiveRelay = require('../../services/LiveRelay');
const { createIdentity } = require('../../functions/identity');
const { completeDeviceLinkAsResponder } = require('../../functions/fabricDeviceLinkClient');
const { tryHandleDeviceLinkLocal } = require('../../functions/fabricDeviceLinkLocalHttp');
const { mergeLinkedDevice } = require('../../functions/linkedDevices');

function tmpDir (prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

async function startRelay (mode, dir) {
  const relay = new LiveRelay({
    port: 0,
    listen: true,
    mode,
    settingsDir: dir,
    logfile: path.join(dir, 'missing.log'),
    fabric: { enable: false, listen: false, port: 0, peers: [] },
    missions: { enable: false },
    discord: { enable: false }
  });
  await relay.start();
  const port = relay.server.address().port;
  return { relay, port, origin: `http://127.0.0.1:${port}`, dir };
}

async function jsonFetch (url, init = {}) {
  const res = await fetch(url, init);
  const j = await res.json().catch(() => ({}));
  return { status: res.status, ok: res.ok, j };
}

describe('device-link desktop ↔ Android round-trip', () => {
  let hub;
  let phone;
  let desktopIdent;
  let phoneIdent;

  before(async () => {
    hub = await startRelay('server', tmpDir('gc-dl-hub-'));
    phone = await startRelay('android', tmpDir('gc-dl-phone-'));
    desktopIdent = createIdentity();
    phoneIdent = createIdentity();
    phone.relay.setIdentity(phoneIdent);
  });

  after(async () => {
    if (phone && phone.relay) await phone.relay.stop();
    if (hub && hub.relay) await hub.relay.stop();
    for (const ctx of [phone, hub]) {
      if (ctx && ctx.dir) {
        try { fs.rmSync(ctx.dir, { recursive: true, force: true }); } catch (_) { /* ignore */ }
      }
    }
  });

  it('merges linked-device rows by peer Fabric id', () => {
    const first = mergeLinkedDevice([], {
      peerFabricId: 'id1aaa',
      peerPubkey: 'aa'.repeat(33),
      nonce: 'bb'.repeat(32),
      label: 'Desktop'
    });
    assert.equal(first.length, 1);
    const next = mergeLinkedDevice(first, {
      peerFabricId: 'id1aaa',
      label: 'Desktop (relinked)',
      nonce: 'cc'.repeat(32)
    });
    assert.equal(next.length, 1);
    assert.equal(next[0].label, 'Desktop (relinked)');
    assert.equal(next[0].nonce, 'cc'.repeat(32));
  });

  it('refuses the Android local API off-loopback and on a public relay', async () => {
    const sent = [];
    const send = (code, obj) => { sent.push({ code, obj }); };
    const remote = await tryHandleDeviceLinkLocal(phone.relay, {
      method: 'POST',
      url: '/services/star-citizen/device-links/offer',
      socket: { remoteAddress: '203.0.113.9' }
    }, {}, '/services/star-citizen/device-links/offer', async () => ({}), send);
    assert.equal(remote, true);
    assert.equal(sent[0].code, 403);

    sent.length = 0;
    const hosted = await tryHandleDeviceLinkLocal(hub.relay, {
      method: 'POST',
      url: '/services/star-citizen/device-links/offer',
      socket: { remoteAddress: '127.0.0.1' }
    }, {}, '/services/star-citizen/device-links/offer', async () => ({}), send);
    assert.equal(hosted, true);
    assert.equal(sent[0].code, 404);
  });

  it('links two identities through a shared LiveRelay hub', async () => {
    const { signCrossSign } = require('../../functions/identityCrossSignVerify');
    const offer = await jsonFetch(`${phone.origin}/services/star-citizen/device-links/offer`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ hubBase: hub.origin, label: 'GoonCitizen Android' })
    });
    assert.equal(offer.status, 200, offer.j && offer.j.error);
    assert.equal(offer.j.ok, true);
    assert.match(offer.j.protocolUrl, /^fabric:\/\/link\?/);
    assert.ok(offer.j.sessionId);
    assert.ok(offer.j.nonce);

    const pending = await jsonFetch(
      `${phone.origin}/services/star-citizen/device-links/pending?sessionId=${encodeURIComponent(offer.j.sessionId)}&hub=${encodeURIComponent(hub.origin)}`
    );
    assert.equal(pending.status, 200, pending.j && pending.j.error);
    assert.equal(pending.j.status, 'pending');
    assert.ok(pending.j.initiator && pending.j.initiator.pubkeyHex);

    const accepted = await completeDeviceLinkAsResponder(desktopIdent, hub.origin, {
      sessionId: offer.j.sessionId,
      status: 'pending',
      nonce: pending.j.nonce,
      label: pending.j.label,
      initiator: pending.j.initiator
    });
    assert.equal(accepted.ok, true, accepted.error);
    assert.equal(accepted.status, 'accepted');

    const tick = await jsonFetch(`${phone.origin}/services/star-citizen/device-links/tick`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({})
    });
    assert.equal(tick.status, 200, tick.j && tick.j.error);
    assert.equal(tick.j.status, 'linked');
    assert.ok(tick.j.peerPubkey);

    const desktopProof = signCrossSign(desktopIdent, {
      peerPubkey: phoneIdent.pubkey,
      nonce: offer.j.nonce
    });
    const posted = await jsonFetch(`${phone.origin}/identity/cross-sign`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(desktopProof)
    });
    assert.equal(posted.status, 200, posted.j && posted.j.error);

    assert.equal(
      phone.relay.identityCluster.clusterEquals(phoneIdent.pubkey, desktopIdent.pubkey),
      true
    );
    const snap = await jsonFetch(
      `${phone.origin}/identity/cluster?pubkey=${encodeURIComponent(phoneIdent.pubkey)}`
    );
    assert.equal(snap.status, 200);
    assert.ok(snap.j.data.members.length >= 2);
  });

  it('accepts a desktop-created fabric://link on the Android local API', async () => {
    const { startDeviceLinkOffer, tickDeviceLinkOffer } = require('../../functions/fabricDeviceLinkOffer');
    const { signCrossSign } = require('../../functions/identityCrossSignVerify');
    const offer = await startDeviceLinkOffer(desktopIdent, {
      hubBase: hub.origin,
      label: 'GoonCitizen desktop'
    });
    assert.equal(offer.ok, true, offer.error);
    const pending = await jsonFetch(
      `${phone.origin}/services/star-citizen/device-links/pending?sessionId=${encodeURIComponent(offer.sessionId)}&hub=${encodeURIComponent(hub.origin)}`
    );
    assert.equal(pending.status, 200, pending.j && pending.j.error);
    const accept = await jsonFetch(`${phone.origin}/services/star-citizen/device-links/accept`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        hubBase: hub.origin,
        sessionId: offer.sessionId,
        nonce: pending.j.nonce,
        label: pending.j.label,
        initiator: pending.j.initiator
      })
    });
    assert.equal(accept.status, 200, accept.j && accept.j.error);
    assert.equal(accept.j.ok, true);
    const tick = await tickDeviceLinkOffer(desktopIdent, offer);
    assert.equal(tick.ok, true, tick.error);
    assert.equal(tick.status, 'linked');
    const desktopProof = signCrossSign(desktopIdent, {
      peerPubkey: phoneIdent.pubkey,
      nonce: offer.nonce
    });
    const posted = await jsonFetch(`${phone.origin}/identity/cross-sign`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(desktopProof)
    });
    assert.equal(posted.status, 200, posted.j && posted.j.error);
    assert.equal(
      phone.relay.identityCluster.clusterEquals(phoneIdent.pubkey, desktopIdent.pubkey),
      true
    );
  });

  it('cancels a pending hub session so tick reports expired', async () => {
    const offer = await jsonFetch(`${phone.origin}/services/star-citizen/device-links/offer`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ hubBase: hub.origin, label: 'GoonCitizen Android' })
    });
    assert.equal(offer.status, 200, offer.j && offer.j.error);
    const dropped = await jsonFetch(
      `${hub.origin}/device-links/${encodeURIComponent(offer.j.sessionId)}`,
      { method: 'DELETE' }
    );
    assert.equal(dropped.status, 200, dropped.j && dropped.j.error);
    assert.equal(dropped.j.ok, true);
    const again = await jsonFetch(
      `${hub.origin}/device-links/${encodeURIComponent(offer.j.sessionId)}`,
      { method: 'DELETE' }
    );
    assert.equal(again.status, 200);
    assert.equal(again.j.existed, false);
    const tick = await jsonFetch(`${phone.origin}/services/star-citizen/device-links/tick`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({})
    });
    assert.equal(tick.status, 410, tick.j && tick.j.error);
    assert.equal(tick.j.expired, true);
    const cancel = await jsonFetch(`${phone.origin}/services/star-citizen/device-links/cancel`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({})
    });
    assert.equal(cancel.status, 200);
  });
});
