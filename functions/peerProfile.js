'use strict';

/**
 * Local / mesh peer profiles for GoonCitizen social tooling.
 *
 * Nickname remains the wire display name (`P2P_PEER_ALIAS`). Richer fields
 * (bio, Star Citizen handle) ride a GoonCitizen `PeerProfile` CONTRACT_MESSAGE
 * and are cached locally when inspecting peers.
 */

const PEER_PROFILE_TYPE = 'PeerProfile';
const BIO_MAX = 280;
const SC_HANDLE_MAX = 64;
const NICKNAME_MAX = 32;

/** Local copy — avoid circular require with settingsStore. */
function sanitizeNickname (value) {
  if (value === undefined || value === null || value === '') return null;
  const s = String(value)
    .replace(/[\u0000-\u001f\u007f]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ')
    .slice(0, NICKNAME_MAX);
  return s || null;
}

/**
 * Normalize optional profile fields. Empty object clears to null when persisted.
 * @param {*} value
 * @returns {{ bio: string|null, scHandle: string|null }|null}
 */
function sanitizeProfile (value) {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'object') return null;
  const bio = sanitizeTextField(value.bio, BIO_MAX);
  const scHandle = sanitizeTextField(value.scHandle || value.handle, SC_HANDLE_MAX);
  if (!bio && !scHandle) return null;
  return { bio, scHandle };
}

/**
 * @param {*} value
 * @param {number} max
 * @returns {string|null}
 */
function sanitizeTextField (value, max) {
  if (value === undefined || value === null || value === '') return null;
  const s = String(value)
    .replace(/[\u0000-\u001f\u007f]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ')
    .slice(0, max);
  return s || null;
}

/**
 * Build the public profile document for local identity / publish.
 * @param {{ nickname?: string|null, profile?: object|null, pubkey?: string|null }} opts
 * @returns {{ type: string, nickname: string|null, bio: string|null, scHandle: string|null, pubkey: string|null, updatedAt: string }}
 */
function buildLocalProfile (opts = {}) {
  const profile = sanitizeProfile(opts.profile) || { bio: null, scHandle: null };
  const nickname = sanitizeNickname(opts.nickname);
  return {
    type: PEER_PROFILE_TYPE,
    nickname,
    bio: profile.bio,
    scHandle: profile.scHandle,
    pubkey: opts.pubkey ? String(opts.pubkey) : null,
    updatedAt: new Date().toISOString()
  };
}

/**
 * Merge inbound PeerProfile / alias into a cache entry.
 * @param {object|null} prev
 * @param {object} patch
 * @returns {object}
 */
function mergeRemoteProfile (prev, patch = {}) {
  const base = prev && typeof prev === 'object' ? Object.assign({}, prev) : {};
  if (patch.nickname != null) {
    const n = sanitizeNickname(patch.nickname);
    if (n) base.nickname = n;
  }
  if (patch.alias != null && !base.nickname) {
    const n = sanitizeNickname(patch.alias);
    if (n) base.nickname = n;
  }
  if (patch.bio !== undefined) base.bio = sanitizeTextField(patch.bio, BIO_MAX);
  if (patch.scHandle !== undefined || patch.handle !== undefined) {
    base.scHandle = sanitizeTextField(patch.scHandle || patch.handle, SC_HANDLE_MAX);
  }
  if (patch.pubkey) base.pubkey = String(patch.pubkey);
  if (patch.address) base.address = String(patch.address);
  base.updatedAt = patch.updatedAt || new Date().toISOString();
  base.lastSeen = new Date().toISOString();
  return base;
}

/**
 * Extract host:port candidates from a peering gossip / offer object.
 * @param {object} object
 * @returns {string[]}
 */
function peeringAddressesFromObject (object) {
  if (!object || typeof object !== 'object') return [];
  const out = [];
  const push = (host, port) => {
    const h = String(host || '').trim();
    const p = Number(port);
    if (!h || !Number.isFinite(p) || p < 1 || p > 65535) return;
    out.push(`${h}:${p}`);
  };
  if (object.host != null && object.port != null) push(object.host, object.port);
  if (object.address && typeof object.address === 'string' && object.address.includes(':')) {
    out.push(String(object.address).trim());
  }
  const list = object.peers || object.candidates || object.addresses;
  if (Array.isArray(list)) {
    for (const item of list) {
      if (typeof item === 'string' && item.includes(':')) out.push(item.trim());
      else if (item && typeof item === 'object') {
        if (item.host != null && item.port != null) push(item.host, item.port);
        else if (item.address) out.push(String(item.address).trim());
      }
    }
  }
  return [...new Set(out.filter(Boolean))];
}

module.exports = {
  PEER_PROFILE_TYPE,
  BIO_MAX,
  SC_HANDLE_MAX,
  sanitizeProfile,
  sanitizeTextField,
  buildLocalProfile,
  mergeRemoteProfile,
  peeringAddressesFromObject
};
