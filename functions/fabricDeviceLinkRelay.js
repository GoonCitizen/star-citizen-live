'use strict';

/**
 * LiveRelay adapter for `@fabric/http` device-link HTTP (Express-style
 * handlers) onto the raw Node `http` server used by GoonCitizen.
 */

const { mountFabricDeviceLinkHttp } = require('@fabric/http/functions/fabricDeviceLinkHttp');

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
    return false;
  });
  if (!route) {
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

module.exports = {
  tryHandleDeviceLink,
  ensureMounted
};
