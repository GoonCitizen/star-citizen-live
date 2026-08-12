'use strict';

/**
 * LiveRelay site-login — `@fabric/http` tryHandle with GC bearer issuance.
 */

const crypto = require('crypto');
const siteLogin = require('@fabric/http/functions/fabricSiteLogin');

const BEARER_TTL_MS = 24 * 60 * 60 * 1000;

async function tryHandleSiteLogin (relay, req, res, pathname, readBody) {
  if (!pathname.startsWith('/sessions')) return false;

  // Wrap issueBearer into completeSession via a thin local adapter for GC sessions map.
  if (!relay._siteLoginSessions) {
    relay._siteLoginSessions = siteLogin.createSiteLoginStore();
  }

  const send = (status, json) => {
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(json));
  };

  if (req.method === 'GET' && pathname === '/sessions') {
    const accept = String((req.headers && req.headers.accept) || '');
    if (accept.includes('application/json') && !accept.includes('text/html')) {
      send(404, { ok: false, error: 'use POST /sessions to create a login session' });
      return true;
    }
    return 'spa';
  }

  if (req.method === 'POST' && pathname === '/sessions') {
    const body = await readBody();
    const out = siteLogin.createSession(req, body, relay._siteLoginSessions);
    send(out.status, out.json);
    return true;
  }

  let m = pathname.match(/^\/sessions\/([^/]+)\/signatures$/);
  if (req.method === 'POST' && m) {
    const body = await readBody();
    const out = siteLogin.completeSession(req, m[1], body, relay._siteLoginSessions, {
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
    const out = siteLogin.getSession(req, m[1], relay._siteLoginSessions);
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
  SESSION_TTL_MS: siteLogin.SESSION_TTL_MS,
  createSiteLoginStore: siteLogin.createSiteLoginStore,
  createSession: siteLogin.createSession,
  getSession: siteLogin.getSession,
  completeSession: siteLogin.completeSession,
  hasClientSignatureBody: siteLogin.hasClientSignatureBody,
  clientMayPollDesktopSession: siteLogin.clientMayPollDesktopSession,
  tryHandleSiteLogin,
  buildLoginMessage: siteLogin.buildLoginMessage,
  randomSessionId: siteLogin.randomSessionId,
  randomNonce: siteLogin.randomNonce,
  isLocalRequest: siteLogin.isLocalRequest,
  isLoopbackHostname: siteLogin.isLoopbackHostname
};
