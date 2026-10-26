'use strict';

/**
 * GoonCitizen responder for Hub mutual device-link sessions (v3). The offer
 * is verified before it is shown, and again right before signing: the
 * session must still be the one the user approved.
 */

const { keyFromIdentity } = require('./identity');
const {
  deviceLinkHeaders,
  verifyDeviceLinkOffer
} = require('@fabric/http/functions/fabricDeviceLinkClient');
const {
  buildFabricIdentitySignedPayload,
  resolveFabricSigningIdentity
} = require('@fabric/core/functions/fabricIdentitySchnorr');
const {
  DEVICE_LINK_PREFIX,
  DEVICE_LINK_TAG,
  buildDeviceLinkMessage
} = require('@fabric/http/functions/fabricDeviceLinkMessages');

/**
 * Short form of a pubkey people can compare across two screens.
 * @param {string} pubkeyHex
 * @returns {string}
 */
function keyFingerprint (pubkeyHex) {
  const hex = String(pubkeyHex || '').toLowerCase().replace(/^0[23]/, '').slice(0, 16);
  return (hex.match(/.{1,4}/g) || []).join(' ');
}

/**
 * Fabric id, xpub, and signing pubkey of an unlocked identity.
 * @param {object} identity
 * @returns {{ key: object, id: string, xpub: string, pubkeyHex: string }}
 */
function signingIdentity (identity) {
  const key = keyFromIdentity(identity);
  const resolved = resolveFabricSigningIdentity(key);
  return {
    key,
    id: resolved.identityId,
    xpub: String(resolved.fabricKey.xpub || ''),
    pubkeyHex: String(resolved.fabricKey.pubkey || '').toLowerCase()
  };
}

/**
 * Drop a pending hub session. 404 / already-gone is success so Cancel is always
 * safe. Fetch rejection is `ok: false` — the remote row may still exist (it ages
 * out on SESSION_TTL_MS). Callers drop the local QR / overlay themselves.
 */
async function cancelDeviceLinkSession (hubBase, sessionId, opts = {}) {
  const fetchImpl = opts.fetchImpl || globalThis.fetch;
  const base = String(hubBase || '').replace(/\/$/, '');
  const sid = String(sessionId || '').trim();
  if (!base || !sid) return { ok: true, skipped: true };
  const origin = String(opts.origin || base).trim().replace(/\/$/, '');
  try {
    const res = await fetchImpl(`${base}/device-links/${encodeURIComponent(sid)}`, {
      method: 'DELETE',
      headers: deviceLinkHeaders(origin, { pollSecret: opts.pollSecret }),
      cache: 'no-store'
    });
    const data = await res.json().catch(() => ({}));
    if (res.status === 404 || (res.ok && data && data.ok !== false)) {
      return {
        ...data,
        ok: true,
        cancelled: true,
        existed: !!(data && data.existed)
      };
    }
    if (res.status === 409) {
      return { ok: true, cancelled: false, alreadyLinked: true };
    }
    return { ok: false, status: res.status, error: (data && data.error) || `HTTP ${res.status}` };
  } catch (err) {
    return {
      ok: false,
      cancelled: false,
      error: (err && err.message) ? String(err.message) : 'cancel failed'
    };
  }
}

/**
 * Fetch a session. A pending one is returned only when its offer verifies
 * for this Hub: `initiator` is then the verified party and `fingerprint` its
 * short key.
 * @param {string} hubBase
 * @param {string} sessionId
 * @param {object} [opts]
 */
async function fetchPendingDeviceLink (hubBase, sessionId, opts = {}) {
  const fetchImpl = opts.fetchImpl || globalThis.fetch;
  const base = String(hubBase || '').replace(/\/$/, '');
  let data;
  let res;
  try {
    res = await fetchImpl(`${base}/device-links/${encodeURIComponent(sessionId)}`, {
      headers: deviceLinkHeaders(base),
      cache: 'no-store'
    });
    data = await res.json().catch(() => ({}));
  } catch (err) {
    return { ok: false, error: (err && err.message) ? String(err.message) : 'device link unreachable' };
  }
  if (!res.ok || !data.ok) {
    return { ok: false, error: (data && data.error) || `HTTP ${res.status}`, status: res.status };
  }
  if (data.status !== 'pending') return { ok: true, ...data };
  if (String(data.sessionId || '') !== String(sessionId)) {
    return { ok: false, error: 'Hub answered for another device link' };
  }
  let verified;
  try {
    verified = verifyDeviceLinkOffer(data, base);
  } catch (err) {
    verified = { ok: false, error: (err && err.message) ? String(err.message) : 'invalid device link' };
  }
  if (!verified.ok) return { ok: false, error: verified.error };
  return {
    ok: true,
    ...data,
    origin: verified.origin,
    initiator: verified.initiator,
    fingerprint: keyFingerprint(verified.initiator.pubkeyHex)
  };
}

/**
 * Sign as responder and POST to Hub, for the offer the user approved.
 * @param {object} identity unlocked identity
 * @param {string} hubBase
 * @param {object} approved `{ sessionId, nonce, label, origin, initiator: { id, pubkeyHex } }`
 *   as {@link fetchPendingDeviceLink} returned it when the prompt was shown
 * @param {object} [opts]
 */
async function completeDeviceLinkAsResponder (identity, hubBase, approved, opts = {}) {
  const fetchImpl = opts.fetchImpl || globalThis.fetch;
  if (!identity) return { ok: false, error: 'Identity is locked' };
  if (!approved || !approved.sessionId || !approved.initiator || !approved.initiator.pubkeyHex) {
    return { ok: false, error: 'device link is not pending' };
  }
  const current = await fetchPendingDeviceLink(hubBase, approved.sessionId, opts);
  if (!current.ok) return current;
  if (current.status !== 'pending') return { ok: false, error: 'device link is not pending' };
  const same = current.nonce === approved.nonce &&
    current.label === approved.label &&
    current.origin === approved.origin &&
    current.initiator.id === approved.initiator.id &&
    current.initiator.pubkeyHex === String(approved.initiator.pubkeyHex).toLowerCase();
  if (!same) return { ok: false, error: 'device link changed since you approved it — scan it again' };

  let me;
  try {
    me = signingIdentity(identity);
  } catch (e) {
    return { ok: false, error: (e && e.message) ? String(e.message) : 'could not load identity key' };
  }
  if (me.id === current.initiator.id || me.pubkeyHex === current.initiator.pubkeyHex) {
    return { ok: false, error: 'Cannot link a device to itself — use a different identity' };
  }
  let body;
  try {
    const linkMessage = buildDeviceLinkMessage(
      current.sessionId,
      current.nonce,
      current.initiator.id,
      me.id,
      current.label,
      current.origin
    );
    body = buildFabricIdentitySignedPayload(me.key, linkMessage, DEVICE_LINK_TAG);
  } catch (e) {
    return { ok: false, error: (e && e.message) ? String(e.message) : 'sign failed' };
  }
  const base = String(hubBase || '').replace(/\/$/, '');
  const res = await fetchImpl(`${base}/device-links/${encodeURIComponent(current.sessionId)}/signatures`, {
    method: 'POST',
    headers: deviceLinkHeaders(base),
    body: JSON.stringify({
      role: 'responder',
      signature: body.signature,
      pubkeyHex: body.pubkeyHex,
      identity: body.identity
    }),
    cache: 'no-store'
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.ok) {
    return { ok: false, error: (data && data.error) || `HTTP ${res.status}` };
  }
  return {
    ok: true,
    ...data,
    sessionId: current.sessionId,
    nonce: current.nonce,
    origin: current.origin,
    peerFabricId: current.initiator.id,
    peerXpub: current.initiator.xpub,
    peerPubkeyHex: current.initiator.pubkeyHex,
    label: current.label
  };
}

module.exports = {
  fetchPendingDeviceLink,
  completeDeviceLinkAsResponder,
  cancelDeviceLinkSession,
  buildDeviceLinkMessage,
  DEVICE_LINK_PREFIX,
  deviceLinkHeaders,
  keyFingerprint,
  signingIdentity
};
