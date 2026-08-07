'use strict';

/**
 * GoonCitizen peering dial strings (`pubkey@host:port`).
 *
 * Prefers `@fabric/hub/functions/peerIdentity` (same helpers as Hub PeerView).
 * Falls back to a local mirror when the Hub package is older or the export is
 * unavailable — keeps Profile/Peers UI working offline of Hub upgrades.
 */

const P2P_PORT = 7777;

function loadHubPeerIdentity () {
  try {
    const m = require('@fabric/hub/functions/peerIdentity');
    if (m && typeof m.peerNativePeeringString === 'function') return m;
  } catch (_) { /* older hub / missing exports map entry */ }
  return null;
}

const hub = loadHubPeerIdentity();

function isLikelyCompressedPubkeyHex (s) {
  if (hub && typeof hub.isLikelyCompressedPubkeyHex === 'function') {
    return hub.isLikelyCompressedPubkeyHex(s);
  }
  const t = String(s || '').trim().toLowerCase();
  return /^(02|03)[0-9a-f]{64}$/.test(t);
}

function normalizeFabricPeerAddress (a) {
  if (hub && typeof hub.normalizeFabricPeerAddress === 'function') {
    return hub.normalizeFabricPeerAddress(a);
  }
  const s = String(a || '').trim();
  if (!s) return '';
  return s.includes(':') ? s : `${s}:${P2P_PORT}`;
}

/**
 * Map GoonCitizen roster / profile fields onto a Hub-shaped peer row.
 * @param {object|null|undefined} opts
 * @param {string} [opts.pubkey]
 * @param {string} [opts.address]
 * @param {object} [opts.peer] roster row
 * @param {object} [opts.profile]
 * @returns {object}
 */
function goonCitizenPeerRow (opts = {}) {
  const peer = opts.peer && typeof opts.peer === 'object' ? opts.peer : {};
  const profile = opts.profile && typeof opts.profile === 'object' ? opts.profile : {};
  const pubkey = String(
    opts.pubkey ||
    peer.pubkey ||
    peer.publicKey ||
    profile.pubkey ||
    ''
  ).trim();
  const address = String(
    opts.address != null ? opts.address : (peer.address || profile.address || '')
  ).trim();
  return {
    id: pubkey || peer.id || '',
    pubkey: pubkey || undefined,
    publicKey: pubkey || undefined,
    address: address || undefined,
    metadata: {
      fabricPeerId: pubkey || undefined,
      transport: peer.transport === 'webrtc' ? 'webrtc' : undefined
    }
  };
}

/**
 * Endpoint for self-share: advertise host (+ listen port) when configured.
 * @param {{ advertiseHost?: string|null, listenPort?: number }} opts
 * @returns {string}
 */
function selfAdvertiseEndpoint (opts = {}) {
  const raw = opts.advertiseHost != null ? String(opts.advertiseHost).trim() : '';
  if (!raw) return '';
  if (raw.includes(':')) return normalizeFabricPeerAddress(raw);
  const port = Number(opts.listenPort) || P2P_PORT;
  return normalizeFabricPeerAddress(`${raw}:${port}`);
}

function fabricPeerPubkeyHex (peer) {
  if (hub && typeof hub.fabricPeerPubkeyHex === 'function') {
    return hub.fabricPeerPubkeyHex(peer);
  }
  if (!peer || typeof peer !== 'object') return '';
  const m = peer.metadata && typeof peer.metadata === 'object' ? peer.metadata : {};
  const cands = [peer.publicKey, peer.pubkey, m.publicKey, m.pubkey, m.fabricPeerId, peer.id];
  for (let i = 0; i < cands.length; i++) {
    const c = cands[i] != null ? String(cands[i]).trim() : '';
    if (isLikelyCompressedPubkeyHex(c)) return c.toLowerCase();
  }
  return '';
}

function peerNativePeeringString (peer, signalingHostPort) {
  if (hub && typeof hub.peerNativePeeringString === 'function') {
    return hub.peerNativePeeringString(peer, signalingHostPort);
  }
  const pk = fabricPeerPubkeyHex(peer) ||
    (peer && peer.id != null ? String(peer.id).trim() : '');
  let target = '';
  const addr = peer && peer.address != null ? String(peer.address).trim() : '';
  if (addr && !addr.toLowerCase().startsWith('webrtc:')) {
    target = normalizeFabricPeerAddress(addr);
  } else {
    target = String(signalingHostPort || '').trim();
  }
  if (!pk && !target) return '';
  if (!target) return pk;
  if (!pk) return `@${target}`;
  return `${pk}@${target}`;
}

function peerPeeringEndpointIsSignaling (peer) {
  if (hub && typeof hub.peerPeeringEndpointIsSignaling === 'function') {
    return hub.peerPeeringEndpointIsSignaling(peer);
  }
  if (!peer || typeof peer !== 'object') return false;
  if (peer.metadata && peer.metadata.transport === 'webrtc') return true;
  const addr = peer.address != null ? String(peer.address).trim() : '';
  return !addr || addr.toLowerCase().startsWith('webrtc:');
}

/**
 * Build dial string + metadata for Profile / Peers UI.
 * @param {object} opts
 * @returns {{ string: string, endpoint: string, signaling: boolean }}
 */
function peeringInfoForGoonCitizen (opts = {}) {
  const row = goonCitizenPeerRow(opts);
  // Self with no TCP roster address: use fabricAdvertiseHost when set.
  if (!row.address && opts.advertiseHost) {
    row.address = selfAdvertiseEndpoint({
      advertiseHost: opts.advertiseHost,
      listenPort: opts.listenPort
    });
  }
  const sig = opts.signalingHostPort != null ? String(opts.signalingHostPort) : '';
  const str = peerNativePeeringString(row, sig);
  // Dial pins need identity@endpoint; bare pubkey alone is not a peering string.
  if (!str || !str.includes('@')) {
    return { string: '', endpoint: '', signaling: false };
  }
  const endpoint = row.address
    ? normalizeFabricPeerAddress(row.address)
    : (sig || '');
  return {
    string: str,
    endpoint,
    signaling: peerPeeringEndpointIsSignaling(row) && !opts.advertiseHost
  };
}

/**
 * Parse an operator dial input: `host:port` or `pubkey@host:port`.
 * @param {string} raw
 * @returns {{ address: string, pubkey: string|null }|null}
 */
function parsePeerDialInput (raw) {
  const s = String(raw || '').trim();
  if (!s) return null;
  let pubkey = null;
  let endpoint = s;
  const at = s.lastIndexOf('@');
  if (at > 0) {
    const left = s.slice(0, at).trim();
    const right = s.slice(at + 1).trim();
    if (!right) return null;
    if (isLikelyCompressedPubkeyHex(left)) pubkey = left.toLowerCase();
    else if (/^[0-9a-f]{64}$/i.test(left)) pubkey = left.toLowerCase();
    else return null;
    endpoint = right;
  }
  // Strip accidental scheme leftovers.
  endpoint = endpoint.replace(/^https?:\/\//i, '').split('/')[0];
  // Require host:port (do not invent a port for bare hostnames).
  if (!/^[a-zA-Z0-9._-]+:\d{1,5}$/.test(endpoint)) return null;
  const address = normalizeFabricPeerAddress(endpoint);
  if (!address || !/^[a-zA-Z0-9._-]+:\d{1,5}$/.test(address)) return null;
  return { address, pubkey };
}

/**
 * Clipboard helper for browser UI.
 * @param {string} text
 * @returns {boolean}
 */
function copyPeeringString (text) {
  const s = String(text || '');
  if (!s || typeof document === 'undefined') return false;
  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(s);
      return true;
    }
    const ta = document.createElement('textarea');
    ta.value = s;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    document.body.removeChild(ta);
    return true;
  } catch (_) {
    return false;
  }
}

module.exports = {
  loadHubPeerIdentity,
  isLikelyCompressedPubkeyHex,
  normalizeFabricPeerAddress,
  goonCitizenPeerRow,
  selfAdvertiseEndpoint,
  fabricPeerPubkeyHex,
  peerNativePeeringString,
  peerPeeringEndpointIsSignaling,
  peeringInfoForGoonCitizen,
  parsePeerDialInput,
  copyPeeringString,
  P2P_PORT
};
