'use strict';

/**
 * Verify client-signed Fabric site-login completions (D-011).
 * Same challenge format as Hub `fabric:hub-login:1` so Passport and GoonCitizen
 * desktop stay interchangeable against LiveRelay on relay.goon.vc.
 */

const Key = require('@fabric/core/types/key');
const Identity = require('@fabric/core/types/identity');

const DESKTOP_LOGIN_PREFIX = 'fabric:hub-login:1';

function isLoopbackHostname (h) {
  if (typeof h !== 'string') return false;
  const x = h.toLowerCase();
  return x === 'localhost' || x === '127.0.0.1' || x === '[::1]' || x === '::1';
}

function originsMatchForDesktopSession (clientOriginLike, sessionOrigin) {
  if (!clientOriginLike || !sessionOrigin) return false;
  if (clientOriginLike === sessionOrigin) return true;
  let clientUrl;
  let sessionUrl;
  try {
    clientUrl = new URL(clientOriginLike);
    sessionUrl = new URL(sessionOrigin);
  } catch (_) {
    return false;
  }
  if (clientUrl.protocol !== sessionUrl.protocol) return false;
  const cLoop = isLoopbackHostname(clientUrl.hostname);
  const sLoop = isLoopbackHostname(sessionUrl.hostname);
  if (cLoop && sLoop) {
    const cPort = clientUrl.port || (clientUrl.protocol === 'https:' ? '443' : '80');
    const sPort = sessionUrl.port || (sessionUrl.protocol === 'https:' ? '443' : '80');
    return cPort === sPort;
  }
  return clientUrl.host === sessionUrl.host;
}

function parseDesktopLoginMessage (msg) {
  const prefix = `${DESKTOP_LOGIN_PREFIX}:`;
  const s = String(msg || '');
  if (!s.startsWith(prefix)) return null;
  const rest = s.slice(prefix.length);
  const nonce = rest.slice(0, 64);
  if (!/^[a-f0-9]{64}$/i.test(nonce) || rest[64] !== ':') return null;
  const afterNonce = rest.slice(65);
  const sessionId = afterNonce.slice(0, 48);
  if (!/^[a-f0-9]{48}$/i.test(sessionId) || afterNonce[48] !== ':') return null;
  const origin = afterNonce.slice(49);
  if (!origin) return null;
  return { nonce, sessionId, origin };
}

function buildLoginMessage (sessionId, origin, nonce) {
  return `${DESKTOP_LOGIN_PREFIX}:${nonce}:${sessionId}:${origin}`;
}

/**
 * @param {object} payload
 * @param {{ sessionId: string, origin: string }} expected
 * @returns {{ ok: true }|{ ok: false, error: string }}
 */
function verifyFabricDesktopLoginSignedPayload (payload, expected) {
  if (!payload || typeof payload !== 'object') {
    return { ok: false, error: 'Invalid login payload' };
  }
  const signature = payload.signature;
  const pubkeyHex = payload.pubkeyHex;
  const message = payload.message;
  const identity = payload.identity;
  if (!identity || typeof identity !== 'object' || !identity.xpub) {
    return { ok: false, error: 'Missing identity xpub' };
  }
  if (typeof message !== 'string' || !message) {
    return { ok: false, error: 'Missing signed message' };
  }
  if (typeof signature !== 'string' || !/^[a-f0-9]{128}$/i.test(signature)) {
    return { ok: false, error: 'Missing or invalid signature' };
  }
  if (typeof pubkeyHex !== 'string' || !/^[a-f0-9]{66}$/i.test(pubkeyHex)) {
    return { ok: false, error: 'Missing or invalid pubkey' };
  }

  let key;
  try {
    key = new Key({ xpub: identity.xpub });
  } catch (_) {
    return { ok: false, error: 'Invalid xpub in login response' };
  }

  const msgBuf = Buffer.from(message, 'utf8');
  let sigBuf;
  try {
    sigBuf = Buffer.from(signature, 'hex');
  } catch (_) {
    return { ok: false, error: 'Invalid signature encoding' };
  }

  if (!key.verifySchnorr(msgBuf, sigBuf)) {
    return { ok: false, error: 'Signature verification failed' };
  }

  const compressedPub = String(key.pubkey || '').toLowerCase();
  if (compressedPub !== String(pubkeyHex).toLowerCase()) {
    return { ok: false, error: 'Public key does not match xpub' };
  }

  let ident;
  try {
    ident = new Identity(key);
  } catch (_) {
    return { ok: false, error: 'Could not derive identity from xpub' };
  }

  const claimedId = identity.id != null ? String(identity.id).trim() : '';
  if (!claimedId || String(ident.id) !== claimedId) {
    return { ok: false, error: 'Identity id does not match xpub' };
  }

  const exp = expected && typeof expected === 'object' ? expected : {};
  const wantSid = exp.sessionId != null ? String(exp.sessionId).trim() : '';
  const wantOrigin = exp.origin != null ? String(exp.origin).trim() : '';
  if (wantSid && wantOrigin) {
    const parsed = parseDesktopLoginMessage(message);
    if (!parsed) {
      return { ok: false, error: 'Signed message format is invalid' };
    }
    if (parsed.sessionId.toLowerCase() !== wantSid.toLowerCase()) {
      return { ok: false, error: 'Login session does not match' };
    }
    if (!originsMatchForDesktopSession(parsed.origin, wantOrigin)) {
      return { ok: false, error: 'Login origin does not match this page' };
    }
  }

  return { ok: true };
}

module.exports = {
  DESKTOP_LOGIN_PREFIX,
  buildLoginMessage,
  parseDesktopLoginMessage,
  verifyFabricDesktopLoginSignedPayload,
  originsMatchForDesktopSession,
  isLoopbackHostname
};
