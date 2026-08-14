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
  buildLinkMessage: buildDeviceLinkMessage,
  buildDeviceLinkMessage,
  DEVICE_LINK_PREFIX,
  deviceLinkHeaders
};
