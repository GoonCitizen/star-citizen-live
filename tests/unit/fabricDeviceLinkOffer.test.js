'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const { createIdentity, keyFromIdentity } = require('../../functions/identity');
const {
  httpsLandingUrl,
  parseDeviceLinkLanding,
  notifyPassportDeviceLink,
  offerPassportDeviceLink,
  startDeviceLinkOffer,
  tickDeviceLinkOffer,
  confirmDeviceLinkOffer,
  DEFAULT_DEVICE_LINK_HUB
} = require('../../functions/fabricDeviceLinkOffer');
const {
  buildDeviceLinkOfferMessage,
  buildDeviceLinkMessage,
  DEVICE_LINK_OFFER_TAG,
  DEVICE_LINK_TAG
} = require('@fabric/http/functions/fabricDeviceLinkClient');
const { buildFabricIdentitySignedPayload } = require('@fabric/core/functions/fabricIdentitySchnorr');
const { signingIdentity, keyFingerprint } = require('../../functions/fabricDeviceLinkClient');

/**
 * An initiator offer and the Hub session a responder accepted, signed for real.
 * @returns {{ offer: object, accepted: object, me: object, peer: object }}
 */
function acceptedSession (opts = {}) {
  const ident = opts.ident || createIdentity();
  const me = signingIdentity(ident);
  const peer = signingIdentity(opts.peerIdent || createIdentity());
  const sessionId = crypto.randomBytes(24).toString('hex');
  const nonce = crypto.randomBytes(32).toString('hex');
  const origin = DEFAULT_DEVICE_LINK_HUB;
  const label = 'GoonCitizen';
  const linkMessage = buildDeviceLinkMessage(opts.signedSessionId || sessionId, nonce, me.id, peer.id, label, origin);
  const signed = buildFabricIdentitySignedPayload(peer.key, linkMessage, DEVICE_LINK_TAG);
  const accepted = {
    ok: true,
    status: 'accepted',
    sessionId,
    nonce,
    label,
    origin,
    initiator: { id: me.id, xpub: me.xpub, pubkeyHex: me.pubkeyHex },
    responder: { id: peer.id, xpub: peer.xpub, pubkeyHex: signed.pubkeyHex, signature: signed.signature }
  };
  const offer = { sessionId, hubBase: origin, origin, nonce, label, createdAt: Date.now() };
  return { ident, offer, accepted, me, peer };
}

function hubFetch (state, calls = []) {
  return async (url, init) => {
    calls.push({ url, method: init && init.method, body: init && init.body && JSON.parse(init.body) });
    if (init && init.method === 'POST') {
      return { ok: true, status: 200, json: async () => ({ ok: true, status: 'linked', sessionId: state.sessionId }) };
    }
    return { ok: true, status: 200, json: async () => state };
  };
}

describe('fabricDeviceLinkOffer landing', () => {
  it('builds an HTTPS Passport landing URL on the rendezvous hub', () => {
    const sid = 'ab'.repeat(24);
    assert.equal(
      httpsLandingUrl('https://relay.goon.vc', sid),
      `https://relay.goon.vc/#device-link=${sid}`
    );
  });

  it('parses #device-link= from the hosted dashboard', () => {
    const sid = 'cd'.repeat(24);
    const hit = parseDeviceLinkLanding({
      hash: `#device-link=${sid}`,
      search: '',
      origin: 'https://relay.goon.vc'
    });
    assert.ok(hit);
    assert.equal(hit.sessionId, sid);
    assert.equal(hit.hubBase, 'https://relay.goon.vc');
  });

  it('postMessages FABRIC_DEVICE_LINK_REQUEST for Passport', () => {
    const posted = [];
    const win = {
      location: { origin: 'https://relay.goon.vc' },
      postMessage (data, origin) { posted.push({ data, origin }); }
    };
    assert.equal(notifyPassportDeviceLink({
      sessionId: 'aa'.repeat(24),
      hubBase: 'https://relay.goon.vc'
    }, win), true);
    assert.equal(posted.length, 1);
    assert.equal(posted[0].data.source, 'fabric-site');
    assert.equal(posted[0].data.type, 'FABRIC_DEVICE_LINK_REQUEST');
    assert.equal(posted[0].origin, 'https://relay.goon.vc');
  });

  it('offerPassportDeviceLink notifies Passport then strips the hash', () => {
    const posted = [];
    const sid = '11'.repeat(24);
    const win = {
      location: {
        origin: 'https://relay.goon.vc',
        hash: `#device-link=${sid}`,
        pathname: '/',
        search: ''
      },
      history: { replaceState (_s, _t, url) { win.location.hash = ''; win._url = url; } },
      postMessage (data, origin) { posted.push({ data, origin }); }
    };
    assert.equal(offerPassportDeviceLink(win.location, win), true);
    assert.equal(posted[0].data.sessionId, sid);
    assert.equal(win._url, '/');
  });
});

describe('fabricDeviceLinkOffer initiator', () => {
  it('prepares a session, then POSTs the session-bound offer it signed', async () => {
    const ident = createIdentity();
    const sessionId = 'ee'.repeat(24);
    const nonce = 'ff'.repeat(32);
    const posts = [];
    const fetchImpl = async (url, init) => {
      const body = JSON.parse(init.body);
      posts.push({ url, body });
      return {
        ok: true,
        status: 200,
        json: async () => (body.signature
          ? { ok: true, status: 'pending', sessionId, nonce, protocolUrl: 'fabric://link?sessionId=ee&hub=https%3A%2F%2Frelay.goon.vc' }
          : { ok: true, status: 'awaiting_offer', sessionId, nonce, pollSecret: 'aa'.repeat(32) })
      };
    };
    const res = await startDeviceLinkOffer(ident, { fetchImpl, label: 'GoonCitizen Android' });
    assert.equal(res.ok, true, res.error);
    assert.equal(res.hubBase, DEFAULT_DEVICE_LINK_HUB);
    assert.equal(res.sessionId, sessionId);
    assert.equal(res.nonce, nonce);
    assert.ok(res.httpsUrl.includes('#device-link='));
    assert.equal(posts.length, 2);
    assert.equal(posts[0].body.signature, undefined);
    assert.equal(posts[0].body.nonce, undefined);
    const body = posts[1].body;
    assert.match(posts[1].url, /\/device-links$/);
    assert.equal(body.sessionId, sessionId);
    assert.equal(body.origin, DEFAULT_DEVICE_LINK_HUB);
    assert.equal(body.label, 'GoonCitizen Android');
    assert.match(body.signature, /^[a-f0-9]{128}$/i);
    const offerMessage = buildDeviceLinkOfferMessage(sessionId, nonce, body.identity.id, body.label, body.origin);
    assert.ok(keyFromIdentity(ident).verifySchnorr(
      Buffer.from(offerMessage, 'utf8'),
      Buffer.from(body.signature, 'hex'),
      DEVICE_LINK_OFFER_TAG
    ));
  });

  it('refuses to sign a hub offer it did not build', async () => {
    const ident = createIdentity();
    let signedPosts = 0;
    const fetchImpl = async (url, init) => {
      const body = JSON.parse(init.body);
      if (body.signature) signedPosts += 1;
      return {
        ok: true,
        status: 200,
        json: async () => ({
          ok: true,
          sessionId: 'ee'.repeat(24),
          nonce: 'ff'.repeat(32),
          offerMessage: 'fabric:login:something-else'
        })
      };
    };
    const res = await startDeviceLinkOffer(ident, { fetchImpl });
    assert.equal(res.ok, false);
    assert.equal(signedPosts, 0);
  });

  it('reports an accepted session with the responder fingerprint and signs nothing', async () => {
    const { ident, offer, accepted, peer } = acceptedSession();
    const calls = [];
    const res = await tickDeviceLinkOffer(ident, offer, { fetchImpl: hubFetch(accepted, calls) });
    assert.equal(res.ok, true, res.error);
    assert.equal(res.status, 'accepted');
    assert.equal(res.responder.id, peer.id);
    assert.equal(res.fingerprint, keyFingerprint(peer.pubkeyHex));
    assert.equal(res.origin, DEFAULT_DEVICE_LINK_HUB);
    assert.equal(calls.some((c) => c.method === 'POST'), false);
  });

  it('countersigns only after the user confirms that responder', async () => {
    const { ident, offer, accepted, me, peer } = acceptedSession();
    const calls = [];
    const res = await confirmDeviceLinkOffer(ident, offer, peer.id, { fetchImpl: hubFetch(accepted, calls) });
    assert.equal(res.ok, true, res.error);
    assert.equal(res.status, 'linked');
    assert.equal(res.peerFabricId, peer.id);
    assert.equal(res.peerPubkey, peer.pubkeyHex);
    assert.equal(res.sessionId, offer.sessionId);
    assert.equal(res.origin, DEFAULT_DEVICE_LINK_HUB);
    const post = calls.find((c) => c.method === 'POST');
    assert.ok(post);
    assert.equal(post.body.role, 'initiator');
    const linkMessage = buildDeviceLinkMessage(offer.sessionId, offer.nonce, me.id, peer.id, offer.label, offer.origin);
    assert.ok(me.key.verifySchnorr(Buffer.from(linkMessage, 'utf8'), Buffer.from(post.body.signature, 'hex'), DEVICE_LINK_TAG));
    assert.equal(offer.countersigned, peer.id);

    const linked = Object.assign({}, accepted, { status: 'linked' });
    const after = await tickDeviceLinkOffer(ident, offer, { fetchImpl: hubFetch(linked) });
    assert.equal(after.status, 'linked');
    assert.equal(after.peerFabricId, peer.id);
  });

  it('refuses to confirm when the Hub now names another responder', async () => {
    const { ident, offer, peer } = acceptedSession();
    const swapped = acceptedSession({ ident });
    const state = Object.assign({}, swapped.accepted, {
      sessionId: offer.sessionId,
      nonce: offer.nonce
    });
    const calls = [];
    const res = await confirmDeviceLinkOffer(ident, offer, peer.id, { fetchImpl: hubFetch(state, calls) });
    assert.equal(res.ok, false);
    assert.equal(calls.some((c) => c.method === 'POST'), false);
  });

  it('refuses a responder signature bound to another session', async () => {
    const other = crypto.randomBytes(24).toString('hex');
    const { ident, offer, accepted, peer } = acceptedSession({ signedSessionId: other });
    const calls = [];
    const tick = await tickDeviceLinkOffer(ident, offer, { fetchImpl: hubFetch(accepted, calls) });
    assert.equal(tick.ok, false);
    const res = await confirmDeviceLinkOffer(ident, offer, peer.id, { fetchImpl: hubFetch(accepted, calls) });
    assert.equal(res.ok, false);
    assert.equal(calls.some((c) => c.method === 'POST'), false);
  });

  it('refuses a session offered by another identity', async () => {
    const { offer, accepted, peer } = acceptedSession();
    const calls = [];
    const res = await confirmDeviceLinkOffer(createIdentity(), offer, peer.id, { fetchImpl: hubFetch(accepted, calls) });
    assert.equal(res.ok, false);
    assert.equal(calls.some((c) => c.method === 'POST'), false);
  });

  it('does not report a link this device never countersigned', async () => {
    const { ident, offer, accepted } = acceptedSession();
    const linked = Object.assign({}, accepted, { status: 'linked' });
    const res = await tickDeviceLinkOffer(ident, offer, { fetchImpl: hubFetch(linked) });
    assert.equal(res.ok, false);
    assert.equal(res.expired, true);
  });

  it('marks a 404 hub poll as expired', async () => {
    const ident = createIdentity();
    const fetchImpl = async () => ({
      ok: false,
      status: 404,
      json: async () => ({ ok: false, error: 'unknown or expired device link' })
    });
    const res = await tickDeviceLinkOffer(ident, {
      sessionId: 'aa'.repeat(24),
      hubBase: DEFAULT_DEVICE_LINK_HUB,
      origin: DEFAULT_DEVICE_LINK_HUB,
      createdAt: Date.now()
    }, { fetchImpl });
    assert.equal(res.ok, false);
    assert.equal(res.expired, true);
    assert.match(String(res.error), /expired/i);
  });

  it('times out a stale local offer before calling the hub', async () => {
    const ident = createIdentity();
    let called = 0;
    const fetchImpl = async () => {
      called += 1;
      return { ok: true, status: 200, json: async () => ({ ok: true, status: 'pending' }) };
    };
    const res = await tickDeviceLinkOffer(ident, {
      sessionId: 'bb'.repeat(24),
      hubBase: DEFAULT_DEVICE_LINK_HUB,
      origin: DEFAULT_DEVICE_LINK_HUB,
      createdAt: Date.now() - (11 * 60 * 1000)
    }, { fetchImpl });
    assert.equal(res.ok, false);
    assert.equal(res.expired, true);
    assert.equal(called, 0);
  });
});

describe('fabricDeviceLinkClient headers', () => {
  it('omits Origin/Referer when window is the global', () => {
    const { deviceLinkHeaders } = require('../../functions/fabricDeviceLinkClient');
    const nodeHeaders = deviceLinkHeaders('https://relay.goon.vc');
    assert.equal(nodeHeaders.Origin, 'https://relay.goon.vc');
    const prior = globalThis.window;
    globalThis.window = globalThis;
    try {
      const browserHeaders = deviceLinkHeaders('https://relay.goon.vc');
      assert.equal(browserHeaders.Origin, undefined);
      assert.equal(browserHeaders.Referer, undefined);
    } finally {
      if (prior === undefined) delete globalThis.window;
      else globalThis.window = prior;
    }
  });
});
