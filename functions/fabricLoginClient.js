'use strict';

/**
 * Client helpers for Fabric **player** login (client-signed sessions).
 * Used by Electron main to fetch a pending challenge and POST a Schnorr signature.
 */

const Identity = require('@fabric/core/types/identity');
const { keyFromIdentity } = require('./identity');
const { fabricLoginRequestHeaders } = require('./fabricProtocolLogin');

/**
 * @param {string} hubBase
 * @param {string} sessionId
 * @param {{ fetchImpl?: typeof fetch }} [opts]
 * @returns {Promise<{ ok: true, origin: string, message: string, nonce: string } | { ok: false, error: string, status?: number }>}
 */
async function fetchPendingLoginSession (hubBase, sessionId, opts = {}) {
  const fetchImpl = opts.fetchImpl || globalThis.fetch;
  if (typeof fetchImpl !== 'function') {
    return { ok: false, error: 'fetch is not available' };
  }
  const base = String(hubBase || '').replace(/\/$/, '');
  const url = `${base}/sessions/${encodeURIComponent(sessionId)}`;
  let res;
  try {
    res = await fetchImpl(url, {
      method: 'GET',
      headers: fabricLoginRequestHeaders(base),
      cache: 'no-store'
    });
  } catch (e) {
    return { ok: false, error: (e && e.message) ? String(e.message) : 'fetch failed' };
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data || data.status !== 'pending') {
    return {
      ok: false,
      status: res.status,
      error: (data && data.error) ? String(data.error) : `session not pending (HTTP ${res.status})`
    };
  }
  const origin = typeof data.origin === 'string' ? data.origin : '';
  const message = typeof data.message === 'string' ? data.message : '';
  const nonce = typeof data.nonce === 'string' ? data.nonce : '';
  if (!message) return { ok: false, error: 'pending session missing message' };
  return { ok: true, origin, message, nonce, sessionId };
}

/**
 * Sign the challenge with the unlocked identity and POST to the site.
 * @param {object} identity Decrypted identity with xprv/mnemonic
 * @param {string} hubBase
 * @param {string} sessionId
 * @param {string} message Server challenge (must match pending session)
 * @param {{ fetchImpl?: typeof fetch }} [opts]
 */
async function completeClientSignedLogin (identity, hubBase, sessionId, message, opts = {}) {
  const fetchImpl = opts.fetchImpl || globalThis.fetch;
  if (typeof fetchImpl !== 'function') {
    return { ok: false, error: 'fetch is not available' };
  }
  if (!identity) return { ok: false, error: 'Identity is locked — unlock before approving site login.' };
  if (typeof message !== 'string' || !message) return { ok: false, error: 'message required' };

  let key;
  let fabricIdent;
  try {
    key = keyFromIdentity(identity);
    fabricIdent = new Identity(key);
  } catch (e) {
    return { ok: false, error: (e && e.message) ? String(e.message) : 'could not load identity key' };
  }

  let signature;
  try {
    signature = Buffer.from(key.signSchnorr(Buffer.from(message, 'utf8'))).toString('hex');
  } catch (e) {
    return { ok: false, error: (e && e.message) ? String(e.message) : 'sign failed' };
  }

  const base = String(hubBase || '').replace(/\/$/, '');
  const url = `${base}/sessions/${encodeURIComponent(sessionId)}/signatures`;
  const body = {
    signature,
    pubkeyHex: key.pubkey,
    identity: {
      id: fabricIdent.id,
      xpub: key.xpub
    }
  };

  let res;
  try {
    res = await fetchImpl(url, {
      method: 'POST',
      headers: fabricLoginRequestHeaders(base),
      body: JSON.stringify(body),
      cache: 'no-store'
    });
  } catch (e) {
    return { ok: false, error: (e && e.message) ? String(e.message) : 'POST signatures failed' };
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data || !data.ok) {
    return {
      ok: false,
      status: res.status,
      error: (data && data.error) ? String(data.error) : `signature rejected (HTTP ${res.status})`
    };
  }
  return {
    ok: true,
    sessionId,
    signer: data.signer || 'client',
    identity: data.identity || body.identity,
    pubkeyHex: data.pubkeyHex || key.pubkey
  };
}

module.exports = {
  fetchPendingLoginSession,
  completeClientSignedLogin
};
