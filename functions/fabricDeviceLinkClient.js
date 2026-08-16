'use strict';

/**
 * GoonCitizen responder for Hub mutual device-link sessions.
 * Protocol must stay aligned with hub.fabric.pub/functions/fabricDeviceLink.js
 */

const { keyFromIdentity } = require('./identity');
const { deviceLinkHeaders } = require('@fabric/http/functions/fabricDeviceLinkClient');
const {
  buildFabricIdentitySignedPayload
} = require('@fabric/http/functions/fabricSiteLoginVerify');
const {
  DEVICE_LINK_PREFIX,
  buildDeviceLinkMessage
} = require('@fabric/http/functions/fabricDeviceLinkMessages');

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
      headers: deviceLinkHeaders(origin),
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

async function fetchPendingDeviceLink (hubBase, sessionId, opts = {}) {
  const fetchImpl = opts.fetchImpl || globalThis.fetch;
  const base = String(hubBase || '').replace(/\/$/, '');
  const res = await fetchImpl(`${base}/device-links/${encodeURIComponent(sessionId)}`, {
    headers: deviceLinkHeaders(base),
    cache: 'no-store'
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.ok) {
    return { ok: false, error: (data && data.error) || `HTTP ${res.status}`, status: res.status };
  }
  return { ok: true, ...data };
}

/**
 * Sign as responder and POST to Hub.
 */
async function completeDeviceLinkAsResponder (identity, hubBase, session, opts = {}) {
  const fetchImpl = opts.fetchImpl || globalThis.fetch;
  if (!identity) return { ok: false, error: 'Identity is locked' };
  if (!session || session.status !== 'pending' || !session.initiator) {
    return { ok: false, error: 'device link is not pending' };
  }
  let key;
  try {
    key = keyFromIdentity(identity);
  } catch (e) {
    return { ok: false, error: (e && e.message) ? String(e.message) : 'could not load identity key' };
  }

  // Probe Fabric protocol id (same helper Hub verify uses).
  let responderId;
  try {
    responderId = buildFabricIdentitySignedPayload(key, 'fabric:device-link:id-probe').identity.id;
  } catch (e) {
    return { ok: false, error: (e && e.message) ? String(e.message) : 'could not derive Fabric identity' };
  }
  if (responderId === session.initiator.id) {
    return { ok: false, error: 'Cannot link a device to itself — use a different identity' };
  }
  const linkMessage = buildDeviceLinkMessage(
    session.nonce,
    session.initiator.id,
    responderId,
    session.label || 'device'
  );
  let body;
  try {
    body = buildFabricIdentitySignedPayload(key, linkMessage);
  } catch (e) {
    return { ok: false, error: (e && e.message) ? String(e.message) : 'sign failed' };
  }
  const base = String(hubBase || '').replace(/\/$/, '');
  const res = await fetchImpl(`${base}/device-links/${encodeURIComponent(session.sessionId)}/signatures`, {
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
    peerFabricId: session.initiator.id,
    peerXpub: session.initiator.xpub,
    peerPubkeyHex: (session.initiator && session.initiator.pubkeyHex) || null,
    label: session.label
  };
}

module.exports = {
  fetchPendingDeviceLink,
  completeDeviceLinkAsResponder,
  cancelDeviceLinkSession,
  buildLinkMessage: buildDeviceLinkMessage,
  buildDeviceLinkMessage,
  DEVICE_LINK_PREFIX,
  deviceLinkHeaders
};
