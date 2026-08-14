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
  DEFAULT_DEVICE_LINK_HUB
} = require('../../functions/fabricDeviceLinkOffer');
const { buildDeviceLinkOfferMessage } = require('@fabric/http/functions/fabricDeviceLinkMessages');

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
  it('POSTs a signed offer to the allowlisted hub', async () => {
    const ident = createIdentity();
    let posted = null;
    const fetchImpl = async (url, init) => {
      posted = { url, init };
      return {
        ok: true,
        status: 200,
        json: async () => ({
          ok: true,
          sessionId: 'ee'.repeat(24),
          nonce: 'ff'.repeat(32),
          protocolUrl: 'fabric://link?sessionId=ee&hub=https%3A%2F%2Frelay.goon.vc'
        })
      };
    };
    const res = await startDeviceLinkOffer(ident, { fetchImpl, label: 'GoonCitizen Android' });
    assert.equal(res.ok, true, res.error);
    assert.equal(res.hubBase, DEFAULT_DEVICE_LINK_HUB);
    assert.ok(res.httpsUrl.includes('#device-link='));
    assert.match(posted.url, /\/device-links$/);
    const body = JSON.parse(posted.init.body);
    assert.equal(body.origin, DEFAULT_DEVICE_LINK_HUB);
    assert.equal(body.label, 'GoonCitizen Android');
    assert.match(body.signature, /^[a-f0-9]{128}$/i);
    const offerMessage = buildDeviceLinkOfferMessage(
      body.nonce,
      body.identity.id,
      body.label,
      body.origin
    );
    assert.ok(keyFromIdentity(ident).verifySchnorr(
      Buffer.from(offerMessage, 'utf8'),
      Buffer.from(body.signature, 'hex')
    ));
  });

  it('countersigns when the responder has accepted', async () => {
    const ident = createIdentity();
    const sessionId = crypto.randomBytes(24).toString('hex');
    const nonce = crypto.randomBytes(32).toString('hex');
    const linkMessage = `fabric:device-link:1:${nonce}:id1a:id1b:GoonCitizen`;
    const calls = [];
    const fetchImpl = async (url, init) => {
      calls.push({ url, method: init && init.method, body: init && init.body });
      if (init && init.method === 'POST') {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            ok: true,
            status: 'linked',
            sessionId,
            responder: { id: 'id1b', xpub: 'xpub1', pubkeyHex: 'ab'.repeat(33) }
          })
        };
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({
          ok: true,
          status: 'accepted',
          sessionId,
          nonce,
          linkMessage,
          responder: { id: 'id1b', pubkeyHex: 'ab'.repeat(33) }
        })
      };
    };
    const res = await tickDeviceLinkOffer(ident, {
      sessionId,
      hubBase: DEFAULT_DEVICE_LINK_HUB,
      origin: DEFAULT_DEVICE_LINK_HUB,
      nonce,
      label: 'GoonCitizen'
    }, { fetchImpl });
    assert.equal(res.ok, true, res.error);
    assert.equal(res.status, 'linked');
    assert.equal(res.peerFabricId, 'id1b');
    assert.equal(res.peerPubkey, 'ab'.repeat(33));
    assert.equal(calls.some((c) => c.method === 'POST'), true);
  });

  it('returns peer pubkey when GET already reports linked', async () => {
    const ident = createIdentity();
    const sessionId = crypto.randomBytes(24).toString('hex');
    const nonce = crypto.randomBytes(32).toString('hex');
    const fetchImpl = async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        ok: true,
        status: 'linked',
        sessionId,
        nonce,
        responder: { id: 'id1z', xpub: 'xpubz', pubkeyHex: 'cd'.repeat(33) }
      })
    });
    const res = await tickDeviceLinkOffer(ident, {
      sessionId,
      hubBase: DEFAULT_DEVICE_LINK_HUB,
      origin: DEFAULT_DEVICE_LINK_HUB,
      nonce
    }, { fetchImpl });
    assert.equal(res.ok, true);
    assert.equal(res.status, 'linked');
    assert.equal(res.peerPubkey, 'cd'.repeat(33));
    assert.equal(res.peerFabricId, 'id1z');
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
