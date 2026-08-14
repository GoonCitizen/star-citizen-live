'use strict';

/**
 * Device-link *initiator* — any GoonCitizen node (Android or desktop) can create a
 * pending offer on an allowlisted public hub, show fabric://link + an HTTPS landing
 * URL (Passport), then countersign when the responder accepts. Passport and Hub
 * browser can start the same ceremony. Pairing is peer-equivalent.
 *
 * Pairing HTTPS is rendezvous only (D-013). IdentityCrossSign still gossips
 * from the local Peer after status: linked.
 */

const {
  createDeviceLinkOffer,
  fetchDeviceLinkSession,
  postDeviceLinkSignature,
  buildDeviceLinkOfferMessage
} = require('@fabric/http/functions/fabricDeviceLinkClient');
const { buildFabricIdentitySignedPayload } = require('@fabric/http/functions/fabricSiteLoginVerify');
const { assertAllowedFabricHub } = require('./fabricHubAllowlist');
const { keyFromIdentity } = require('./identity');
const { protocolQrDataUrl } = require('./protocolQr');

const DEFAULT_DEVICE_LINK_HUB = 'https://relay.goon.vc';

function randomNonceHex () {
  try {
    if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
      const u = new Uint8Array(32);
      crypto.getRandomValues(u);
      return Array.from(u).map((b) => b.toString(16).padStart(2, '0')).join('');
    }
  } catch (_) { /* fall through */ }
  return require('crypto').randomBytes(32).toString('hex');
}

function httpsLandingUrl (hubBase, sessionId) {
  const base = String(hubBase || '').replace(/\/$/, '');
  return `${base}/#device-link=${encodeURIComponent(sessionId)}`;
}

/**
 * @param {object} identity unlocked Fabric identity
 * @param {object} [opts]
 * @param {string} [opts.hubBase]
 * @param {string} [opts.label]
 * @param {typeof fetch} [opts.fetchImpl]
 */
async function startDeviceLinkOffer (identity, opts = {}) {
  if (!identity) return { ok: false, error: 'Identity is locked' };
  const hubGate = assertAllowedFabricHub(opts.hubBase || DEFAULT_DEVICE_LINK_HUB);
  if (!hubGate.ok) return hubGate;
  const hubBase = hubGate.hubBase;
  const origin = hubBase;
  const label = String(opts.label || 'GoonCitizen').replace(/:/g, '-').slice(0, 64);
  let key;
  try {
    key = keyFromIdentity(identity);
  } catch (e) {
    return { ok: false, error: (e && e.message) ? String(e.message) : 'could not load identity key' };
  }
  const probe = buildFabricIdentitySignedPayload(key, 'fabric:device-link:id-probe');
  const initiatorId = probe.identity.id;
  const nonce = randomNonceHex();
  const offerMessage = buildDeviceLinkOfferMessage(nonce, initiatorId, label, origin);
  const offerSigned = buildFabricIdentitySignedPayload(key, offerMessage);
  const created = await createDeviceLinkOffer({
    hubBase,
    origin,
    label,
    nonce,
    identity: offerSigned.identity,
    pubkeyHex: offerSigned.pubkeyHex,
    signature: offerSigned.signature,
    fetchImpl: opts.fetchImpl
  });
  if (!created.ok) return created;
  const protocolUrl = created.protocolUrl ||
    `fabric://link?sessionId=${encodeURIComponent(created.sessionId)}&hub=${encodeURIComponent(origin)}`;
  const httpsUrl = httpsLandingUrl(hubBase, created.sessionId);
  let qrDataUrl = null;
  try { qrDataUrl = await protocolQrDataUrl(protocolUrl); } catch (_) { qrDataUrl = null; }
  return {
    ok: true,
    sessionId: created.sessionId,
    nonce: created.nonce || nonce,
    label,
    hubBase,
    origin,
    protocolUrl,
    httpsUrl,
    qrDataUrl,
    initiatorId,
    status: 'pending'
  };
}

/**
 * Poll once. When the responder has accepted, countersign as initiator.
 * @param {object} identity
 * @param {object} offer startDeviceLinkOffer result
 * @param {object} [opts]
 */
async function tickDeviceLinkOffer (identity, offer, opts = {}) {
  if (!identity) return { ok: false, error: 'Identity is locked' };
  if (!offer || !offer.sessionId || !offer.hubBase) {
    return { ok: false, error: 'no pending device-link offer' };
  }
  const origin = offer.origin || offer.hubBase;
  const st = await fetchDeviceLinkSession(offer.hubBase, offer.sessionId, {
    origin,
    fetchImpl: opts.fetchImpl
  });
  if (!st.ok) return st;
  if (st.status === 'pending') {
    return { ok: true, status: 'pending', sessionId: offer.sessionId };
  }
  if (st.status === 'linked') {
    const responder = st.responder || null;
    return {
      ok: true,
      status: 'linked',
      sessionId: offer.sessionId,
      nonce: st.nonce || offer.nonce,
      responder,
      label: st.label || offer.label,
      hubBase: offer.hubBase,
      peerPubkey: (responder && responder.pubkeyHex) || null,
      peerFabricId: (responder && responder.id) || null,
      peerXpub: (responder && responder.xpub) || null
    };
  }
  if (st.status !== 'accepted' || !st.linkMessage) {
    return { ok: true, status: st.status || 'unknown', sessionId: offer.sessionId };
  }
  let key;
  try {
    key = keyFromIdentity(identity);
  } catch (e) {
    return { ok: false, error: (e && e.message) ? String(e.message) : 'could not load identity key' };
  }
  const countersigned = buildFabricIdentitySignedPayload(key, st.linkMessage);
  const done = await postDeviceLinkSignature(offer.hubBase, offer.sessionId, {
    role: 'initiator',
    signature: countersigned.signature,
    pubkeyHex: countersigned.pubkeyHex,
    identity: countersigned.identity
  }, { origin, fetchImpl: opts.fetchImpl });
  if (!done.ok) return done;
  return {
    ok: true,
    status: done.status || 'linked',
    sessionId: offer.sessionId,
    nonce: st.nonce || offer.nonce,
    responder: done.responder || st.responder || null,
    label: done.label || st.label || offer.label,
    hubBase: offer.hubBase,
    peerPubkey: (done.responder && done.responder.pubkeyHex) ||
      (st.responder && st.responder.pubkeyHex) || null,
    peerFabricId: (done.responder && done.responder.id) ||
      (st.responder && st.responder.id) || null,
    peerXpub: (done.responder && done.responder.xpub) ||
      (st.responder && st.responder.xpub) || null
  };
}

function parseDeviceLinkLanding (loc) {
  if (!loc) return null;
  const hash = String(loc.hash || '').replace(/^#/, '');
  let sessionId = null;
  const fromHash = hash.match(/^device-link=([a-fA-F0-9]+)/);
  if (fromHash) sessionId = fromHash[1];
  try {
    const params = new URLSearchParams(String(loc.search || '').replace(/^\?/, ''));
    if (!sessionId) sessionId = params.get('deviceLink') || params.get('sessionId');
    const hubParam = params.get('hub');
    if (sessionId) {
      return {
        sessionId,
        hubBase: hubParam || String(loc.origin || '').replace(/\/$/, '') || DEFAULT_DEVICE_LINK_HUB
      };
    }
  } catch (_) { /* ignore */ }
  if (sessionId) {
    return {
      sessionId,
      hubBase: String(loc.origin || '').replace(/\/$/, '') || DEFAULT_DEVICE_LINK_HUB
    };
  }
  return null;
}

function notifyPassportDeviceLink (landing, win) {
  const w = win || (typeof window !== 'undefined' ? window : null);
  if (!w || !landing || !landing.sessionId) return false;
  const origin = String((w.location && w.location.origin) || landing.hubBase || '').replace(/\/$/, '');
  const hub = String(landing.hubBase || origin).replace(/\/$/, '');
  try {
    w.postMessage({
      source: 'fabric-site',
      type: 'FABRIC_DEVICE_LINK_REQUEST',
      sessionId: landing.sessionId,
      hub,
      origin
    }, origin);
    return true;
  } catch (_) {
    return false;
  }
}

/**
 * Hosted dashboard (`https://relay.goon.vc/#device-link=…`) tells Passport to
 * sign as responder. Hub and page origin must match (Passport origin_mismatch).
 */
function offerPassportDeviceLink (loc, win) {
  const w = win || (typeof window !== 'undefined' ? window : null);
  const landing = parseDeviceLinkLanding(loc || (w && w.location) || null);
  if (!landing) return false;
  notifyPassportDeviceLink(landing, w);
  try {
    if (w && w.history && w.location) {
      w.history.replaceState(null, '', w.location.pathname + (w.location.search || ''));
    }
  } catch (_) { /* ignore */ }
  return true;
}

module.exports = {
  DEFAULT_DEVICE_LINK_HUB,
  httpsLandingUrl,
  startDeviceLinkOffer,
  tickDeviceLinkOffer,
  parseDeviceLinkLanding,
  notifyPassportDeviceLink,
  offerPassportDeviceLink
};
