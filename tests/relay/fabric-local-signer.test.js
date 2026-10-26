'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const LiveRelay = require('../../services/LiveRelay');
const { createIdentity, keyFromIdentity } = require('../../functions/identity');
const { signCrossSign } = require('../../functions/identityCrossSignVerify');
const { startDeviceLinkOffer, tickDeviceLinkOffer, confirmDeviceLinkOffer } = require('../../functions/fabricDeviceLinkOffer');
const { isForeignBrowserWrite } = require('../../functions/httpRemoteAuth');
const { fabricSignApprovalDialog } = require('../../functions/fabricSignApprovalDialog');
const { createFabricLocalSignerRelay } = require('../../functions/fabricLocalSignerRelay');

const { createChallenge, createSignRequest, verifyAssertion, pairingCode } = require('@fabric/core/functions/passport');

const CHROME_ID = 'abcdefghijklmnopabcdefghijklmnop';
const PASSPORT_ORIGIN = `chrome-extension://${CHROME_ID}`;

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
  const headers = Object.assign({ Connection: 'close' }, init.headers || {});
  const res = await fetch(url, Object.assign({}, init, { headers }));
  const j = await res.json().catch(() => ({}));
  return { status: res.status, j };
}

describe('foreign-origin writes', () => {
  it('trusts only loopback origins on the dashboard port', () => {
    const req = (method, headers) => ({ method, headers });
    assert.equal(isForeignBrowserWrite(req('POST', { origin: 'http://127.0.0.1:3041' }), { port: 3041 }), false);
    assert.equal(isForeignBrowserWrite(req('POST', { origin: 'http://localhost:3041' }), { port: 3041 }), false);
    assert.equal(isForeignBrowserWrite(req('POST', { origin: 'https://evil.example' }), { port: 3041 }), true);
    assert.equal(isForeignBrowserWrite(req('POST', { origin: 'http://rebind.example:3041' }), { port: 3041 }), true);
    assert.equal(isForeignBrowserWrite(req('POST', { origin: 'http://127.0.0.1:5173' }), { port: 3041 }), true);
    assert.equal(isForeignBrowserWrite(req('POST', { origin: 'null' }), { port: 3041 }), true);
    assert.equal(isForeignBrowserWrite(req('POST', { 'sec-fetch-site': 'cross-site' }), { port: 3041 }), true);
    assert.equal(isForeignBrowserWrite(req('POST', {}), { port: 3041 }), false);
    assert.equal(isForeignBrowserWrite(req('GET', { origin: 'https://evil.example' }), { port: 3041 }), false);
    assert.equal(isForeignBrowserWrite(req('POST', { origin: 'capacitor://localhost' }), {
      port: 3041,
      allowOrigin: (o) => o.startsWith('capacitor://')
    }), false);
  });
});

describe('approval dialog', () => {
  it('defaults to Cancel and strips control and bidi characters', () => {
    const d = fabricSignApprovalDialog({ kind: 'sign', origin: 'https://shop.example\u202e', device: 'ab'.repeat(32) });
    assert.equal(d.defaultId, 1);
    assert.equal(d.cancelId, 1);
    assert.ok(!d.message.includes('\u202e'));
    const link = fabricSignApprovalDialog({ kind: 'link', label: 'Passport', code: '123456' });
    assert.match(link.message, /Link “Passport”/);
    assert.match(link.detail, /Pairing code: 123456/);
  });

  it('is not mounted without a native approver or on server / Android', () => {
    const relay = { settings: {}, emit () {} };
    assert.equal(createFabricLocalSignerRelay(relay), null);
    assert.equal(createFabricLocalSignerRelay({ settings: { mode: 'server', fabricSignApprover: () => true }, emit () {} }), null);
    assert.equal(createFabricLocalSignerRelay({ settings: { mode: 'android', fabricSignApprover: () => true }, emit () {} }), null);
  });
});

describe('LiveRelay desktop: loopback HTTP from other origins and the Passport local signer', () => {
  let relay;
  let base;
  let player;
  const prompts = [];

  before(async () => {
    player = createIdentity();
    relay = new LiveRelay({
      listen: false,
      missions: { enable: true },
      fabric: { enable: false },
      fabricSigner: { extensionIds: [CHROME_ID] },
      fabricSignApprover: async (prompt) => { prompts.push(prompt); return true; }
    });
    await relay.start();
    relay.setIdentity(player);
    base = await listen(relay);
  });

  after(async () => {
    if (relay && relay.server) {
      await new Promise((resolve) => relay.server.close(() => resolve()));
      relay.server = null;
    }
    if (relay) await relay.stop();
  });

  it('refuses register writes from another web origin', async () => {
    const r = await jsonFetch(`${base}/services/star-citizen/missions`, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain', Origin: 'https://evil.example' },
      body: JSON.stringify({ title: 'planted' })
    });
    assert.equal(r.status, 403);
    assert.equal(r.j.code, 'FOREIGN_ORIGIN');
    const own = await jsonFetch(`${base}/services/star-citizen/missions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: base },
      body: JSON.stringify({ title: 'mine' })
    });
    assert.notEqual(own.j.code, 'FOREIGN_ORIGIN');
  });

  it('still takes self-authenticating cross-signs from other origins', async () => {
    const r = await jsonFetch(`${base}/services/star-citizen/identity/cross-sign`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: 'chrome-extension://abcdefghijklmnop' },
      body: JSON.stringify({})
    });
    assert.notEqual(r.j.code, 'FOREIGN_ORIGIN');
  });

  it('links Passport after a native approval, then signs it in to a site', async () => {
    const me = await jsonFetch(`${base}/services/fabric/identity`);
    assert.equal(me.status, 200, me.j.error);
    assert.equal(me.j.signer, 'gooncitizen');
    const playerKey = keyFromIdentity(player);
    assert.equal(me.j.pubkey, playerKey.pubkey);

    const passport = createIdentity();
    const offer = await startDeviceLinkOffer(passport, { hubBase: base, label: 'Passport' });
    assert.equal(offer.ok, true, offer.error);

    const foreign = await jsonFetch(`${base}/services/fabric/link`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: 'https://evil.example' },
      body: JSON.stringify({ sessionId: offer.sessionId })
    });
    assert.equal(foreign.status, 403, 'a web page cannot ask the desktop to link');

    const accepted = await jsonFetch(`${base}/services/fabric/link`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: PASSPORT_ORIGIN },
      body: JSON.stringify({ sessionId: offer.sessionId })
    });
    assert.equal(accepted.status, 200, accepted.j.error);
    assert.equal(accepted.j.status, 'accepted');
    assert.equal(prompts.at(-1).kind, 'link');
    assert.equal(prompts.at(-1).code, pairingCode(keyFromIdentity(passport).pubkey, me.j.pubkey));

    const tick = await tickDeviceLinkOffer(passport, offer);
    assert.equal(tick.ok, true, tick.error);
    assert.equal(tick.status, 'accepted');
    assert.equal(tick.responder.pubkeyHex, playerKey.pubkey);
    const linked = await confirmDeviceLinkOffer(passport, offer, tick.responder.id);
    assert.equal(linked.ok, true, linked.error);
    assert.equal(linked.status, 'linked');

    const theirs = signCrossSign(passport, {
      peerPubkey: playerKey.pubkey,
      nonce: offer.nonce,
      sessionId: offer.sessionId,
      origin: offer.origin
    });
    const posted = await jsonFetch(`${base}/services/star-citizen/identity/cross-sign`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: 'chrome-extension://abcdefghijklmnop' },
      body: JSON.stringify(theirs)
    });
    assert.equal(posted.status, 200, posted.j.error);
    assert.equal(relay.identityCluster.clusterEquals(player.pubkey, passport.pubkey), true);

    const site = 'https://shop.example';
    const challenge = createChallenge({ origin: site, network: me.j.network });
    const ask = createSignRequest({ challenge: challenge.uri, origin: site }, keyFromIdentity(passport));
    const page = await jsonFetch(`${base}/services/fabric/sign`, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain', Origin: site },
      body: ask.uri
    });
    assert.equal(page.status, 403, 'only Passport may ask for a signature');
    const signed = await jsonFetch(`${base}/services/fabric/sign`, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain', Origin: PASSPORT_ORIGIN },
      body: ask.uri
    });
    assert.equal(signed.status, 200, signed.j.error);
    assert.equal(prompts.at(-1).kind, 'sign');
    assert.equal(prompts.at(-1).origin, site);
    assert.deepEqual(prompts.at(-1).shares, ['identity']);
    const verified = verifyAssertion(signed.j.fabric, {
      origin: site,
      nonce: challenge.nonce,
      challengeHash: challenge.hash,
      network: challenge.network,
      allow: challenge.request,
      challengeExpiresAt: challenge.expiresAt
    });
    assert.equal(verified.ok, true, verified.error);
    assert.equal(verified.signer, 'gooncitizen');
    assert.equal(verified.identity.pubkey, me.j.pubkey);
    assert.equal(verified.wallet, null, 'no wallet keys unless asked and chosen');
    const replay = await jsonFetch(`${base}/services/fabric/sign`, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain', Origin: PASSPORT_ORIGIN },
      body: ask.uri
    });
    assert.equal(replay.status, 409, 'each request nonce works once');
  });
});
