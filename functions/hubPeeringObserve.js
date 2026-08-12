'use strict';

/**
 * Observe Hub HTTP surfaces for GoonCitizen Network → Peers.
 *
 * Discovery prefers `OPTIONS /` Application Resource Contract (from
 * `@fabric/http`) — contract id, services.peering pointer, and optional live
 * `status.oracleAttestation`. Falls back to `GET …/services/peering` when the
 * OPTIONS document lacks a live attestation (older hubs / plain HTTP servers).
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
 * @param {object|null} body Peering capabilities or ARC status wrapper
 * @returns {object|null}
 */
function extractAttestation (body) {
  if (!body || typeof body !== 'object') return null;
  return body.oracleAttestation || body.attestation || null;
}

/**
 * @param {object|null} attestation
 * @param {object|null} body
 * @returns {object|null}
 */
function extractClaim (attestation, body) {
  if (attestation && attestation.claim) return attestation.claim;
  if (body && body.claim) return body.claim;
  if (attestation && attestation.object) return attestation.object;
  return null;
}

/**
 * @param {string} base Normalized origin
 * @param {object|null} arc OPTIONS Application Resource Contract
 * @param {object|null} body Peering GET body (optional)
 * @param {object} fields Derived counts / claim
 * @returns {object}
 */
function hubRow (base, arc, body, fields) {
  const faucet = (() => {
    try {
      const hubBitcoinProxy = require('./hubBitcoinProxy');
      return hubBitcoinProxy.faucetFromOptionsDocument(arc);
    } catch (_) {
      return null;
    }
  })();
  return {
    origin: base,
    ok: true,
    available: body && body.available === false ? false : true,
    fabricPeerId: fields.fabricPeerId || null,
    hubAlias: fields.hubAlias || null,
    p2pConnections: fields.p2pConnections || 0,
    p2pMaxPeers: fields.p2pMaxPeers != null ? fields.p2pMaxPeers : null,
    p2pListening: !!fields.p2pListening,
    webrtcRegistered: fields.webrtcRegistered || 0,
    webrtcSignaling: Array.isArray(fields.webrtcSignaling) ? fields.webrtcSignaling.slice() : [],
    claim: fields.claim || null,
    faucet: faucet || null,
    application: arc
      ? {
        '@type': arc['@type'] || null,
        name: arc.name || null,
        description: arc.description || null,
        contractId: (arc.contract && arc.contract.id) || null,
        services: arc.services || null,
        capabilities: arc.capabilities || null
      }
      : null,
    discoveredVia: fields.discoveredVia || 'peering',
    fetchedAt: new Date().toISOString()
  };
}

/**
 * Normalize claim → count fields.
 * @param {object|null} claim
 * @returns {object}
 */
function fieldsFromClaim (claim) {
  const p2p = (claim && claim.p2p) || {};
  const webrtc = (claim && claim.webrtc) || {};
  return {
    fabricPeerId: (claim && claim.fabricPeerId) || null,
    hubAlias: (claim && claim.hub && claim.hub.alias) || null,
    p2pConnections: Number(p2p.connections) || 0,
    p2pMaxPeers: Number(p2p.maxPeers) || null,
    p2pListening: !!p2p.listening,
    webrtcRegistered: Number(webrtc.registeredPeers) || 0,
    webrtcSignaling: Array.isArray(webrtc.signaling) ? webrtc.signaling.slice() : [],
    claim
  };
}

/**
 * Fetch with timeout + AbortController.
 * @param {typeof fetch} fetchImpl
 * @param {string} url
 * @param {object} init
 * @param {number} timeoutMs
 * @returns {Promise<Response>}
 */
async function fetchWithTimeout (fetchImpl, url, init, timeoutMs) {
  const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
  try {
    return await fetchImpl(url, Object.assign({}, init, {
      signal: controller ? controller.signal : undefined
    }));
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Discover + observe one Hub origin via OPTIONS ARC, then peering as needed.
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

  let arc = null;
  try {
    const optRes = await fetchWithTimeout(fetchImpl, `${base}/`, {
      method: 'OPTIONS',
      headers: { Accept: 'application/json' }
    }, timeoutMs);
    if (optRes.ok) {
      arc = await optRes.json().catch(() => null);
    }
  } catch (e) {
    // OPTIONS may fail on non-Fabric origins; still try legacy peering GET.
    if (e && e.name === 'AbortError') {
      return { origin: base, ok: false, error: 'timeout' };
    }
  }

  const peeringSvc = (arc && arc.services && arc.services.peering) || null;
  const peeringPath = (peeringSvc && peeringSvc.endpointBasePath)
    ? String(peeringSvc.endpointBasePath)
    : '/services/peering';
  const peeringUrl = peeringPath.startsWith('http')
    ? peeringPath
    : `${base}${peeringPath.startsWith('/') ? '' : '/'}${peeringPath}`;

  // Prefer live attestation embedded in OPTIONS status (Hub enricher).
  const statusAttestation = arc && arc.status
    ? extractAttestation(arc.status)
    : null;
  if (statusAttestation) {
    const claim = extractClaim(statusAttestation, arc.status);
    return hubRow(base, arc, { available: true, oracleAttestation: statusAttestation }, Object.assign(
      fieldsFromClaim(claim),
      { discoveredVia: 'options' }
    ));
  }

  // Follow services.peering (or default path) for live counts.
  try {
    const res = await fetchWithTimeout(fetchImpl, peeringUrl, {
      method: 'GET',
      headers: { Accept: 'application/json' }
    }, timeoutMs);
    const body = await res.json().catch(() => null);
    if (!res.ok) {
      // OPTIONS alone can still mark a Fabric Hub as reachable (no live counts).
      if (arc && (arc['@type'] === 'ApplicationResourceContract' || arc.name)) {
        return hubRow(base, arc, { available: false }, Object.assign(
          fieldsFromClaim(null),
          {
            discoveredVia: 'options',
            fabricPeerId: null
          }
        ));
      }
      return { origin: base, ok: false, error: `HTTP ${res.status}`, status: res.status };
    }
    const attestation = extractAttestation(body);
    const claim = extractClaim(attestation, body);
    return hubRow(base, arc, body, Object.assign(
      fieldsFromClaim(claim),
      { discoveredVia: arc ? 'options+peering' : 'peering' }
    ));
  } catch (e) {
    if (arc && (arc['@type'] === 'ApplicationResourceContract' || arc.name)) {
      return hubRow(base, arc, { available: false }, Object.assign(
        fieldsFromClaim(null),
        { discoveredVia: 'options' }
      ));
    }
    return {
      origin: base,
      ok: false,
      error: (e && e.name === 'AbortError') ? 'timeout' : ((e && e.message) || String(e))
    };
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
  extractAttestation,
  extractClaim,
  observeOneHub,
  observeHubPeering
};
