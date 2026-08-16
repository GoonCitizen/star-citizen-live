'use strict';

/**
 * Hub WebRTC coordinator for identity-cluster LAN discovery.
 *
 * LiveRelay does not host ICE. It registers this node's Fabric pubkey + RFC1918
 * dial hints on Hub `RegisterWebRTCPeer`, then `ListWebRTCPeers` to find
 * siblings. Actual mesh is Fabric Protocol TCP/NOISE (`dialClusterCandidates`).
 * DeviceDataShare remains the account-sync payload.
 */

const clusterSync = require('./clusterSync');

const KIND = 'gooncitizen-cluster';
const HEARTBEAT_MS = 30 * 1000;

function _origin (raw) {
  try {
    const u = new URL(String(raw || '').trim());
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
    return u.origin;
  } catch (_) {
    return null;
  }
}

function xOnly (pk) {
  const s = String(pk || '').trim().toLowerCase();
  if (/^0[23][0-9a-f]{64}$/.test(s)) return s.slice(2);
  if (/^[0-9a-f]{64}$/.test(s)) return s;
  return '';
}

function metadataFromLocal (opts = {}) {
  const pubkey = String(opts.pubkey || opts.peerId || '').trim();
  const port = Number(opts.port) || 7777;
  const candidates = Array.isArray(opts.candidates)
    ? opts.candidates.map((c) => String(c || '').trim()).filter(Boolean).slice(0, clusterSync.MAX_CANDIDATES)
    : [];
  return {
    app: 'gooncitizen',
    kind: KIND,
    pubkey,
    port,
    candidates
  };
}

function isClusterMeta (meta) {
  if (!meta || typeof meta !== 'object') return false;
  return meta.kind === KIND || meta.app === 'gooncitizen';
}

/**
 * @param {object} [meta]
 * @returns {string[]}
 */
function candidatesFromMeta (meta) {
  if (!meta || typeof meta !== 'object') return [];
  const port = Number(meta.port) || 7777;
  const out = [];
  const seen = new Set();
  const add = (raw) => {
    const s = String(raw || '').trim().toLowerCase();
    if (!s) return;
    const addr = s.indexOf(':') >= 0 ? s : (s + ':' + port);
    if (seen.has(addr)) return;
    seen.add(addr);
    out.push(addr);
  };
  if (Array.isArray(meta.candidates)) {
    for (const row of meta.candidates) add(row);
  }
  return out.slice(0, clusterSync.MAX_CANDIDATES);
}

async function hubRpc (origin, method, params, fetchImpl) {
  const base = _origin(origin);
  if (!base) throw new Error('invalid hub origin');
  const fetchFn = fetchImpl || globalThis.fetch;
  if (typeof fetchFn !== 'function') throw new Error('fetch unavailable');
  const res = await fetchFn(base + '/services/rpc', {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method,
      params: [params || {}]
    })
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error((body && (body.error && body.error.message)) || ('Hub HTTP ' + res.status));
  }
  if (body && body.error) {
    throw new Error(body.error.message || JSON.stringify(body.error));
  }
  return (body && Object.prototype.hasOwnProperty.call(body, 'result')) ? body.result : body;
}

async function register (origin, opts = {}, fetchImpl) {
  const peerId = String(opts.peerId || opts.pubkey || '').trim();
  if (!peerId) throw new Error('peerId required');
  return hubRpc(origin, 'RegisterWebRTCPeer', {
    peerId,
    metadata: metadataFromLocal(Object.assign({}, opts, { peerId, pubkey: opts.pubkey || peerId }))
  }, fetchImpl);
}

async function listPeers (origin, opts = {}, fetchImpl) {
  const peerId = String(opts.peerId || opts.pubkey || '').trim();
  const result = await hubRpc(origin, 'ListWebRTCPeers', {
    excludeSelf: opts.excludeSelf !== false,
    peerId
  }, fetchImpl);
  if (Array.isArray(result)) return result;
  if (result && Array.isArray(result.peers)) return result.peers;
  return [];
}

/**
 * Sibling LAN hints from Hub WebRTC registrations.
 * @param {Array<object>} peers ListWebRTCPeers rows
 * @param {Object} opts
 * @param {string} opts.localPubkey
 * @param {string[]} [opts.allowPubkeys] cluster members + paired device keys
 * @returns {Array<{ pubkey: string, candidates: string[], peerId: string }>}
 */
function siblingCandidates (peers, opts = {}) {
  const local = xOnly(opts.localPubkey);
  const allow = new Set((opts.allowPubkeys || []).map(xOnly).filter(Boolean));
  const out = [];
  const seen = new Set();
  for (const row of peers || []) {
    const meta = (row && row.metadata) || {};
    if (!isClusterMeta(meta) && !candidatesFromMeta(meta).length) continue;
    const pubkey = String(meta.pubkey || row.peerId || row.id || '').trim();
    const pk = xOnly(pubkey);
    if (!pk || pk === local) continue;
    if (!allow.size || !allow.has(pk)) continue;
    if (seen.has(pk)) continue;
    seen.add(pk);
    const candidates = candidatesFromMeta(meta);
    if (!candidates.length) continue;
    out.push({
      pubkey,
      peerId: String(row.peerId || row.id || pubkey),
      candidates,
      lastSeen: Number(row.lastSeen || row.registeredAt || 0) || null
    });
  }
  return out;
}

/**
 * Register on each hub, list cluster siblings, return discovered dial rows.
 * @param {Object} opts
 * @param {string[]} opts.hubs
 * @param {string} opts.pubkey
 * @param {string[]} [opts.candidates]
 * @param {number} [opts.port]
 * @param {string[]} [opts.allowPubkeys]
 * @param {Function} [opts.fetchImpl]
 * @returns {Promise<{ registered: string[], discovered: object[], errors: object[] }>}
 */
async function heartbeat (opts = {}) {
  const hubs = (opts.hubs || clusterSync.COORDINATOR_HUBS).map(_origin).filter(Boolean);
  const pubkey = String(opts.pubkey || '').trim();
  const registered = [];
  const discovered = [];
  const errors = [];
  const seenPk = new Set();
  for (const hub of hubs) {
    try {
      await register(hub, {
        peerId: pubkey,
        pubkey,
        candidates: opts.candidates,
        port: opts.port
      }, opts.fetchImpl);
      registered.push(hub);
      const peers = await listPeers(hub, { peerId: pubkey }, opts.fetchImpl);
      for (const row of siblingCandidates(peers, {
        localPubkey: pubkey,
        allowPubkeys: opts.allowPubkeys
      })) {
        const pk = xOnly(row.pubkey);
        if (!pk || seenPk.has(pk)) continue;
        seenPk.add(pk);
        discovered.push(Object.assign({ hub }, row));
      }
    } catch (e) {
      errors.push({ hub, error: (e && e.message) ? e.message : String(e) });
    }
  }
  return { registered, discovered, errors };
}

module.exports = {
  KIND,
  HEARTBEAT_MS,
  xOnly,
  metadataFromLocal,
  isClusterMeta,
  candidatesFromMeta,
  siblingCandidates,
  register,
  listPeers,
  heartbeat
};
