'use strict';

/**
 * One-actor cluster sync after D-013 device-link.
 *
 * Pairing stays HTTPS `/device-links`. After `IdentityCrossSign`, siblings
 * share account data as `DeviceDataShare` CONTRACT_MESSAGE frames, stored and
 * replayed as a {@link FabricMessageCollection} (AMP hex — same collect /
 * store / replay as group journals and Discord packs).
 *
 * Finding the sibling (Fabric TCP first):
 *   1. LAN RFC1918 `host:port` advertised in `account.peers` (no /24 scan)
 *   2. Optional `fabricAdvertiseHost:port`
 *   3. Already-connected Hub seeds (`hub.fabric.pub:7777`, `relay.goon.vc:7777`)
 *   4. Hub WebRTC *registry* (`RegisterWebRTCPeer` / `ListWebRTCPeers`) so Node
 *      LiveRelay can publish those LAN hints when NAT hides interfaces.
 *      LiveRelay does not host ICE; Passport / Hub browser still use Hub
 *      signaling for the browser mesh.
 *
 * Apply remains cluster-gated. No seeds, xprvs, tokens, or passwords.
 */

const deviceDataSync = require('./deviceDataSync');
const host = require('./fabricPeerHostLocal');

const PACK_PEERS = deviceDataSync.PACK_PEERS;
const SHARE_TYPE = deviceDataSync.SHARE_TYPE;
const STORE_COLLECTION = 'clustersync';
const LAST_OUTBOUND_KEY = 'last-outbound';
const LAST_OUTBOUND_STATS_KEY = 'last-outbound-stats';
const MAX_CANDIDATES = 8;
const MAX_WEBRTC_HUBS = 4;

const DEFAULT_WEBRTC_HUBS = Object.freeze([
  'https://hub.fabric.pub',
  'https://relay.goon.vc'
]);

/** Hub origins that speak RegisterWebRTCPeer (not LiveRelay on relay.goon.vc). */
const COORDINATOR_HUBS = Object.freeze([
  'https://hub.fabric.pub'
]);

const TRANSPORT = Object.freeze([
  'tcp-lan',
  'tcp-advertise',
  'tcp-hub-relay',
  'webrtc-hub'
]);

/**
 * @param {*} hostName
 * @returns {boolean}
 */
function isRfc1918Ipv4 (hostName) {
  const m = String(hostName || '').trim().toLowerCase()
    .match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!m) return false;
  const a = Number(m[1]);
  const b = Number(m[2]);
  const c = Number(m[3]);
  const d = Number(m[4]);
  if ([a, b, c, d].some((n) => n > 255)) return false;
  if (a === 10) return true;
  if (a === 192 && b === 168) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  return false;
}

/**
 * HTTPS Hub origins for WebRTC signaling (Passport) and Node coordinator register.
 * @param {*} raw
 * @returns {string[]}
 */
function sanitizeWebrtcHubs (raw) {
  const list = Array.isArray(raw)
    ? raw
    : (raw && Array.isArray(raw.hubs) ? raw.hubs : []);
  const out = [];
  const seen = new Set();
  for (const item of list) {
    let origin = '';
    try {
      const u = new URL(String(item || '').trim());
      if (u.protocol !== 'https:') continue;
      origin = u.origin;
    } catch (_) {
      continue;
    }
    const key = origin.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(origin);
    if (out.length >= MAX_WEBRTC_HUBS) break;
  }
  return out;
}

function defaultWebrtc (raw) {
  const hubs = sanitizeWebrtcHubs(raw);
  return { hubs: hubs.length ? hubs : DEFAULT_WEBRTC_HUBS.slice() };
}

/**
 * RFC1918 interface addresses plus optional advertise host, as `host:port`.
 * Never includes loopback or network-hub DNS/NIC aliases. Does not scan a subnet.
 * @param {Object} [opts]
 * @param {number|string} [opts.port]
 * @param {string} [opts.advertiseHost]
 * @param {Object} [opts.interfaceAddresses]
 * @param {NodeJS.ProcessEnv} [opts.env]
 * @returns {string[]}
 */
function localDialCandidates (opts = {}) {
  const port = host.parseFabricPeerPort(opts.port) || 7777;
  const advertiseHost = opts.advertiseHost
    ? String(opts.advertiseHost).trim().toLowerCase()
    : '';
  const own = host.collectOwnFabricHosts({
    advertiseHost: advertiseHost || undefined,
    includeLocalInterfaces: opts.includeLocalInterfaces !== false,
    interfaceAddresses: opts.interfaceAddresses,
    env: opts.env || process.env,
    bindHost: opts.bindHost
  });
  const out = [];
  const seen = new Set();
  const add = (rawHost) => {
    const h = String(rawHost || '').trim().toLowerCase();
    if (!h) return;
    if (host.isLoopbackFabricAddress(h)) return;
    if (host.isNetworkHubAddress(h) || host.isNetworkHubAddress(`${h}:${port}`)) return;
    const addr = host.formatFabricHostPort(h, port);
    if (!addr || seen.has(addr)) return;
    seen.add(addr);
    out.push(addr);
  };
  for (const h of own) {
    if (isRfc1918Ipv4(h)) add(h);
  }
  if (advertiseHost) add(advertiseHost);
  return out.slice(0, MAX_CANDIDATES);
}

/**
 * Compact `account.peers` payload.
 * @param {Object} [opts]
 * @param {string} opts.pubkey
 * @param {number|string} [opts.port]
 * @param {string[]} [opts.candidates]
 * @param {string} [opts.advertiseHost]
 * @param {string[]|object} [opts.webrtc] / opts.webrtcHubs
 * @returns {object|null}
 */
function compactPeers (opts = {}) {
  const pubkey = String(opts.pubkey || '').trim();
  if (!deviceDataSync.isPubkey(pubkey)) return null;
  const port = host.parseFabricPeerPort(opts.port) || 7777;
  const seen = new Set();
  const candidates = [];
  const add = (raw) => {
    const parts = host.splitFabricHostPort(raw);
    const formatted = host.formatFabricHostPort(
      parts.host || String(raw || '').trim(),
      parts.port != null ? parts.port : port
    );
    if (!formatted) return;
    if (host.isLoopbackFabricAddress(formatted)) return;
    if (host.isNetworkHubAddress(formatted)) return;
    if (seen.has(formatted)) return;
    seen.add(formatted);
    candidates.push(formatted);
  };
  for (const row of opts.candidates || []) add(row);
  if (opts.advertiseHost) add(opts.advertiseHost);
  const webrtc = defaultWebrtc(opts.webrtcHubs || opts.webrtc);
  if (!candidates.length && !webrtc.hubs.length) return null;
  return {
    pubkey,
    port,
    candidates: candidates.slice(0, MAX_CANDIDATES),
    webrtc
  };
}

/**
 * DeviceDataShare pack for this node's dial hints.
 * @param {Object} opts
 * @returns {object|null}
 */
function localPeersPack (opts = {}) {
  const candidates = localDialCandidates(opts);
  const payload = compactPeers({
    pubkey: opts.pubkey,
    port: opts.port,
    candidates,
    advertiseHost: opts.advertiseHost,
    webrtcHubs: opts.webrtcHubs || opts.webrtc
  });
  if (!payload) return null;
  return { pack: PACK_PEERS, payload };
}

/**
 * Addresses a sibling should TCP-dial (exclude self + loopback).
 * @param {object} peers compactPeers payload
 * @param {Object} [opts]
 * @param {string} [opts.localPubkey]
 * @param {string[]} [opts.selfCandidates]
 * @param {boolean} [opts.allowLoopback]
 * @returns {string[]}
 */
function dialTargets (peers, opts = {}) {
  if (!peers || !Array.isArray(peers.candidates)) return [];
  const local = String(opts.localPubkey || '').trim().toLowerCase().replace(/^0[23]/, '');
  const from = String(peers.pubkey || '').trim().toLowerCase().replace(/^0[23]/, '');
  if (local && from && local === from) return [];
  const self = new Set((opts.selfCandidates || []).map((a) => String(a).trim().toLowerCase()));
  const out = [];
  const seen = new Set();
  for (const raw of peers.candidates) {
    const addr = String(raw || '').trim().toLowerCase();
    if (!addr || seen.has(addr) || self.has(addr)) continue;
    if (host.isLoopbackFabricAddress(addr) && opts.allowLoopback !== true) continue;
    if (host.isNetworkHubAddress(addr)) continue;
    seen.add(addr);
    out.push(addr);
  }
  return out;
}

function peerStoreKey (pubkey) {
  const pk = String(pubkey || '').trim().toLowerCase();
  return pk ? `peer:${pk}` : null;
}

/**
 * clustersync rows that are sibling hints (LAN candidates and/or last share).
 * @param {object} row
 * @returns {boolean}
 */
function isPeerHintRow (row) {
  if (!row || typeof row !== 'object' || !row.pubkey) return false;
  if (Array.isArray(row.candidates)) return true;
  return !!(row.inventory && typeof row.inventory === 'object');
}

/**
 * Wrap a signed AMP Message as a public FabricMessageCollection document.
 * @param {object} message Fabric Message
 * @returns {object|null}
 */
function collectionFromMessage (message) {
  if (!message) return null;
  return collectionFromMessages([message]);
}

/**
 * Wrap signed AMP Messages as a public FabricMessageCollection document.
 * @param {Array<object>} messages
 * @returns {object|null}
 */
function collectionFromMessages (messages) {
  const list = Array.isArray(messages) ? messages.filter(Boolean) : [];
  if (!list.length) return null;
  const col = require('./fabricMessageCollection');
  const collection = col.createCollection();
  const result = col.ingestMany(collection, list);
  if (!result || result.accepted < 1) return null;
  return col.toJSON(collection);
}

/**
 * Sign a DeviceDataShare as CONTRACT_MESSAGE and return a collection document.
 * @param {object} share
 * @param {Object} opts
 * @param {object} opts.key @fabric/core Key (or Key-like with sign)
 * @param {string} [opts.contractId]
 * @returns {object|null}
 */
function shareToCollection (share, opts = {}) {
  const sanitized = deviceDataSync.sanitizeShare(share);
  if (!sanitized) return null;
  const key = opts.key;
  if (!key) return null;
  const Message = require('@fabric/core/types/message');
  const { gooncitizenContractId } = require('../contracts/gooncitizen');
  const contract = String(opts.contractId || gooncitizenContractId()).trim();
  const msg = Message.fromVector(['CONTRACT_MESSAGE', JSON.stringify({
    contract,
    type: SHARE_TYPE,
    object: sanitized
  })]).signWithKey(key);
  return collectionFromMessage(msg);
}

/**
 * Replay DeviceDataShare frames from a FabricMessageCollection document.
 * @param {object} doc
 * @returns {Array<{ share: object, author: string|null, hash: string|null }>}
 */
function replayShareCollection (doc) {
  const col = require('./fabricMessageCollection');
  let collection = doc;
  if (doc && Array.isArray(doc.messages) && doc.type === col.COLLECTION_TYPE) {
    collection = col.fromJSON(doc);
  }
  const shares = [];
  col.replay(collection, (ctx) => {
    const inner = ctx && ctx.inner;
    if (!inner || inner.type !== SHARE_TYPE) return;
    const share = deviceDataSync.sanitizeShare(inner.object);
    if (!share) return;
    shares.push({
      share,
      author: (ctx.record && ctx.record.author) || null,
      hash: (ctx.record && ctx.record.hash) || null
    });
  });
  return shares;
}

function _memberCount (data) {
  return Array.isArray(data && data.members) ? data.members.length : 0;
}

function _peerRows (data) {
  return (data && Array.isArray(data.peers) ? data.peers : [])
    .filter((row) => row && row.pubkey && Array.isArray(row.candidates));
}

/**
 * Compact UI model for {@link DataSyncStatus}.
 * @param {object} [data] ClusterSync `data` (or the HTTP envelope)
 * @returns {{ state: string, tone: string, label: string, detail: string, members: number, connected: number, frames: number, lan: number }}
 */
function summarizeSyncStatus (data) {
  const raw = data && data.data && !data.members ? data.data : (data || {});
  const members = _memberCount(raw);
  const fabric = raw.fabric || {};
  const connected = Number(fabric.connected) || 0;
  const ready = fabric.ready === true;
  const collection = raw.collection && typeof raw.collection === 'object'
    ? raw.collection
    : null;
  const frames = collection && Number(collection.count) > 0
    ? Number(collection.count)
    : 0;
  const lan = Array.isArray(raw.local && raw.local.candidates)
    ? raw.local.candidates.length
    : 0;
  const siblings = _peerRows(raw).length;
  const inventory = raw.inventory && typeof raw.inventory === 'object' ? raw.inventory : {};
  const localChat = Number(inventory.local && inventory.local.chat) || 0;
  const inboundChat = (Array.isArray(inventory.inbound) ? inventory.inbound : [])
    .reduce((n, row) => n + (Number(row && row.chat) || 0), 0);
  const base = { members, connected, frames, lan, siblings, localChat, inboundChat };

  if (raw.error || raw.unauthorized) {
    return Object.assign({
      state: 'auth',
      tone: 'muted',
      label: 'Sync',
      detail: 'Sign in to see device sync'
    }, base);
  }

  if (members < 2) {
    return Object.assign({
      state: 'solo',
      tone: 'muted',
      label: 'This device',
      detail: ready
        ? (connected
          ? ('Mesh ' + connected + ' peer' + (connected === 1 ? '' : 's') + ' · add a device to sync chat')
          : 'Mesh idle · add a device to sync chat across phones and desktops')
        : 'Fabric peer not up · add a device after it comes online'
    }, base);
  }

  if (!ready) {
    return Object.assign({
      state: 'offline',
      tone: 'warn',
      label: 'Cluster offline',
      detail: members + ' devices · Fabric peer not up'
    }, base);
  }

  const chatBit = localChat
    ? (' · ' + localChat + ' chat here' + (inboundChat ? (' · ' + inboundChat + ' from siblings') : ''))
    : (inboundChat ? (' · ' + inboundChat + ' chat from siblings') : '');

  if (frames > 0) {
    return Object.assign({
      state: 'synced',
      tone: 'good',
      label: inboundChat || localChat ? 'Chat syncing' : 'Devices synced',
      detail: members + ' devices · ' +
        (connected ? connected + ' mesh peer' + (connected === 1 ? '' : 's') : 'hub relay') +
        (lan ? ' · LAN advertised' : '') +
        chatBit
    }, base);
  }

  return Object.assign({
    state: 'pending',
    tone: 'warn',
    label: 'Sync pending',
    detail: members + ' devices · waiting for chat and account share' +
      (siblings ? ' · ' + siblings + ' sibling hint' + (siblings === 1 ? '' : 's') : '')
  }, base);
}

module.exports = {
  PACK_PEERS,
  SHARE_TYPE,
  STORE_COLLECTION,
  LAST_OUTBOUND_KEY,
  LAST_OUTBOUND_STATS_KEY,
  MAX_CANDIDATES,
  DEFAULT_WEBRTC_HUBS,
  COORDINATOR_HUBS,
  TRANSPORT,
  isRfc1918Ipv4,
  sanitizeWebrtcHubs,
  localDialCandidates,
  compactPeers,
  localPeersPack,
  dialTargets,
  peerStoreKey,
  isPeerHintRow,
  collectionFromMessage,
  collectionFromMessages,
  shareToCollection,
  replayShareCollection,
  summarizeSyncStatus
};
