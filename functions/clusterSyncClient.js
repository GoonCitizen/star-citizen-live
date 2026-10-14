'use strict';

/**
 * Cluster sync HTTP client (GET/POST `/identity/cluster/sync`).
 * Loopback dashboard uses the session cookie / no Bearer; hosted SPA may pass
 * `authToken` from the site-login store.
 */

function _bases (origin) {
  const base = String(origin || '').replace(/\/$/, '');
  return [
    `${base}/identity/cluster/sync`,
    `${base}/services/star-citizen/identity/cluster/sync`
  ];
}

function _headers (opts, json) {
  const headers = { Accept: 'application/json' };
  if (json) headers['Content-Type'] = 'application/json';
  const token = opts.authToken || _storedToken();
  if (token) headers.Authorization = 'Bearer ' + token;
  return headers;
}

function _storedToken () {
  try {
    if (typeof localStorage === 'undefined') return null;
    for (const key of ['fabric.identity.session', 'fabric.delegation']) {
      const raw = localStorage.getItem(key);
      if (!raw) continue;
      const parsed = JSON.parse(raw);
      const token = parsed && (parsed.token || parsed.delegationToken);
      if (token) return String(token);
    }
  } catch (_) { /* ignore */ }
  return null;
}

async function _get (origin, opts = {}) {
  const fetchImpl = opts.fetchImpl || globalThis.fetch;
  if (!fetchImpl) return { ok: false, error: 'fetch unavailable' };
  let last = { ok: false, error: 'cluster sync unavailable' };
  for (const url of _bases(origin)) {
    try {
      const res = await fetchImpl(url, {
        headers: _headers(opts, false),
        cache: 'no-store'
      });
      const body = await res.json().catch(() => ({}));
      if (res.status === 401) {
        return { ok: false, unauthorized: true, error: 'sign in required', status: 401 };
      }
      if (res.ok) {
        return {
          ok: true,
          data: body.data || body,
          type: body.type || 'ClusterSync',
          transport: 'http',
          status: res.status
        };
      }
      last = {
        ok: false,
        error: (body && body.error) || ('HTTP ' + res.status),
        status: res.status
      };
    } catch (e) {
      last = { ok: false, error: e && e.message ? e.message : String(e) };
    }
  }
  return last;
}

async function _post (origin, payload, opts = {}) {
  const fetchImpl = opts.fetchImpl || globalThis.fetch;
  if (!fetchImpl) return { ok: false, error: 'fetch unavailable' };
  let last = { ok: false, error: 'cluster sync unavailable' };
  for (const url of _bases(origin)) {
    try {
      const res = await fetchImpl(url, {
        method: 'POST',
        headers: _headers(opts, true),
        body: JSON.stringify(payload || {}),
        cache: 'no-store'
      });
      const body = await res.json().catch(() => ({}));
      if (res.status === 401) {
        return { ok: false, unauthorized: true, error: 'sign in required', status: 401 };
      }
      if (res.ok) {
        return {
          ok: true,
          data: body.data || body,
          type: body.type || 'ClusterSync',
          transport: 'http',
          status: res.status
        };
      }
      last = {
        ok: false,
        error: (body && body.error) || ('HTTP ' + res.status),
        status: res.status
      };
    } catch (e) {
      last = { ok: false, error: e && e.message ? e.message : String(e) };
    }
  }
  return last;
}

/**
 * @param {string} [origin]
 * @param {Object} [opts]
 * @returns {Promise<object>}
 */
function fetchClusterSync (origin, opts = {}) {
  const href = origin || (typeof window !== 'undefined' && window.location && window.location.origin) || '';
  return _get(href, opts);
}

/**
 * Ask this node to re-publish DeviceDataShare and re-dial siblings.
 * @param {string} [origin]
 * @param {Object} [opts]
 * @returns {Promise<object>}
 */
function publishClusterSync (origin, opts = {}) {
  const href = origin || (typeof window !== 'undefined' && window.location && window.location.origin) || '';
  const body = opts.body && typeof opts.body === 'object' ? opts.body : { publish: true };
  return _post(href, body, opts);
}

function meshClusterSync (origin, opts = {}) {
  return publishClusterSync(origin, Object.assign({}, opts, { body: { mesh: true } }));
}

function dialClusterSync (origin, addresses, opts = {}) {
  return publishClusterSync(origin, Object.assign({}, opts, {
    body: { dial: Array.isArray(addresses) ? addresses : [], pubkey: opts.pubkey || null }
  }));
}

function nudgeCrossSign (origin, opts = {}) {
  return publishClusterSync(origin, Object.assign({}, opts, { body: { crossSign: true } }));
}

module.exports = {
  fetchClusterSync,
  publishClusterSync,
  meshClusterSync,
  dialClusterSync,
  nudgeCrossSign
};
