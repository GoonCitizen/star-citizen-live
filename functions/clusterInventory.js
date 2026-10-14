'use strict';

/**
 * Compact per-device inventory for the Devices page.
 *
 * Counts only — no note bodies, chat text, or Game.log lines. Local totals
 * come from this node's Store + cumulative history; sibling totals come from
 * the last DeviceDataShare (`account.stats` plus pack lengths).
 */

const KEYS = Object.freeze([
  'notes',
  'groups',
  'tags',
  'chat',
  'files',
  'logs',
  'missions',
  'sessions',
  'deaths',
  'incap',
  'peers'
]);

const LABELS = Object.freeze({
  notes: 'Notes',
  groups: 'Groups',
  tags: 'Tags',
  chat: 'Chat',
  files: 'Files',
  logs: 'Logs',
  missions: 'Missions',
  sessions: 'Sessions',
  deaths: 'Deaths',
  incap: 'Incap',
  peers: 'LAN ads'
});

/** Chips always shown on a device card (zeros stay visible for compare). */
const CHIP_KEYS = Object.freeze([
  'notes',
  'groups',
  'tags',
  'chat',
  'files',
  'logs',
  'missions',
  'sessions'
]);

function _count (value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.min(1e9, Math.floor(n));
}

function _iso (value) {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

/**
 * @param {object} [raw]
 * @param {object} [opts]
 * @param {boolean} [opts.fill] when true, every KEY is present (zeros)
 * @returns {object}
 */
function sanitizeStats (raw = {}, opts = {}) {
  const fill = opts.fill === true;
  const src = raw && typeof raw === 'object' ? raw : {};
  const out = {};
  for (const key of KEYS) {
    if (!fill && src[key] == null) continue;
    out[key] = _count(src[key]);
  }
  if (src.logLines != null) out.logLines = _count(src.logLines);
  if (src.registerMissions != null) out.registerMissions = _count(src.registerMissions);
  if (src.filesPending != null) out.filesPending = _count(src.filesPending);
  const generatedAt = _iso(src.generatedAt);
  if (generatedAt) out.generatedAt = generatedAt;
  if (Array.isArray(src.applied)) {
    const applied = [];
    const seen = new Set();
    for (const item of src.applied) {
      const name = String(item || '').trim();
      if (!name || seen.has(name)) continue;
      seen.add(name);
      applied.push(name);
      if (applied.length >= 16) break;
    }
    if (applied.length) out.applied = applied;
  }
  if (src.truncated === true) out.truncated = true;
  const pubkey = String(src.pubkey || src.fromPubkey || '').trim();
  if (pubkey) out.pubkey = pubkey;
  return out;
}

/**
 * Game.log fold (D-014) — files scanned, not raw lines on the wire.
 * @param {object} [history]
 * @returns {object}
 */
function fromHistory (history) {
  const h = history && typeof history === 'object' ? history : {};
  const meta = h.meta && typeof h.meta === 'object' ? h.meta : {};
  return {
    logs: _count(meta.files),
    logLines: _count(meta.lines),
    missions: Array.isArray(h.missions) ? h.missions.length : 0,
    sessions: Array.isArray(h.sessions) ? h.sessions.length : 0,
    deaths: Array.isArray(h.deaths) ? h.deaths.length : 0,
    incap: Array.isArray(h.incap) ? h.incap.length : 0
  };
}

function countsFromPack (pack) {
  if (!pack || typeof pack !== 'object') return null;
  const name = String(pack.pack || '').trim();
  const payload = pack.payload && typeof pack.payload === 'object' ? pack.payload : {};
  if (name === 'account.stats') return sanitizeStats(payload, { fill: true });
  if (name === 'account.notes') {
    return { notes: Array.isArray(payload.notes) ? payload.notes.length : 0 };
  }
  if (name === 'account.groups') {
    return { groups: Array.isArray(payload.groups) ? payload.groups.length : 0 };
  }
  if (name === 'account.local-tags') {
    const tags = Array.isArray(payload.tags) ? payload.tags : (payload.groups || []);
    return { tags: tags.length };
  }
  if (name === 'account.chat') {
    return { chat: Array.isArray(payload.messages) ? payload.messages.length : 0 };
  }
  if (name === 'account.files') {
    return { files: Array.isArray(payload.files) ? payload.files.length : 0 };
  }
  if (name === 'account.peers') {
    return { peers: Array.isArray(payload.candidates) ? payload.candidates.length : 0 };
  }
  if (name === 'account.profile') return {};
  return null;
}

/**
 * Merge `account.stats` with actual pack lengths from a DeviceDataShare.
 * @param {object} share
 * @param {object} [extra]
 * @returns {object}
 */
/**
 * Keep the larger count per key so a later chat-only DeviceDataShare does
 * not wipe notes/logs from the header share.
 * @param {object} [prev]
 * @param {object} [next]
 * @returns {object}
 */
function mergeStats (prev, next) {
  const a = sanitizeStats(prev, { fill: true });
  const b = sanitizeStats(next, { fill: true });
  const out = {};
  for (const key of KEYS) {
    out[key] = Math.max(_count(a[key]), _count(b[key]));
  }
  if (a.logLines != null || b.logLines != null) {
    out.logLines = Math.max(_count(a.logLines), _count(b.logLines));
  }
  if (a.registerMissions != null || b.registerMissions != null) {
    out.registerMissions = Math.max(_count(a.registerMissions), _count(b.registerMissions));
  }
  if (a.filesPending != null || b.filesPending != null) {
    out.filesPending = Math.max(_count(a.filesPending), _count(b.filesPending));
  }
  const applied = [];
  const seen = new Set();
  for (const list of [a.applied, b.applied]) {
    if (!Array.isArray(list)) continue;
    for (const name of list) {
      const key = String(name || '').trim();
      if (!key || seen.has(key)) continue;
      seen.add(key);
      applied.push(key);
    }
  }
  if (applied.length) out.applied = applied;
  const genA = _iso(a.generatedAt);
  const genB = _iso(b.generatedAt);
  out.generatedAt = (genA && genB)
    ? (genA >= genB ? genA : genB)
    : (genB || genA || null);
  out.pubkey = b.pubkey || a.pubkey || undefined;
  out.truncated = a.truncated === true || b.truncated === true;
  return sanitizeStats(out, { fill: true });
}

/**
 * Merge `account.stats` with actual pack lengths from a DeviceDataShare.
 * @param {object} share
 * @param {object} [extra]
 * @returns {object}
 */
function fromShare (share, extra = {}) {
  const raw = share && share.object != null ? share.object : share;
  const packs = (raw && Array.isArray(raw.packs)) ? raw.packs : [];
  const merged = {};
  for (const pack of packs) {
    const counts = countsFromPack(pack);
    if (!counts) continue;
    Object.assign(merged, counts);
  }
  return sanitizeStats(Object.assign({}, merged, extra, {
    generatedAt: extra.generatedAt || (raw && raw.generatedAt),
    truncated: extra.truncated === true || (raw && raw.truncated === true),
    pubkey: extra.pubkey || extra.fromPubkey || (raw && raw.fromPubkey),
    applied: extra.applied
  }), { fill: extra.fill === true });
}

/**
 * @param {object} [stats]
 * @param {object} [opts]
 * @param {boolean} [opts.includeZero]
 * @returns {Array<{ key: string, label: string, count: number|null }>}
 */
function chipsFor (stats, opts = {}) {
  const includeZero = opts.includeZero !== false;
  const src = stats && typeof stats === 'object' ? stats : null;
  const out = [];
  const used = new Set();
  for (const key of CHIP_KEYS) {
    used.add(key);
    if (!src || src[key] == null) {
      if (includeZero) out.push({ key, label: LABELS[key], count: null });
      continue;
    }
    const count = _count(src[key]);
    if (count === 0 && !includeZero) continue;
    out.push({ key, label: LABELS[key], count });
  }
  for (const key of ['deaths', 'incap', 'peers']) {
    if (used.has(key)) continue;
    const count = src ? _count(src[key]) : 0;
    if (count <= 0) continue;
    out.push({ key, label: LABELS[key], count });
  }
  return out;
}

/**
 * @param {string} iso
 * @param {number} [now]
 * @returns {string|null}
 */
function relativeTime (iso, now = Date.now()) {
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return null;
  let sec = Math.round((now - t) / 1000);
  if (sec < 0) sec = 0;
  if (sec < 10) return 'just now';
  if (sec < 60) return sec + 's ago';
  const min = Math.round(sec / 60);
  if (min < 60) return min + 'm ago';
  const hr = Math.round(min / 60);
  if (hr < 36) return hr + 'h ago';
  const day = Math.round(hr / 24);
  return day + 'd ago';
}

module.exports = {
  KEYS,
  LABELS,
  CHIP_KEYS,
  sanitizeStats,
  mergeStats,
  fromHistory,
  countsFromPack,
  fromShare,
  chipsFor,
  relativeTime
};
