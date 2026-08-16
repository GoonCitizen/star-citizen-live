'use strict';

/**
 * IdentityCrossSign client: Fabric-first, HTTP fallback.
 *
 * Desktop (electronAPI.fabric) signs and gossips via the in-process Peer —
 * no LiveRelay HTTP. Passport / Hub browser / goon.vc keep POST/GET
 * `/identity/cross-sign` and `/identity/cluster` (thin clients have no Peer).
 *
 * Pre-signed bodies (Passport) always use HTTP so Hub can ingest + relay.
 */

function _fabricApi () {
  try {
    if (typeof window === 'undefined') return null;
    return (window.electronAPI && window.electronAPI.fabric) || null;
  } catch (_) {
    return null;
  }
}

function _bases (origin) {
  const base = String(origin || '').replace(/\/$/, '');
  return [
    `${base}/identity/cross-sign`,
    `${base}/services/star-citizen/identity/cross-sign`
  ];
}

function _isPreSigned (body) {
  return !!(body && body.signature && (body.identity || body.pubkeyHex || body.localPubkey));
}

/**
 * In-process Fabric publish (Electron). Null when the helper is absent.
 * @param {object} body
 * @returns {Promise<object|null>}
 */
async function tryFabricPublishCrossSign (body) {
  const api = _fabricApi();
  if (!api || typeof api.publishCrossSign !== 'function') return null;
  if (_isPreSigned(body)) return null;
  const out = await api.publishCrossSign({
    peerPubkey: body && (body.peerPubkey || body.peer),
    nonce: body && body.nonce,
    type: (body && (body.type || body['@type'])) || undefined
  });
  if (!out) return null;
  if (out.error) {
    return { ok: false, error: out.error, transport: 'fabric' };
  }
  return {
    ok: true,
    data: (out && out.data) || out,
    transport: out.transport || 'fabric'
  };
}

/**
 * In-process cluster snapshot (Electron). Null when the helper is absent.
 * @param {string} [pubkey]
 * @returns {Promise<object|null>}
 */
async function tryFabricIdentityCluster (pubkey) {
  const api = _fabricApi();
  if (!api || typeof api.identityCluster !== 'function') return null;
  const out = await api.identityCluster({ pubkey: pubkey || null });
  if (!out) return null;
  if (out.error) {
    return { ok: false, error: out.error, transport: 'fabric' };
  }
  const data = (out && out.data) || out;
  if (!data || typeof data !== 'object') return null;
  return { ok: true, data, transport: out.transport || 'fabric' };
}

async function postIdentityCrossSign (origin, body, opts = {}) {
  const payload = body && typeof body === 'object' ? body : {};
  if (!opts.forceHttp) {
    const viaFabric = await tryFabricPublishCrossSign(payload);
    if (viaFabric) return viaFabric;
  }
  const fetchImpl = opts.fetchImpl || globalThis.fetch;
  if (!fetchImpl) return { ok: false, error: 'fetch unavailable' };
  let last = { ok: false, error: 'no origin' };
  for (const url of _bases(origin)) {
    try {
      const res = await fetchImpl(url, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload),
        cache: 'no-store'
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        return { ok: true, status: res.status, data, url, transport: 'http' };
      }
      last = { ok: false, error: (data && data.error) || `HTTP ${res.status}`, status: res.status, url, transport: 'http' };
    } catch (e) {
      last = { ok: false, error: e && e.message ? e.message : String(e), transport: 'http' };
    }
  }
  return last;
}

async function fetchIdentityCluster (origin, pubkey, opts = {}) {
  if (!opts.forceHttp) {
    const viaFabric = await tryFabricIdentityCluster(pubkey);
    if (viaFabric) return viaFabric;
  }
  const fetchImpl = opts.fetchImpl || globalThis.fetch;
  if (!fetchImpl) return { ok: false, error: 'fetch unavailable' };
  const base = String(origin || '').replace(/\/$/, '');
  const q = pubkey ? ('?pubkey=' + encodeURIComponent(pubkey)) : '';
  const urls = [
    `${base}/identity/cluster${q}`,
    `${base}/services/star-citizen/identity/cluster${q}`
  ];
  for (const url of urls) {
    try {
      const res = await fetchImpl(url, { headers: { Accept: 'application/json' }, cache: 'no-store' });
      const data = await res.json().catch(() => ({}));
      if (res.ok) return { ok: true, data: data.data || data, transport: 'http' };
    } catch (_) { /* try next */ }
  }
  return { ok: false, error: 'cluster unavailable' };
}

module.exports = {
  postIdentityCrossSign,
  fetchIdentityCluster,
  tryFabricPublishCrossSign,
  tryFabricIdentityCluster
};
