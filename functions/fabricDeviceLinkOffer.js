'use strict';

/**
 * Device-link *initiator* — any GoonCitizen node (Android or desktop) can create a
 * pending offer on an allowlisted public hub, show fabric://link + an HTTPS landing
 * URL (Passport), then — once the user confirms the responder's key — countersign.
 * Polling never signs. Passport and Hub browser can start the same ceremony.
 * Pairing is peer-equivalent.
 *
 * Pairing HTTPS is rendezvous only (D-013). IdentityCrossSign still gossips
 * from the local Peer after status: linked.
 */

const {
  prepareDeviceLinkOffer,
  commitDeviceLinkOffer,
  fetchDeviceLinkSession,
  postDeviceLinkSignature,
  buildDeviceLinkOfferMessage,
  verifyDeviceLinkResponder,
  DEVICE_LINK_OFFER_TAG,
  DEVICE_LINK_TAG
} = require('@fabric/http/functions/fabricDeviceLinkClient');
const { buildFabricIdentitySignedPayload } = require('@fabric/core/functions/fabricIdentitySchnorr');
const { assertAllowedFabricHub } = require('./fabricHubAllowlist');
const { protocolQrDataUrl } = require('./protocolQr');
const {
  cancelDeviceLinkSession,
  keyFingerprint,
  signingIdentity
} = require('./fabricDeviceLinkClient');
const {
  DEVICE_LINK_OFFER_TTL_MS,
  stampCreatedAt,
  isDeviceLinkOfferExpired,
  isStaleDeviceLinkError
} = require('./deviceLinkLifecycle');

const DEFAULT_DEVICE_LINK_HUB = 'https://relay.goon.vc';
const DEVICE_LINK_TICK_MS = 2000;

function httpsLandingUrl (hubBase, sessionId) {
  const base = String(hubBase || '').replace(/\/$/, '');
  return `${base}/#device-link=${encodeURIComponent(sessionId)}`;
}

/**
 * Compressed / x-only hex from a device-link party, or the protocol pubkey
 * on a Fabric-node xpub when Hub omitted pubkeyHex.
 * @param {object} [party]
 * @returns {string|null}
 */
function peerPubkeyFromParty (party) {
  if (!party || typeof party !== 'object') return null;
  const raw = String(party.pubkeyHex || party.pubkey || party.peerPubkey || '')
    .trim().toLowerCase().replace(/^0x/, '');
  if (/^0[23][a-f0-9]{64}$/.test(raw) || /^[a-f0-9]{64}$/.test(raw) || /^[a-f0-9]{66}$/.test(raw)) {
    return raw;
  }
  const xpub = String(party.xpub || '').trim();
  if (!xpub) return null;
  try {
    const Key = require('@fabric/core/types/key');
    const pk = String(new Key({ xpub }).pubkey || '').toLowerCase();
    if (/^0[23][a-f0-9]{64}$/.test(pk) || /^[a-f0-9]{64}$/.test(pk)) return pk;
  } catch (_) { /* watch-only / non-protocol xpub */ }
  return null;
}

/**
 * Persistable initiator offer (no QR data URL).
 * @param {object} [offer]
 * @returns {object|null}
 */
function compactPendingOffer (offer) {
  if (!offer || !offer.sessionId || !offer.hubBase) return null;
  return {
    ok: true,
    sessionId: String(offer.sessionId),
    hubBase: String(offer.hubBase).replace(/\/$/, ''),
    origin: String(offer.origin || offer.hubBase).replace(/\/$/, ''),
    nonce: offer.nonce || null,
    pollSecret: offer.pollSecret || null,
    label: offer.label || null,
    createdAt: Number(offer.createdAt) || Date.now(),
    protocolUrl: offer.protocolUrl || null,
    httpsUrl: offer.httpsUrl || null,
    initiatorId: offer.initiatorId || null,
    countersigned: offer.countersigned || null,
    status: 'pending'
  };
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
  let me;
  try {
    me = signingIdentity(identity);
  } catch (e) {
    return { ok: false, error: (e && e.message) ? String(e.message) : 'could not load identity key' };
  }
  const initiatorId = me.id;
  // The hub picks sessionId + nonce; sign only the offer rebuilt here.
  const prepared = await prepareDeviceLinkOffer({
    hubBase,
    origin,
    label,
    identity: { id: initiatorId, xpub: me.xpub },
    fetchImpl: opts.fetchImpl
  });
  if (!prepared.ok) return prepared;
  let offerMessage;
  try {
    offerMessage = buildDeviceLinkOfferMessage(prepared.sessionId, prepared.nonce, initiatorId, label, origin);
  } catch (e) {
    return { ok: false, error: 'hub did not return a session-bound device-link offer' };
  }
  if (prepared.offerMessage && prepared.offerMessage !== offerMessage) {
    return { ok: false, error: 'hub offer does not match this identity, label, or origin' };
  }
  const nonce = String(prepared.nonce).toLowerCase();
  const offerSigned = buildFabricIdentitySignedPayload(me.key, offerMessage, DEVICE_LINK_OFFER_TAG);
  const created = await commitDeviceLinkOffer({
    hubBase,
    origin,
    label,
    sessionId: prepared.sessionId,
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
  return stampCreatedAt({
    ok: true,
    sessionId: created.sessionId,
    nonce: created.nonce || nonce,
    pollSecret: created.pollSecret || prepared.pollSecret || null,
    label,
    hubBase,
    origin,
    protocolUrl,
    httpsUrl,
    qrDataUrl,
    initiatorId,
    status: 'pending'
  });
}

/**
 * Best-effort remote cancel. Callers drop the local QR / overlay regardless of
 * whether the hub DELETE succeeded. Network errors return `ok: false` so they
 * can retry; the hub row ages out on SESSION_TTL_MS.
 */
async function abandonDeviceLinkOffer (offer, opts = {}) {
  if (!offer || !offer.sessionId || !offer.hubBase) return { ok: true, skipped: true };
  return cancelDeviceLinkSession(offer.hubBase, offer.sessionId, {
    origin: offer.origin || offer.hubBase,
    pollSecret: offer.pollSecret,
    fetchImpl: opts.fetchImpl
  });
}

function _linkedResult (offer, st, responder) {
  return {
    ok: true,
    status: 'linked',
    sessionId: offer.sessionId,
    nonce: st.nonce || offer.nonce,
    origin: offer.origin || offer.hubBase,
    responder,
    label: st.label || offer.label,
    hubBase: offer.hubBase,
    peerPubkey: (responder && responder.pubkeyHex) || peerPubkeyFromParty(responder),
    peerFabricId: (responder && responder.id) || null,
    peerXpub: (responder && responder.xpub) || null
  };
}

/**
 * Check an accepted session against the offer this device made, and the
 * responder's signature over the link it names.
 * @returns {{ ok: true, responder: object, linkMessage: string }|{ ok: false, error: string }}
 */
function _checkAccepted (me, offer, st) {
  if (String(st.sessionId || '') !== String(offer.sessionId)) {
    return { ok: false, error: 'Hub answered for another device link' };
  }
  if ((offer.nonce && st.nonce !== offer.nonce) || (offer.label && st.label !== offer.label)) {
    return { ok: false, error: 'Hub session does not match this offer' };
  }
  try {
    if (new URL(String(st.origin)).origin !== new URL(String(offer.origin || offer.hubBase)).origin) {
      return { ok: false, error: 'Hub session does not match this offer' };
    }
  } catch (_) {
    return { ok: false, error: 'Hub session does not match this offer' };
  }
  if (!st.initiator || st.initiator.id !== me.id) {
    return { ok: false, error: 'Hub session was not offered by this identity' };
  }
  let verified;
  try {
    verified = verifyDeviceLinkResponder(st);
  } catch (err) {
    verified = { ok: false, error: (err && err.message) ? String(err.message) : 'invalid device link' };
  }
  if (!verified.ok) return verified;
  if (verified.responder.id === me.id || verified.responder.pubkeyHex === me.pubkeyHex) {
    return { ok: false, error: 'Cannot link a device to itself' };
  }
  return { ok: true, responder: verified.responder, linkMessage: verified.linkMessage };
}

async function _fetchOffer (offer, opts) {
  return fetchDeviceLinkSession(offer.hubBase, offer.sessionId, {
    origin: offer.origin || offer.hubBase,
    pollSecret: offer.pollSecret,
    fetchImpl: opts.fetchImpl
  });
}

/**
 * Poll once. Never signs: an accepted session comes back as `accepted` with
 * the responder's key fingerprint for the user to confirm
 * ({@link confirmDeviceLinkOffer}). `linked` is reported only for the
 * responder this device countersigned (`offer.countersigned`).
 * @param {object} identity
 * @param {object} offer startDeviceLinkOffer result
 * @param {object} [opts]
 */
async function tickDeviceLinkOffer (identity, offer, opts = {}) {
  if (!identity) return { ok: false, error: 'Identity is locked' };
  if (!offer || !offer.sessionId || !offer.hubBase) {
    return { ok: false, expired: true, error: 'no pending device-link offer' };
  }
  if (isDeviceLinkOfferExpired(offer)) {
    return {
      ok: false,
      expired: true,
      error: 'device-link offer timed out — start a new one'
    };
  }
  const st = await _fetchOffer(offer, opts);
  if (!st.ok) {
    if (isStaleDeviceLinkError(st)) {
      return {
        ok: false,
        expired: true,
        status: st.status,
        error: st.error || 'unknown or expired device link'
      };
    }
    return st;
  }
  if (st.status === 'pending') {
    return { ok: true, status: 'pending', sessionId: offer.sessionId };
  }
  if (st.status === 'linked') {
    const responder = st.responder || null;
    if (!offer.countersigned || !responder || responder.id !== offer.countersigned) {
      return { ok: false, expired: true, error: 'Hub reports a link this device did not confirm' };
    }
    return _linkedResult(offer, st, responder);
  }
  if (st.status !== 'accepted') {
    return { ok: true, status: st.status || 'unknown', sessionId: offer.sessionId };
  }
  let me;
  try {
    me = signingIdentity(identity);
  } catch (e) {
    return { ok: false, error: (e && e.message) ? String(e.message) : 'could not load identity key' };
  }
  const checked = _checkAccepted(me, offer, st);
  if (!checked.ok) return checked;
  return {
    ok: true,
    status: 'accepted',
    sessionId: offer.sessionId,
    origin: offer.origin || offer.hubBase,
    label: st.label || offer.label,
    responder: checked.responder,
    fingerprint: keyFingerprint(checked.responder.pubkeyHex)
  };
}

/**
 * Countersign the link after the user confirmed the responder `responderId`
 * (the Fabric id {@link tickDeviceLinkOffer} showed with its fingerprint).
 * Refuses when the session now names another responder.
 * @param {object} identity
 * @param {object} offer
 * @param {string} responderId
 * @param {object} [opts]
 */
async function confirmDeviceLinkOffer (identity, offer, responderId, opts = {}) {
  if (!identity) return { ok: false, error: 'Identity is locked' };
  if (!offer || !offer.sessionId || !offer.hubBase) {
    return { ok: false, expired: true, error: 'no pending device-link offer' };
  }
  const st = await _fetchOffer(offer, opts);
  if (!st.ok) return st;
  if (st.status !== 'accepted') return { ok: false, error: 'device link is not waiting for confirmation' };
  let me;
  try {
    me = signingIdentity(identity);
  } catch (e) {
    return { ok: false, error: (e && e.message) ? String(e.message) : 'could not load identity key' };
  }
  const checked = _checkAccepted(me, offer, st);
  if (!checked.ok) return checked;
  if (!responderId || checked.responder.id !== String(responderId)) {
    return { ok: false, error: 'device link changed since you confirmed it — start a new one' };
  }
  const countersigned = buildFabricIdentitySignedPayload(me.key, checked.linkMessage, DEVICE_LINK_TAG);
  offer.countersigned = checked.responder.id;
  const done = await postDeviceLinkSignature(offer.hubBase, offer.sessionId, {
    role: 'initiator',
    signature: countersigned.signature,
    pubkeyHex: countersigned.pubkeyHex,
    identity: countersigned.identity
  }, { origin: offer.origin || offer.hubBase, fetchImpl: opts.fetchImpl });
  if (!done.ok) return done;
  return _linkedResult(offer, st, checked.responder);
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
  DEVICE_LINK_OFFER_TTL_MS,
  DEVICE_LINK_TICK_MS,
  httpsLandingUrl,
  startDeviceLinkOffer,
  tickDeviceLinkOffer,
  confirmDeviceLinkOffer,
  abandonDeviceLinkOffer,
  peerPubkeyFromParty,
  compactPendingOffer,
  parseDeviceLinkLanding,
  notifyPassportDeviceLink,
  offerPassportDeviceLink
};
