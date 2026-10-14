'use strict';

/**
 * LiveRelay adapter for `@fabric/http` device-link HTTP (Express-style
 * handlers) onto the raw Node `http` server used by GoonCitizen.
 */

const {
  mountFabricDeviceLinkHttp,
  pruneDeviceLinkSessions,
  clientMayAccessDeviceLink
} = require('@fabric/http/functions/fabricDeviceLinkHttp');
const { isLocalRequest } = require('@fabric/http/functions/fabricSiteLoginVerify');

function wrapRes (res) {
  const wrapped = {
    _status: 200,
    setHeader (name, value) {
      res.setHeader(name, value);
    },
    status (code) {
      this._status = code;
      return this;
    },
    send (body) {
      const status = this._status || 200;
      if (!res.headersSent) {
        res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
      }
      res.end(typeof body === 'string' ? body : JSON.stringify(body));
    }
  };
  return wrapped;
}

function matchRoute (method, pathname) {
  if (method === 'POST' && pathname === '/device-links') {
    return { name: 'create', params: {} };
  }
  let m = pathname.match(/^\/device-links\/([^/]+)\/signatures$/);
  if (method === 'POST' && m) {
    return { name: 'sign', params: { sessionId: decodeURIComponent(m[1]) } };
  }
  m = pathname.match(/^\/device-links\/([^/]+)$/);
  if (method === 'GET' && m) {
    return { name: 'get', params: { sessionId: decodeURIComponent(m[1]) } };
  }
  if (method === 'DELETE' && m) {
    return { name: 'cancel', params: { sessionId: decodeURIComponent(m[1]) } };
  }
  return null;
}

function ensureMounted (relay) {
  if (relay._deviceLinkHttp) return relay._deviceLinkHttp;
  if (!relay._deviceLinkSessions) relay._deviceLinkSessions = new Map();
  const routes = [];
  const hub = {
    _deviceLinkSessions: relay._deviceLinkSessions,
    http: {
      _addRoute (method, path, fn) {
        routes.push({ method, path, fn });
      }
    }
  };
  mountFabricDeviceLinkHttp(hub);
  relay._deviceLinkSessions = hub._deviceLinkSessions;
  relay._deviceLinkHttp = { hub, routes };
  return relay._deviceLinkHttp;
}

/**
 * @returns {Promise<boolean>}
 */
async function tryHandleDeviceLink (relay, req, res, pathname, readBody) {
  if (!pathname.startsWith('/device-links')) return false;
  const hit = matchRoute(req.method, pathname);
  if (!hit) {
    res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ ok: false, error: 'Not found', path: pathname }));
    return true;
  }
  const mounted = ensureMounted(relay);
  const route = mounted.routes.find((r) => {
    if (hit.name === 'create') return r.method === 'POST' && r.path === '/device-links';
    if (hit.name === 'sign') {
      return r.method === 'POST' && String(r.path).includes('/signatures');
    }
    if (hit.name === 'get') {
      return r.method === 'GET' && String(r.path).includes(':sessionId') &&
        !String(r.path).includes('signatures');
    }
    if (hit.name === 'cancel') {
      return r.method === 'DELETE' && String(r.path).includes(':sessionId') &&
        !String(r.path).includes('signatures');
    }
    return false;
  });
  if (!route) {
    if (hit.name === 'cancel') {
      cancelDeviceLinkFallback(relay, req, res, hit.params.sessionId);
      return true;
    }
    res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ ok: false, error: 'device-link route missing' }));
    return true;
  }
  let parsed = {};
  if (req.method === 'POST') {
    parsed = await readBody();
    if (!parsed || typeof parsed !== 'object') parsed = {};
  }
  const fakeReq = Object.assign(req, {
    body: parsed,
    params: hit.params
  });
  route.fn(fakeReq, wrapRes(res));
  return true;
}

function cancelDeviceLinkFallback (relay, req, res, sessionId) {
  if (!relay._deviceLinkSessions) relay._deviceLinkSessions = new Map();
  pruneDeviceLinkSessions(relay);
  const wrapped = wrapRes(res);
  const sid = String(sessionId || '').trim();
  if (!sid) {
    wrapped.status(400).send({ ok: false, error: 'sessionId required' });
    return;
  }
  const session = relay._deviceLinkSessions.get(sid);
  if (!session) {
    wrapped.status(200).send({ ok: true, cancelled: true, existed: false });
    return;
  }
  if (!isLocalRequest(req) && !clientMayAccessDeviceLink(req, session.origin)) {
    wrapped.status(403).send({ ok: false, error: 'origin does not match this session' });
    return;
  }
  if (session.status === 'linked') {
    wrapped.status(409).send({ ok: false, error: 'device link is already complete' });
    return;
  }
  relay._deviceLinkSessions.delete(sid);
  wrapped.status(200).send({ ok: true, cancelled: true, existed: true });
}

module.exports = {
  tryHandleDeviceLink,
  ensureMounted
};
