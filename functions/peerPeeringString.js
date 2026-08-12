'use strict';

/**
 * GoonCitizen peering dial strings (`pubkey@host:port`).
 * Hub primitives from `@fabric/hub/functions/peerIdentity`; GC-only row mapping
 * and clipboard helpers stay here.
 */

const hub = require('@fabric/hub/functions/peerIdentity');

const P2P_PORT = 7777;

function loadHubPeerIdentity () {
  return hub;
}

function isLikelyCompressedPubkeyHex (s) {
  return hub.isLikelyCompressedPubkeyHex(s);
}

function normalizeFabricPeerAddress (a) {
  return hub.normalizeFabricPeerAddress(a);
}

/**
 * Map GoonCitizen roster / profile fields onto a Hub-shaped peer row.
 * @param {object|null|undefined} opts
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
  return hub.fabricPeerPubkeyHex(peer);
}

function peerNativePeeringString (peer, signalingHostPort) {
  return hub.peerNativePeeringString(peer, signalingHostPort);
}

function peerPeeringEndpointIsSignaling (peer) {
  return hub.peerPeeringEndpointIsSignaling(peer);
}

/**
 * Build dial string + metadata for Profile / Peers UI.
 * @param {object} opts
 * @returns {{ string: string, endpoint: string, signaling: boolean }}
 */
function peeringInfoForGoonCitizen (opts = {}) {
  const row = goonCitizenPeerRow(opts);
  if (!row.address && opts.advertiseHost) {
    row.address = selfAdvertiseEndpoint({
      advertiseHost: opts.advertiseHost,
      listenPort: opts.listenPort
    });
  }
  const sig = opts.signalingHostPort != null ? String(opts.signalingHostPort) : '';
  const str = peerNativePeeringString(row, sig);
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
  endpoint = endpoint.replace(/^https?:\/\//i, '').split('/')[0];
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
