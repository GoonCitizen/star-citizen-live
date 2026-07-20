'use strict';

/**
 * Fabric site-login sessions for LiveRelay (D-011).
 * Hosts the same REST contract as Hub `POST|GET /sessions` so Passport and
 * GoonCitizen desktop can sign in when this service is deployed alone
 * (e.g. relay.goon.vc). Client-signed completions only — no Hub-node self-sign.
 */

const crypto = require('crypto');
const {
  buildLoginMessage,
  verifyFabricDesktopLoginSignedPayload,
  originsMatchForDesktopSession,
  isLoopbackHostname
} = require('./fabricSiteLoginVerify');

const SESSION_TTL_MS = 10 * 60 * 1000;
const MAX_PENDING = 256;
const BEARER_TTL_MS = 24 * 60 * 60 * 1000;

function randomSessionId () {
  return crypto.randomBytes(24).toString('hex');
}

function randomNonce () {
  return crypto.randomBytes(32).toString('hex');
}

function hasClientSignatureBody (body) {
  if (!body || typeof body !== 'object') return false;
  if (typeof body.signature !== 'string' || !/^[a-f0-9]{128}$/i.test(body.signature.trim())) return false;
  if (typeof body.pubkeyHex !== 'string' || !/^[a-f0-9]{66}$/i.test(body.pubkeyHex.trim())) return false;
  const identity = body.identity;
  if (!identity || typeof identity !== 'object') return false;
  if (typeof identity.xpub !== 'string' || !identity.xpub.trim()) return false;
  return true;
}

function isLocalRequest (req) {
  const addr = (req.socket && req.socket.remoteAddress)
    || (req.connection && req.connection.remoteAddress)
    || '';
  return addr === '127.0.0.1' || addr === '::1' || addr === '::ffff:127.0.0.1';
}

function refererOriginMatchesSession (referer, sessionOrigin) {
  if (typeof referer !== 'string' || !referer) return false;
  try {
    const u = new URL(referer);
    return originsMatchForDesktopSession(`${u.protocol}//${u.host}`, sessionOrigin);
  } catch (_) {
    return false;
  }
}

function hostHeaderMatchesSessionOrigin (requestHost, sessionOrigin) {
  if (!requestHost || !sessionOrigin) return false;
  try {
    const sessionUrl = new URL(sessionOrigin);
    if (requestHost === sessionUrl.host) return true;
    const pseudo = `${sessionUrl.protocol}//${requestHost}`;
    return originsMatchForDesktopSession(pseudo, sessionOrigin);
  } catch (_) {
    return false;
  }
}

function clientMayPollDesktopSession (req, sessionOrigin) {
  if (isLocalRequest(req)) return true;
  if (!sessionOrigin || typeof sessionOrigin !== 'string') return false;
  try {
    // eslint-disable-next-line no-new
    new URL(sessionOrigin);
  } catch (_) {
    return false;
  }
  const hdrOrigin = req.headers && req.headers.origin;
  if (typeof hdrOrigin === 'string' && originsMatchForDesktopSession(hdrOrigin, sessionOrigin)) return true;
  const ref = req.headers && req.headers.referer;
  if (refererOriginMatchesSession(ref, sessionOrigin)) return true;
  const sfs = req.headers && String(req.headers['sec-fetch-site'] || '').toLowerCase();
  if (sfs === 'same-origin' || sfs === 'same-site') {
    const host = req.headers && req.headers.host;
    if (host && hostHeaderMatchesSessionOrigin(host, sessionOrigin)) return true;
  }
  return false;
}

function createSiteLoginStore () {
  return new Map();
}

function pruneSessions (store) {
  if (!store) return;
  const now = Date.now();
  for (const [id, s] of store) {
    if (!s || now - s.createdAt > SESSION_TTL_MS) store.delete(id);
  }
  while (store.size > MAX_PENDING) {
    const first = store.keys().next().value;
    store.delete(first);
  }
}

/**
 * @param {import('http').IncomingMessage} req
 * @param {object} body
 * @param {Map} store
 */
function createSession (req, body, store) {
  pruneSessions(store);
  let origin = body && typeof body.origin === 'string' ? body.origin.trim() : '';
  if (!origin) {
    const ref = req.headers && req.headers.referer;
    if (typeof ref === 'string' && ref) {
      try {
        const u = new URL(ref);
        origin = `${u.protocol}//${u.host}`;
      } catch (_) {}
    }
  }
  if (!origin) {
    return { status: 400, json: { ok: false, error: 'origin required (body.origin or Referer)' } };
  }
  try {
    // eslint-disable-next-line no-new
    new URL(origin);
  } catch (_) {
    return { status: 400, json: { ok: false, error: 'invalid origin' } };
  }

  if (!isLocalRequest(req) && !clientMayPollDesktopSession(req, origin)) {
    return {
      status: 403,
      json: {
        ok: false,
        error: 'declared origin does not match this request (Origin, Referer, or same-site Host)'
      }
    };
  }

  const sessionId = randomSessionId();
  const nonce = randomNonce();
  const message = buildLoginMessage(sessionId, origin, nonce);
  store.set(sessionId, {
    origin,
    nonce,
    message,
    createdAt: Date.now(),
    status: 'pending'
  });

  return {
    status: 200,
    json: {
      ok: true,
      sessionId,
      message,
      nonce,
      protocolUrl: `fabric://login?sessionId=${encodeURIComponent(sessionId)}&hub=${encodeURIComponent(origin)}`,
      signingModes: ['client'],
      acceptsClientSignature: true
    }
  };
}

/**
 * @param {import('http').IncomingMessage} req
 * @param {string} sessionId
 * @param {Map} store
 */
function getSession (req, sessionId, store) {
  pruneSessions(store);
  const id = String(sessionId || '').trim();
  if (!id) {
    return { status: 400, json: { ok: false, error: 'sessionId required' } };
  }

  const session = store.get(id);
  if (!session) {
    return { status: 404, json: { ok: false, error: 'unknown or expired session' } };
  }

  if (!clientMayPollDesktopSession(req, session.origin)) {
    return { status: 403, json: { ok: false, error: 'origin does not match this session' } };
  }

  if (session.status === 'pending') {
    return {
      status: 200,
      json: {
        ok: true,
        status: 'pending',
        kind: 'desktop_login',
        sessionId: id,
        origin: session.origin,
        message: session.message,
        nonce: session.nonce,
        createdAt: session.createdAt,
        signingModes: ['client'],
        acceptsClientSignature: true
      }
    };
  }

  if (session.status === 'signed') {
    const payload = {
      ok: true,
      status: 'signed',
      signer: session.signer || 'client',
      identity: session.identity,
      delegationToken: session.delegationToken,
      signature: session.signature,
      pubkeyHex: session.pubkeyHex,
      message: session.message
    };
    store.delete(id);
    return { status: 200, json: payload };
  }

  return { status: 200, json: { ok: true, status: session.status || 'unknown' } };
}

/**
 * Complete with a client Schnorr signature. Optionally registers a Bearer
 * token on the LiveRelay instance for server-mode API auth.
 *
 * @param {import('http').IncomingMessage} req
 * @param {string} sessionId
 * @param {object} body
 * @param {Map} store
 * @param {{ issueBearer?: (pubkeyHex: string) => string }} [opts]
 */
function completeSession (req, sessionId, body, store, opts = {}) {
  pruneSessions(store);
  const id = String(sessionId || '').trim();
  if (!id) {
    return { status: 400, json: { ok: false, error: 'sessionId required in path' } };
  }

  const session = store.get(id);
  if (!session || session.status !== 'pending') {
    return { status: 404, json: { ok: false, error: 'unknown or expired session' } };
  }

  if (!hasClientSignatureBody(body)) {
    return {
      status: 400,
      json: {
        ok: false,
        error: 'client signature required: { signature, pubkeyHex, identity: { id, xpub } }'
      }
    };
  }

  // Always verify against the server-held challenge — never trust a client `message`.
  const payload = {
    signature: String(body.signature).trim(),
    pubkeyHex: String(body.pubkeyHex).trim(),
    message: session.message,
    identity: {
      id: body.identity.id != null ? body.identity.id : null,
      xpub: String(body.identity.xpub).trim()
    }
  };
  const verified = verifyFabricDesktopLoginSignedPayload(payload, {
    sessionId: id,
    origin: session.origin
  });
  if (!verified.ok) {
    return { status: 400, json: { ok: false, error: verified.error || 'invalid client signature' } };
  }

  session.status = 'signed';
  session.signedAt = Date.now();
  session.signer = 'client';
  session.signature = payload.signature.toLowerCase();
  session.pubkeyHex = payload.pubkeyHex.toLowerCase();
  session.identity = {
    id: payload.identity.id != null ? String(payload.identity.id) : null,
    xpub: payload.identity.xpub
  };

  let delegationToken = null;
  if (typeof opts.issueBearer === 'function') {
    try {
      delegationToken = opts.issueBearer(session.pubkeyHex);
    } catch (_) {
      delegationToken = null;
    }
  }
  if (!delegationToken) {
    delegationToken = crypto.randomBytes(24).toString('hex');
  }
  session.delegationToken = delegationToken;

  return {
    status: 200,
    json: {
      ok: true,
      sessionId: id,
      signer: 'client',
      signature: session.signature,
      pubkeyHex: session.pubkeyHex,
      message: session.message,
      identity: session.identity,
      delegationToken
    }
  };
}

/**
 * Try to handle `/sessions` routes. Returns true if the response was sent.
 *
 * @param {object} relay LiveRelay instance (`_siteLoginSessions`, `_sessions`)
 * @param {import('http').IncomingMessage} req
 * @param {import('http').ServerResponse} res
 * @param {string} pathname
 * @param {() => Promise<object>} readBody
 */
async function tryHandleSiteLogin (relay, req, res, pathname, readBody) {
  if (!pathname.startsWith('/sessions')) return false;

  if (!relay._siteLoginSessions) {
    relay._siteLoginSessions = createSiteLoginStore();
  }

  const send = (status, json) => {
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(json));
  };

  // GET /sessions — login UI (same dashboard; SiteLogin in the header).
  if (req.method === 'GET' && pathname === '/sessions') {
    const accept = String((req.headers && req.headers.accept) || '');
    if (accept.includes('application/json') && !accept.includes('text/html')) {
      send(404, { ok: false, error: 'use POST /sessions to create a login session' });
      return true;
    }
    // Fall through: caller should serve the SPA. Signal with a special return.
    return 'spa';
  }

  if (req.method === 'POST' && pathname === '/sessions') {
    const body = await readBody();
    const out = createSession(req, body, relay._siteLoginSessions);
    send(out.status, out.json);
    return true;
  }

  let m = pathname.match(/^\/sessions\/([^/]+)\/signatures$/);
  if (req.method === 'POST' && m) {
    const body = await readBody();
    const out = completeSession(req, m[1], body, relay._siteLoginSessions, {
      issueBearer: (pubkeyHex) => {
        const token = crypto.randomBytes(24).toString('hex');
        if (!relay._sessions) relay._sessions = {};
        relay._sessions[token] = {
          token,
          pubkey: pubkeyHex,
          createdAt: Date.now(),
          expiresAt: Date.now() + BEARER_TTL_MS,
          via: 'fabric-site-login'
        };
        const keys = Object.keys(relay._sessions);
        if (keys.length > 5000) delete relay._sessions[keys[0]];
        return token;
      }
    });
    send(out.status, out.json);
    return true;
  }

  m = pathname.match(/^\/sessions\/([^/]+)$/);
  if (req.method === 'GET' && m) {
    const out = getSession(req, m[1], relay._siteLoginSessions);
    send(out.status, out.json);
    return true;
  }

  if (pathname === '/sessions' || pathname.startsWith('/sessions/')) {
    send(404, { ok: false, error: 'Not found', path: pathname });
    return true;
  }

  return false;
}

module.exports = {
  SESSION_TTL_MS,
  createSiteLoginStore,
  createSession,
  getSession,
  completeSession,
  hasClientSignatureBody,
  clientMayPollDesktopSession,
  tryHandleSiteLogin,
  // re-exports for tests
  buildLoginMessage,
  randomSessionId,
  randomNonce,
  isLocalRequest,
  isLoopbackHostname
};
