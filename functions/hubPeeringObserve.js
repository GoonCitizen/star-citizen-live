'use strict';

/**
 * Observe Hub HTTP peering surfaces (capability + WebRTC registration counts)
 * without joining the browser WebRTC mesh. Used so desktop GoonCitizen can see
 * how wide the Fabric Network is (hub.fabric.pub + relay.goon.vc clients).
 */

const DEFAULT_HUB_ORIGINS = Object.freeze([
  'https://hub.fabric.pub',
  'https://relay.goon.vc'
]);

/**
 * @param {string} [origin]
 * @returns {string|null}
 */
function normalizeOrigin (origin) {
  const raw = String(origin || '').trim().replace(/\/$/, '');
  if (!raw) return null;
  try {
    const u = new URL(raw.includes('://') ? raw : `https://${raw}`);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    return `${u.protocol}//${u.host}`;
  } catch (_) {
    return null;
  }
}

/**
 * Fetch GET /services/peering from one Hub origin.
 * @param {string} origin
 * @param {{ fetch?: typeof fetch, timeoutMs?: number }} [opts]
 * @returns {Promise<object>}
 */
async function observeOneHub (origin, opts = {}) {
  const base = normalizeOrigin(origin);
  const fetchImpl = opts.fetch || (typeof fetch === 'function' ? fetch : null);
  const timeoutMs = Number(opts.timeoutMs) > 0 ? Number(opts.timeoutMs) : 4000;
  if (!base) {
    return { origin: origin || null, ok: false, error: 'invalid_origin' };
  }
  if (!fetchImpl) {
    return { origin: base, ok: false, error: 'fetch_unavailable' };
  }
  const url = `${base}/services/peering`;
  const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
  try {
    const res = await fetchImpl(url, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      signal: controller ? controller.signal : undefined
    });
    const body = await res.json().catch(() => null);
    if (!res.ok) {
      return { origin: base, ok: false, error: `HTTP ${res.status}`, status: res.status };
    }
    const attestation = body && (body.oracleAttestation || body.attestation) || null;
    const claim = (attestation && attestation.claim) ||
      (body && body.claim) ||
      (body && body.oracleAttestation && body.oracleAttestation.object) ||
      null;
    const p2p = (claim && claim.p2p) || {};
    const webrtc = (claim && claim.webrtc) || {};
    return {
      origin: base,
      ok: true,
      available: body && body.available !== false,
      fabricPeerId: (claim && claim.fabricPeerId) || null,
      hubAlias: (claim && claim.hub && claim.hub.alias) || null,
      p2pConnections: Number(p2p.connections) || 0,
      p2pMaxPeers: Number(p2p.maxPeers) || null,
      p2pListening: !!p2p.listening,
      webrtcRegistered: Number(webrtc.registeredPeers) || 0,
      webrtcSignaling: Array.isArray(webrtc.signaling) ? webrtc.signaling.slice() : [],
      claim,
      fetchedAt: new Date().toISOString()
    };
  } catch (e) {
    return {
      origin: base,
      ok: false,
      error: (e && e.name === 'AbortError') ? 'timeout' : ((e && e.message) || String(e))
    };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Observe several Hub origins in parallel.
 * @param {string[]} [origins]
 * @param {{ fetch?: typeof fetch, timeoutMs?: number }} [opts]
 * @returns {Promise<{ hubs: object[], summary: object }>}
 */
async function observeHubPeering (origins, opts = {}) {
  const list = (Array.isArray(origins) && origins.length ? origins : DEFAULT_HUB_ORIGINS)
    .map(normalizeOrigin)
    .filter(Boolean);
  const hubs = await Promise.all(list.map((o) => observeOneHub(o, opts)));
  const ok = hubs.filter((h) => h.ok);
  return {
    hubs,
    summary: {
      observed: hubs.length,
      online: ok.length,
      p2pConnections: ok.reduce((n, h) => n + (h.p2pConnections || 0), 0),
      webrtcRegistered: ok.reduce((n, h) => n + (h.webrtcRegistered || 0), 0),
      fetchedAt: new Date().toISOString()
    }
  };
}

module.exports = {
  DEFAULT_HUB_ORIGINS,
  normalizeOrigin,
  observeOneHub,
  observeHubPeering
};
