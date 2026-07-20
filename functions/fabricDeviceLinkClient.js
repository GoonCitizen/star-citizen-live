'use strict';

/**
 * GoonCitizen responder for Hub mutual device-link sessions.
 * Protocol must stay aligned with hub.fabric.pub/functions/fabricDeviceLink.js
 */

const Identity = require('@fabric/core/types/identity');
const { keyFromIdentity } = require('./identity');
const { fabricLoginRequestHeaders } = require('./fabricProtocolLogin');

const DEVICE_LINK_PREFIX = 'fabric:device-link:1';

function buildLinkMessage (nonce, initiatorId, responderId, label) {
  const safeLabel = String(label || 'device').replace(/:/g, '-').slice(0, 64);
  return `${DEVICE_LINK_PREFIX}:${nonce}:${initiatorId}:${responderId}:${safeLabel}`;
}

async function fetchPendingDeviceLink (hubBase, sessionId, opts = {}) {
  const fetchImpl = opts.fetchImpl || globalThis.fetch;
  const base = String(hubBase || '').replace(/\/$/, '');
  const res = await fetchImpl(`${base}/device-links/${encodeURIComponent(sessionId)}`, {
    headers: fabricLoginRequestHeaders(base),
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
  const key = keyFromIdentity(identity);
  const fabricIdent = new Identity(key);
  const responderId = String(fabricIdent.id);
  if (responderId === session.initiator.id) {
    return { ok: false, error: 'Cannot link a device to itself — use a different identity' };
  }
  const linkMessage = buildLinkMessage(
    session.nonce,
    session.initiator.id,
    responderId,
    session.label || 'device'
  );
  const signature = Buffer.from(key.signSchnorr(Buffer.from(linkMessage, 'utf8'))).toString('hex');
  const base = String(hubBase || '').replace(/\/$/, '');
  const res = await fetchImpl(`${base}/device-links/${encodeURIComponent(session.sessionId)}/signatures`, {
    method: 'POST',
    headers: fabricLoginRequestHeaders(base),
    body: JSON.stringify({
      role: 'responder',
      signature,
      pubkeyHex: key.pubkey,
      identity: { id: responderId, xpub: key.xpub }
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
    label: session.label
  };
}

module.exports = {
  fetchPendingDeviceLink,
  completeDeviceLinkAsResponder,
  buildLinkMessage,
  DEVICE_LINK_PREFIX
};
