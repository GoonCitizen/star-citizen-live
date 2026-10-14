'use strict';

/**
 * Presence client: Fabric-first, HTTP fallback.
 *
 * Desktop (electronAPI.fabric) reads/writes LiveRelay presence in-process —
 * no HTTP. Browser / hosted / Android keep GET|PUT `/presence` and
 * `/presence/roster` (thin clients have no Peer).
 */

const BASE = '/services/star-citizen';

function _fabricApi () {
  try {
    if (typeof window === 'undefined') return null;
    return (window.electronAPI && window.electronAPI.fabric) || null;
  } catch (_) {
    return null;
  }
}

function _headers (opts, json) {
  const headers = { Accept: 'application/json' };
  if (json) headers['Content-Type'] = 'application/json';
  if (opts.authToken) headers.Authorization = 'Bearer ' + opts.authToken;
  return headers;
}

async function _httpGet (urls, opts) {
  const fetchImpl = opts.fetchImpl || globalThis.fetch;
  if (!fetchImpl) return { ok: false, error: 'fetch unavailable' };
  for (const url of urls) {
    try {
      const res = await fetchImpl(url, {
        headers: _headers(opts, false),
        cache: 'no-store'
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        return { ok: true, data: data.data || data, transport: 'http', status: res.status };
      }
    } catch (_) { /* try next */ }
  }
  return { ok: false, error: 'presence unavailable', transport: 'http' };
}

async function _httpPut (urls, body, opts) {
  const fetchImpl = opts.fetchImpl || globalThis.fetch;
  if (!fetchImpl) return { ok: false, error: 'fetch unavailable' };
  let last = { ok: false, error: 'no origin', transport: 'http' };
  for (const url of urls) {
    try {
      const res = await fetchImpl(url, {
        method: 'PUT',
        headers: _headers(opts, true),
        body: JSON.stringify(body || {}),
        cache: 'no-store'
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        return { ok: true, data: data.data || data, transport: 'http', status: res.status };
      }
      last = {
        ok: false,
        error: (data && data.error) || ('HTTP ' + res.status),
        status: res.status,
        transport: 'http'
      };
    } catch (e) {
      last = { ok: false, error: e && e.message ? e.message : String(e), transport: 'http' };
    }
  }
  return last;
}

function _wrapFabric (out) {
  if (!out) return null;
  if (out.error) return { ok: false, error: out.error, transport: 'fabric' };
  const data = (out && out.data) || out;
  if (!data || typeof data !== 'object') return null;
  return { ok: true, data, transport: out.transport || 'fabric' };
}

async function tryFabricPresenceStatus () {
  const api = _fabricApi();
  if (!api || typeof api.presenceStatus !== 'function') return null;
  return _wrapFabric(await api.presenceStatus());
}

async function tryFabricPresenceRoster () {
  const api = _fabricApi();
  if (!api || typeof api.presenceRoster !== 'function') return null;
  return _wrapFabric(await api.presenceRoster());
}

async function tryFabricSetPresence (patch) {
  const api = _fabricApi();
  if (!api || typeof api.setPresence !== 'function') return null;
  return _wrapFabric(await api.setPresence(patch || {}));
}

async function tryFabricSetPresenceShip (body) {
  const api = _fabricApi();
  if (!api || typeof api.setPresenceShip !== 'function') return null;
  return _wrapFabric(await api.setPresenceShip(body || {}));
}

async function fetchPresence (opts = {}) {
  if (!opts.forceHttp) {
    const via = await tryFabricPresenceStatus();
    if (via) return via;
  }
  return _httpGet([`${BASE}/presence`, '/presence'], opts);
}

async function fetchPresenceRoster (opts = {}) {
  if (!opts.forceHttp) {
    const via = await tryFabricPresenceRoster();
    if (via) return via;
  }
  return _httpGet([`${BASE}/presence/roster`, '/presence/roster'], opts);
}

async function putPresence (patch, opts = {}) {
  if (!opts.forceHttp) {
    const via = await tryFabricSetPresence(patch);
    if (via) return via;
  }
  return _httpPut([`${BASE}/presence`, '/presence'], patch, opts);
}

async function putPresenceShip (body, opts = {}) {
  if (!opts.forceHttp) {
    const via = await tryFabricSetPresenceShip(body);
    if (via) return via;
  }
  return _httpPut([`${BASE}/presence/ship`, '/presence/ship'], body, opts);
}

module.exports = {
  fetchPresence,
  fetchPresenceRoster,
  putPresence,
  putPresenceShip,
  tryFabricPresenceStatus,
  tryFabricPresenceRoster,
  tryFabricSetPresence,
  tryFabricSetPresenceShip
};
