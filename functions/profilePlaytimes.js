'use strict';

/**
 * Opt-in "when this user plays" pack — common play times (weekday × hour).
 *
 * Aggregates local heatmap cells into a 7×24 grid (no month timeline, no
 * mission/session payloads) for GroupDataShare `profile.playtimes`. Off by
 * default; the operator enables it on their own profile.
 */

const COLLECTION = 'datasync';
const PACK = 'profile.playtimes';

function isoNow (value) {
  if (value) {
    const d = new Date(value);
    if (!Number.isNaN(d.getTime())) return d.toISOString();
  }
  return new Date().toISOString();
}

function playtimesRecordId (pubkey) {
  const id = String(pubkey || '').trim();
  return id ? (PACK + ':' + id) : null;
}

function isPubkey (value) {
  const s = String(value || '').trim();
  return /^(?:0[23][0-9a-fA-F]{64}|[0-9a-fA-F]{64})$/.test(s);
}

/**
 * Collapse month-scoped heatcells `{ ym, d, h, n }` into common play times.
 * @param {Array<{ d?: number, h?: number, n?: number }>} heatcells
 * @returns {Array<{ d: number, h: number, n: number }>}
 */
function collapseHeatcells (heatcells) {
  const grid = Array.from({ length: 7 }, () => new Array(24).fill(0));
  for (const cell of heatcells || []) {
    if (!cell) continue;
    const d = Number(cell.d);
    const h = Number(cell.h);
    const n = Number(cell.n) || 0;
    if (d < 0 || d > 6 || h < 0 || h > 23 || n <= 0) continue;
    grid[d][h] += n;
  }
  const out = [];
  for (let d = 0; d < 7; d++) {
    for (let h = 0; h < 24; h++) {
      if (grid[d][h]) out.push({ d, h, n: grid[d][h] });
    }
  }
  return out;
}

function sampleCountOf (cells) {
  let n = 0;
  for (const cell of cells || []) n += Number(cell.n) || 0;
  return n;
}

/**
 * Compact payload for a GroupDataShare pack.
 * @param {object} opts
 * @param {string} opts.pubkey
 * @param {Array<object>} [opts.heatcells]
 * @param {Array<object>} [opts.cells]
 * @param {string} [opts.generatedAt]
 * @returns {object|null}
 */
function compactPlaytimesPayload (opts = {}) {
  const pubkey = String(opts.pubkey || '').trim();
  if (!isPubkey(pubkey)) return null;
  const cells = collapseHeatcells(opts.cells || opts.heatcells || []);
  if (!cells.length) return null;
  return {
    pubkey,
    cells,
    timezone: opts.timezone === 'utc' ? 'utc' : 'local',
    sampleCount: sampleCountOf(cells),
    generatedAt: isoNow(opts.generatedAt)
  };
}

/**
 * @param {object} payload
 * @param {object} [meta]
 * @returns {object|null}
 */
function sanitizePlaytimesPayload (payload, meta = {}) {
  if (!payload || typeof payload !== 'object') return null;
  return compactPlaytimesPayload({
    pubkey: payload.pubkey || meta.pubkey,
    cells: payload.cells || payload.heatcells,
    timezone: payload.timezone,
    generatedAt: payload.generatedAt || meta.observedAt
  });
}

function mergeSources (prev, next) {
  const list = Array.isArray(prev) ? prev.slice() : [];
  if (!next || !next.via) return list.slice(-8);
  const via = String(next.via);
  const pubkey = next.pubkey ? String(next.pubkey) : null;
  const groupId = next.groupId ? String(next.groupId) : null;
  const observedAt = isoNow(next.observedAt);
  const idx = list.findIndex((s) => s && s.via === via &&
    String(s.pubkey || '') === String(pubkey || '') &&
    String(s.groupId || '') === String(groupId || ''));
  const row = { via, pubkey, groupId, observedAt };
  if (idx >= 0) list[idx] = row;
  else list.push(row);
  return list.slice(-8);
}

/**
 * Persist a peer's shared play times.
 * @param {object} store
 * @param {object} payload
 * @param {object} [meta]
 * @returns {object|null}
 */
function foldPlaytimes (store, payload, meta = {}) {
  if (!store) return null;
  const clean = sanitizePlaytimesPayload(payload, meta);
  if (!clean) return null;
  const id = playtimesRecordId(clean.pubkey);
  const prev = store.get(COLLECTION, id);
  const row = {
    id,
    kind: PACK,
    pack: PACK,
    pubkey: clean.pubkey,
    cells: clean.cells,
    timezone: clean.timezone,
    sampleCount: clean.sampleCount,
    generatedAt: clean.generatedAt,
    updatedAt: isoNow(meta.observedAt || clean.generatedAt),
    groupId: meta.groupId || (prev && prev.groupId) || null,
    sources: mergeSources(prev && prev.sources, {
      via: meta.via || 'gossip',
      pubkey: meta.pubkey || null,
      groupId: meta.groupId || null,
      observedAt: meta.observedAt
    })
  };
  store.put(COLLECTION, id, row);
  return row;
}

/**
 * @param {object} store
 * @param {string} pubkey
 * @returns {object|null}
 */
function loadPlaytimes (store, pubkey) {
  if (!store) return null;
  const id = playtimesRecordId(pubkey);
  return id ? (store.get(COLLECTION, id) || null) : null;
}

/**
 * @param {object} store
 * @returns {object[]}
 */
function loadAllPlaytimes (store) {
  if (!store) return [];
  return (store.all(COLLECTION) || []).filter((row) => row && row.pack === PACK && row.pubkey);
}

module.exports = {
  COLLECTION,
  PACK,
  playtimesRecordId,
  collapseHeatcells,
  compactPlaytimesPayload,
  sanitizePlaytimesPayload,
  foldPlaytimes,
  loadPlaytimes,
  loadAllPlaytimes
};
