'use strict';

/**
 * In-memory ring buffer of Fabric AMP wire Messages (not Game.log lines).
 * Used by the advanced-mode Fabric message viewer.
 */

const DEFAULT_CAPACITY = 500;

/** Keepalive / session frames hidden by default in the UI. */
const KEEPALIVE_TYPES = new Set([
  'P2P_PING',
  'P2P_PONG',
  'Ping',
  'Pong',
  'P2P_SESSION_OFFER',
  'P2P_SESSION_OPEN',
  'SessionOffer',
  'SessionOpen',
  'P2P_MESSAGE_RECEIPT',
  'MessageReceipt'
]);

/**
 * @param {object} [opts]
 * @param {number} [opts.capacity]
 */
function createFabricMessageLog (opts = {}) {
  const capacity = Math.max(1, Number(opts.capacity) || DEFAULT_CAPACITY);
  /** @type {object[]} */
  const entries = [];
  let seq = 0;
  let paused = false;

  /**
   * @param {object} entry
   * @returns {object|null}
   */
  function append (entry) {
    if (paused) return null;
    if (!entry || typeof entry !== 'object') return null;
    const row = Object.assign({
      id: ++seq,
      ts: new Date().toISOString()
    }, entry);
    entries.push(row);
    while (entries.length > capacity) entries.shift();
    return row;
  }

  /**
   * @param {{ limit?: number, direction?: string|null, type?: string|null, q?: string|null, hideKeepalive?: boolean, contract?: string|null }} [query]
   */
  function list (query = {}) {
    const limit = Math.min(2000, Math.max(1, Number(query.limit) || 200));
    const dir = query.direction ? String(query.direction).toLowerCase() : null;
    const type = query.type ? String(query.type) : null;
    const q = query.q ? String(query.q).toLowerCase() : null;
    const contract = query.contract ? String(query.contract).toLowerCase() : null;
    const hideKeepalive = query.hideKeepalive !== false;

    let out = entries.slice();
    if (dir === 'in' || dir === 'out') {
      out = out.filter((e) => e.direction === dir);
    }
    if (type) {
      out = out.filter((e) => e.type === type || e.appType === type || e.friendlyType === type);
    }
    if (contract) {
      out = out.filter((e) => {
        const c = e.contract != null ? String(e.contract).toLowerCase() : '';
        if (c && c === contract) return true;
        // Also match contract id embedded in body preview / summary.
        const hay = [e.bodyPreview, e.summary, e.contract].filter(Boolean).join(' ').toLowerCase();
        return hay.includes(contract);
      });
    }
    if (hideKeepalive) {
      out = out.filter((e) => !isKeepaliveType(e.type) && !isKeepaliveType(e.friendlyType));
    }
    if (q) {
      out = out.filter((e) => {
        const hay = [
          e.type, e.friendlyType, e.appType, e.contract, e.peer, e.hash, e.actor,
          e.bodyPreview, e.summary
        ].filter(Boolean).join(' ').toLowerCase();
        return hay.includes(q);
      });
    }
    if (out.length > limit) out = out.slice(out.length - limit);
    return out;
  }

  /**
   * @param {string|number} id hash, seq id, or stringified seq
   * @returns {object|null}
   */
  function get (id) {
    if (id == null || id === '') return null;
    const s = String(id).trim();
    const lower = s.toLowerCase();
    for (let i = entries.length - 1; i >= 0; i--) {
      const e = entries[i];
      if (!e) continue;
      if (e.hash && String(e.hash).toLowerCase() === lower) return e;
      if (String(e.id) === s) return e;
    }
    return null;
  }

  function clear () {
    entries.length = 0;
    return { cleared: true, capacity };
  }

  function pause () { paused = true; }
  function resume () { paused = false; }

  function status () {
    const types = new Map();
    for (const e of entries) {
      const t = e.type || '?';
      types.set(t, (types.get(t) || 0) + 1);
    }
    return {
      count: entries.length,
      capacity,
      paused,
      seq,
      types: [...types.entries()].sort((a, b) => b[1] - a[1]).map(([type, n]) => ({ type, n }))
    };
  }

  return {
    append,
    get,
    list,
    clear,
    pause,
    resume,
    status,
    capacity
  };
}

function isKeepaliveType (type) {
  return KEEPALIVE_TYPES.has(String(type || ''));
}

/**
 * Summarize a Fabric Message instance (or Message-like object) for the log.
 * @param {object} message
 * @param {{ direction?: string, peer?: string|null, via?: string|null }} [meta]
 */
function summarizeMessage (message, meta = {}) {
  if (!message) return null;
  const wireType = message.type || message.wireType || null;
  const friendlyType = message.friendlyType || null;
  const type = wireType || friendlyType || 'Unknown';
  let hash = null;
  try {
    if (typeof message.hash === 'string') hash = message.hash;
    else if (message.raw && message.raw.hash) {
      hash = Buffer.isBuffer(message.raw.hash)
        ? message.raw.hash.toString('hex')
        : String(message.raw.hash);
    } else if (typeof message.id === 'string') hash = message.id;
  } catch (_) { /* ignore */ }

  let bodyStr = '';
  let bodyBytes = 0;
  try {
    const data = message.raw && message.raw.data;
    if (Buffer.isBuffer(data)) {
      bodyBytes = data.length;
      bodyStr = data.toString('utf8');
    } else if (typeof message.data === 'string') {
      bodyStr = message.data;
      bodyBytes = Buffer.byteLength(bodyStr);
    } else if (message.data != null) {
      bodyStr = String(message.data);
      bodyBytes = Buffer.byteLength(bodyStr);
    }
  } catch (_) { /* ignore */ }

  let appType = null;
  let contract = null;
  let actor = null;
  let bodyPreview = null;
  let bodyJson = null;
  if (bodyStr) {
    const trimmed = bodyStr.trim();
    if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
      try {
        bodyJson = JSON.parse(trimmed);
        if (bodyJson && typeof bodyJson === 'object' && !Array.isArray(bodyJson)) {
          appType = bodyJson.type || null;
          contract = bodyJson.contract || (bodyJson.object && bodyJson.object.contractId) || null;
          const actorObj = bodyJson.actor;
          if (actorObj && typeof actorObj === 'object') {
            actor = actorObj.publicKey || actorObj.id || null;
          } else if (typeof bodyJson.actor === 'string') {
            actor = bodyJson.actor;
          }
        }
      } catch (_) {
        bodyJson = null;
      }
    }
    bodyPreview = bodyStr.length > 280 ? bodyStr.slice(0, 280) + '…' : bodyStr;
  }

  const summary = [
    meta.direction === 'out' ? '→' : '←',
    type,
    appType ? `(${appType})` : null,
    meta.peer ? `@ ${meta.peer}` : null
  ].filter(Boolean).join(' ');

  return {
    direction: meta.direction === 'out' ? 'out' : 'in',
    type,
    friendlyType: friendlyType || type,
    appType,
    contract: contract ? String(contract) : null,
    actor: actor ? String(actor) : null,
    peer: meta.peer ? String(meta.peer) : null,
    via: meta.via || null,
    hash: hash ? String(hash) : null,
    bodyBytes,
    bodyPreview,
    body: bodyJson != null ? bodyJson : (bodyPreview || null),
    summary,
    keepalive: isKeepaliveType(type) || isKeepaliveType(friendlyType)
  };
}

/**
 * Parse a wire buffer into a log summary.
 * @param {Buffer} buffer
 * @param {{ direction?: string, peer?: string|null, via?: string|null }} [meta]
 */
function summarizeBuffer (buffer, meta = {}) {
  if (!Buffer.isBuffer(buffer) || !buffer.length) return null;
  const Message = require('@fabric/core/types/message');
  const message = Message.fromBuffer(buffer);
  return summarizeMessage(message, meta);
}

module.exports = {
  createFabricMessageLog,
  summarizeMessage,
  summarizeBuffer,
  isKeepaliveType,
  KEEPALIVE_TYPES,
  DEFAULT_CAPACITY
};
