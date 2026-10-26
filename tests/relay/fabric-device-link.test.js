'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const Key = require('@fabric/core/types/key');
const Identity = require('@fabric/core/types/identity');
const { parseFabricDeviceLinkUrl } = require('../../functions/fabricDeviceLinkProtocol');
const {
  buildDeviceLinkMessage,
  cancelDeviceLinkSession,
  completeDeviceLinkAsResponder,
  fetchPendingDeviceLink,
  keyFingerprint,
  signingIdentity
} = require('../../functions/fabricDeviceLinkClient');
const {
  buildDeviceLinkOfferMessage,
  DEVICE_LINK_OFFER_TAG,
  DEVICE_LINK_TAG
} = require('@fabric/http/functions/fabricDeviceLinkClient');
const { buildFabricIdentitySignedPayload } = require('@fabric/core/functions/fabricIdentitySchnorr');

const HUB = 'https://relay.goon.vc';

/** A pending Hub session whose offer the initiator really signed. */
function pendingSession (initiatorIdentity, overrides = {}) {
  const me = signingIdentity(initiatorIdentity);
  const st = Object.assign({
    ok: true,
    status: 'pending',
    sessionId: crypto.randomBytes(24).toString('hex'),
    nonce: crypto.randomBytes(32).toString('hex'),
    label: 'Hub',
    origin: HUB
  }, overrides.session || {});
  const offer = buildDeviceLinkOfferMessage(st.sessionId, st.nonce, me.id, st.label, st.origin);
  const signed = buildFabricIdentitySignedPayload(me.key, offer, DEVICE_LINK_OFFER_TAG);
  st.initiator = { id: me.id, xpub: me.xpub, pubkeyHex: signed.pubkeyHex, offerSignature: signed.signature };
  return Object.assign(st, overrides.after || {});
}

function keyIdentity (key) {
  return { mnemonic: key.mnemonic, xprv: key.xprv, xpub: key.xpub, pubkey: key.pubkey, id: key.pubkey };
}

describe('fabricDeviceLinkProtocol', () => {
  it('parses fabric://link URLs', () => {
    const sid = crypto.randomBytes(24).toString('hex');
    const u = `fabric://link?sessionId=${sid}&hub=${encodeURIComponent('https://relay.goon.vc')}`;
    const p = parseFabricDeviceLinkUrl(u);
    assert.equal(p.ok, true);
    assert.equal(p.kind, 'link');
    assert.equal(p.sessionId, sid);
    assert.equal(p.hubBase, 'https://relay.goon.vc');
  });

  it('rejects non-link fabric hosts', () => {
    assert.equal(parseFabricDeviceLinkUrl('fabric://login?sessionId=aa&hub=https://x').ok, false);
    assert.equal(parseFabricDeviceLinkUrl('https://example.com').ok, false);
  });
});

describe('fabricDeviceLinkClient', () => {
  it('builds canonical v3 link messages bound to the session and origin', () => {
    const sessionId = 'cd'.repeat(24);
    const nonce = 'ab'.repeat(32);
    const a = new Identity(new Key()).id;
    const b = new Identity(new Key()).id;
    const msg = buildDeviceLinkMessage(sessionId, nonce, a, b, 'GoonCitizen', HUB);
    assert.equal(msg, `fabric:device-link:3:link:${sessionId}:${nonce}:${a}:${b}:GoonCitizen:${HUB}`);
    assert.throws(() => buildDeviceLinkMessage(nonce, a, b, 'GoonCitizen', HUB));
  });

  it('fetches a pending session only when the initiator signed its offer', async () => {
    const initiator = keyIdentity(new Key());
    const st = pendingSession(initiator);
    const fetchImpl = async () => ({ ok: true, status: 200, json: async () => st });
    const res = await fetchPendingDeviceLink(HUB, st.sessionId, { fetchImpl });
    assert.equal(res.ok, true, res.error);
    assert.equal(res.status, 'pending');
    assert.equal(res.origin, HUB);
    assert.equal(res.initiator.id, st.initiator.id);
    assert.equal(res.fingerprint, keyFingerprint(st.initiator.pubkeyHex));

    const relabeled = Object.assign({}, st, { label: 'Your bank' });
    const bad = await fetchPendingDeviceLink(HUB, st.sessionId, {
      fetchImpl: async () => ({ ok: true, status: 200, json: async () => relabeled })
    });
    assert.equal(bad.ok, false);

    const elsewhere = pendingSession(initiator, { session: { origin: 'https://hub.fabric.pub' } });
    const wrongHub = await fetchPendingDeviceLink(HUB, elsewhere.sessionId, {
      fetchImpl: async () => ({ ok: true, status: 200, json: async () => elsewhere })
    });
    assert.equal(wrongHub.ok, false);
  });

  it('signs as responder and POSTs the v3 link it rebuilt', async () => {
    const initiator = keyIdentity(new Key());
    const responder = new Key();
    const responderIdent = new Identity(responder);
    const st = pendingSession(initiator);
    let posted = null;
    const fetchImpl = async (url, init) => {
      if (init && init.method === 'POST') {
        posted = { url, init };
        return { ok: true, status: 200, json: async () => ({ ok: true, status: 'accepted', sessionId: st.sessionId }) };
      }
      return { ok: true, status: 200, json: async () => st };
    };
    const shown = await fetchPendingDeviceLink(HUB, st.sessionId, { fetchImpl });
    const res = await completeDeviceLinkAsResponder(keyIdentity(responder), HUB, {
      sessionId: st.sessionId,
      nonce: shown.nonce,
      label: shown.label,
      origin: shown.origin,
      initiator: shown.initiator
    }, { fetchImpl });
    assert.equal(res.ok, true, res.error);
    assert.equal(res.origin, HUB);
    assert.equal(res.peerFabricId, st.initiator.id);
    assert.equal(res.peerPubkeyHex, st.initiator.pubkeyHex);
    assert.ok(posted);
    assert.match(posted.url, /\/device-links\/.+\/signatures$/);
    const body = JSON.parse(posted.init.body);
    assert.equal(body.role, 'responder');
    assert.equal(body.identity.id, responderIdent.id);
    const expected = buildDeviceLinkMessage(st.sessionId, st.nonce, st.initiator.id, responderIdent.id, 'Hub', HUB);
    assert.ok(responderIdent.fabricKey.verifySchnorr(
      Buffer.from(expected, 'utf8'),
      Buffer.from(body.signature, 'hex'),
      DEVICE_LINK_TAG
    ));
    assert.equal(body.pubkeyHex, responderIdent.fabricKey.pubkey);
  });

  it('refuses to sign when the session changed after approval', async () => {
    const initiator = keyIdentity(new Key());
    const st = pendingSession(initiator);
    const approved = {
      sessionId: st.sessionId,
      nonce: st.nonce,
      label: st.label,
      origin: HUB,
      initiator: { id: st.initiator.id, pubkeyHex: st.initiator.pubkeyHex }
    };
    const swapped = pendingSession(keyIdentity(new Key()), { session: { sessionId: st.sessionId, nonce: st.nonce } });
    let posted = false;
    const fetchImpl = async (url, init) => {
      if (init && init.method === 'POST') posted = true;
      return { ok: true, status: 200, json: async () => swapped };
    };
    const res = await completeDeviceLinkAsResponder(keyIdentity(new Key()), HUB, approved, { fetchImpl });
    assert.equal(res.ok, false);
    assert.match(res.error, /changed/);
    assert.equal(posted, false);
  });

  it('refuses to link an identity to itself', async () => {
    const same = keyIdentity(new Key());
    const st = pendingSession(same);
    let posted = false;
    const fetchImpl = async (url, init) => {
      if (init && init.method === 'POST') posted = true;
      return { ok: true, status: 200, json: async () => st };
    };
    const res = await completeDeviceLinkAsResponder(same, HUB, {
      sessionId: st.sessionId,
      nonce: st.nonce,
      label: st.label,
      origin: HUB,
      initiator: { id: st.initiator.id, pubkeyHex: st.initiator.pubkeyHex }
    }, { fetchImpl });
    assert.equal(res.ok, false);
    assert.equal(posted, false);
  });

  it('treats HTTP 404 cancel as success', async () => {
    const out = await cancelDeviceLinkSession('https://relay.goon.vc', 'aa'.repeat(24), {
      fetchImpl: async () => ({
        ok: false,
        status: 404,
        json: async () => ({ ok: false, error: 'unknown or expired device link' })
      })
    });
    assert.equal(out.ok, true);
    assert.equal(out.cancelled, true);
  });

  it('returns ok: false when fetchImpl rejects', async () => {
    const out = await cancelDeviceLinkSession('https://relay.goon.vc', 'aa'.repeat(24), {
      fetchImpl: async () => {
        throw new Error('hub unreachable');
      }
    });
    assert.equal(out.ok, false);
    assert.equal(out.cancelled, false);
    assert.match(String(out.error), /hub unreachable/);
  });
});
