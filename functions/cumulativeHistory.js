'use strict';

/**
 * Cumulative gameplay history — compact, durable, idempotent.
 *
 * Stores ended missions, deaths, sessions, quantum hops, incap, CrimeStat,
 * activity heat, and pilots. Never stores raw log lines. Content-addressed
 * record ids make re-scans and live re-apply safe. File cursors (byte offset
 * + mtime) ensure each byte of a Game.log / logbackup is consumed at most
 * once until the file rotates (shrink → rescan from 0; new backup files get
 * a fresh cursor).
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const readline = require('readline');
const { parseLine, missionType, missionFaction } = require('./parser');

/** Pause readline this often so HTTP / IPC can run during a large first ingest. */
const INGEST_YIELD_EVERY = 4000;

function idFor (content) {
  return crypto.createHash('sha256').update(String(content)).digest('hex').slice(0, 32);
}

function emptyHistory () {
  return {
    missions: [],
    deaths: [],
    sessions: [],
    quantum: [],
    incap: [],
    crimestat: [],
    heat: {},
    players: [],
    meta: { files: 0, lines: 0, generatedAt: null, lastFlushAt: null }
  };
}

/** Ensure every record has an id (migrate pre-id history.json). */
function normalizeHistory (raw) {
  const h = emptyHistory();
  if (!raw || typeof raw !== 'object') return h;
  h.heat = (raw.heat && typeof raw.heat === 'object') ? Object.assign({}, raw.heat) : {};
  h.players = Array.isArray(raw.players) ? [...new Set(raw.players.filter(Boolean))] : [];
  h.meta = Object.assign({}, h.meta, raw.meta || {});

  for (const m of raw.missions || []) {
    if (!m || !m.ts) continue;
    const id = m.id || idFor(['mission', m.player, m.ts, m.outcome, m.type, m.faction].join('|'));
    h.missions.push(Object.assign({}, m, { id }));
  }
  for (const d of raw.deaths || []) {
    if (!d || !d.ts) continue;
    const id = d.id || idFor(['death', d.player, d.ts, d.bodyId || ''].join('|'));
    h.deaths.push(Object.assign({}, d, { id }));
  }
  for (const s of raw.sessions || []) {
    if (!s) continue;
    const id = s.id || idFor(['session', s.player, s.ts || ''].join('|'));
    h.sessions.push(Object.assign({}, s, { id }));
  }
  for (const q of raw.quantum || []) {
    if (!q || !q.ts) continue;
    const id = q.id || idFor(['quantum', q.phase || '', q.player || '', q.ts, q.destination || '', q.vehicle || ''].join('|'));
    h.quantum.push(Object.assign({}, q, { id }));
  }
  for (const i of raw.incap || []) {
    if (!i || !i.ts) continue;
    const id = i.id || idFor(['incap', i.player || '', i.ts, i.text || ''].join('|'));
    h.incap.push(Object.assign({}, i, { id }));
  }
  for (const c of raw.crimestat || []) {
    if (!c || !c.ts) continue;
    const id = c.id || idFor(['crimestat', c.player || '', c.ts, c.rating || '', c.delta || ''].join('|'));
    h.crimestat.push(Object.assign({}, c, { id }));
  }
  return h;
}

function loadHistory (file) {
  try {
    if (!file || !fs.existsSync(file)) return emptyHistory();
    return normalizeHistory(JSON.parse(fs.readFileSync(file, 'utf8')));
  } catch (_) {
    return emptyHistory();
  }
}

function saveHistory (file, history) {
  if (!file) return;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const out = normalizeHistory(history);
  out.meta = Object.assign({}, out.meta, { lastFlushAt: new Date().toISOString() });
  if (!out.meta.generatedAt) out.meta.generatedAt = out.meta.lastFlushAt;
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(out));
  fs.renameSync(tmp, file);
  history.meta = out.meta;
}

function loadCursors (file) {
  try {
    if (!file || !fs.existsSync(file)) return {};
    const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
    return (raw && typeof raw === 'object' && !Array.isArray(raw)) ? raw : {};
  } catch (_) {
    return {};
  }
}

function saveCursors (file, cursors) {
  if (!file) return;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(cursors || {}));
  fs.renameSync(tmp, file);
}

/** Build O(1) id indexes for idempotent applies. */
function indexHistory (history) {
  return {
    missions: new Set((history.missions || []).map((m) => m.id).filter(Boolean)),
    deaths: new Set((history.deaths || []).map((d) => d.id).filter(Boolean)),
    sessions: new Set((history.sessions || []).map((s) => s.id).filter(Boolean)),
    quantum: new Set((history.quantum || []).map((q) => q.id).filter(Boolean)),
    incap: new Set((history.incap || []).map((i) => i.id).filter(Boolean)),
    crimestat: new Set((history.crimestat || []).map((c) => c.id).filter(Boolean))
  };
}

function ensurePlayer (history, handle) {
  if (!handle) return false;
  if (!history.players.includes(handle)) {
    history.players.push(handle);
    return true;
  }
  return false;
}

/**
 * Provenance on a compact history row.
 * Missing `source` is treated as this node's Game.log (legacy history.json).
 * @param {*} ctx
 * @returns {string}
 */
function historySource (ctx) {
  if (ctx && ctx.source != null && String(ctx.source).trim() !== '') {
    return String(ctx.source);
  }
  return 'local';
}

/**
 * @param {object} row
 * @returns {boolean}
 */
function isLocalHistoryRecord (row) {
  if (!row || typeof row !== 'object') return false;
  const s = row.source;
  return s == null || s === '' || s === 'local';
}

function stampRecord (obj, ctx) {
  obj.source = historySource(ctx);
  return obj;
}

/**
 * Apply one parsed event into compact history. Idempotent via content ids.
 * @returns {Boolean} true when something new was recorded
 */
function applyEvent (history, index, ev, ctx = {}) {
  if (!ev || !history || !index) return false;
  let changed = false;
  const handle = ctx.handle || null;
  const gen = ctx.generators || {};

  if (ev.kind === 'player:login' && ev.handle) {
    if (ensurePlayer(history, ev.handle)) changed = true;
  }

  const t = ev.timestamp ? Date.parse(ev.timestamp) : NaN;
  if (!Number.isNaN(t) && ctx.countHeat !== false) {
    const d = new Date(t);
    const ym = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
    const k = ym + '|' + ((d.getDay() + 6) % 7) + '|' + d.getHours();
    history.heat[k] = (history.heat[k] || 0) + 1;
    changed = true;
  }

  if (ev.kind === 'player:death') {
    const player = handle || ev.player || 'unknown';
    const id = idFor(['death', player, ev.timestamp || '', ev.bodyId || ''].join('|'));
    if (!index.deaths.has(id)) {
      index.deaths.add(id);
      history.deaths.push(stampRecord({
        id, player, ts: ev.timestamp, bodyId: ev.bodyId || null
      }, ctx));
      ensurePlayer(history, player === 'unknown' ? null : player);
      changed = true;
    }
  }

  if (ev.kind === 'player:incap') {
    const player = handle || ev.player || 'unknown';
    const id = idFor(['incap', player, ev.timestamp || '', ev.text || ''].join('|'));
    if (!index.incap.has(id)) {
      index.incap.add(id);
      history.incap = history.incap || [];
      history.incap.push(stampRecord({
        id, player, ts: ev.timestamp, text: ev.text || null
      }, ctx));
      ensurePlayer(history, player === 'unknown' ? null : player);
      changed = true;
    }
  }

  if (ev.kind === 'player:crimestat') {
    const player = handle || ev.player || 'unknown';
    const id = idFor(['crimestat', player, ev.timestamp || '', ev.rating || '', ev.delta || ''].join('|'));
    if (!index.crimestat.has(id)) {
      index.crimestat.add(id);
      history.crimestat = history.crimestat || [];
      history.crimestat.push(stampRecord({
        id,
        player,
        ts: ev.timestamp,
        rating: ev.rating != null ? Number(ev.rating) : null,
        delta: ev.delta != null ? Number(ev.delta) : null
      }, ctx));
      ensurePlayer(history, player === 'unknown' ? null : player);
      changed = true;
    }
  }

  if (ev.kind === 'quantum:select' || ev.kind === 'quantum:arrive') {
    const player = handle || ev.player || 'unknown';
    const phase = ev.kind === 'quantum:select' ? 'select' : 'arrive';
    const id = idFor(['quantum', phase, player, ev.timestamp || '', ev.destination || '', ev.vehicle || ''].join('|'));
    if (!index.quantum.has(id)) {
      index.quantum.add(id);
      history.quantum = history.quantum || [];
      history.quantum.push(stampRecord({
        id,
        phase,
        player,
        ts: ev.timestamp,
        destination: ev.destination || null,
        vehicle: ev.vehicle || null
      }, ctx));
      ensurePlayer(history, player === 'unknown' ? null : player);
      changed = true;
    }
  }

  if (ev.kind === 'mission:end') {
    const player = ev.player || handle || 'unknown';
    const type = missionType(gen[ev.missionId] || ev.generator);
    const faction = missionFaction(gen[ev.missionId] || ev.generator);
    const id = idFor(['mission', player, ev.timestamp || '', ev.completionType || '', ev.missionId || '', type].join('|'));
    if (!index.missions.has(id)) {
      index.missions.add(id);
      history.missions.push(stampRecord({
        id,
        type,
        faction,
        outcome: ev.completionType,
        player,
        ts: ev.timestamp,
        missionId: ev.missionId || null
      }, ctx));
      ensurePlayer(history, player === 'unknown' ? null : player);
      changed = true;
    }
  }

  return changed;
}

/**
 * Ingest new bytes from a log file into history using a byte cursor.
 * @returns {Promise<{ changed: Boolean, lines: Number, cursor: Object }>}
 */
function ingestFile (file, history, index, cursors, opts = {}) {
  return new Promise((resolve) => {
    let st;
    try { st = fs.statSync(file); } catch (_) {
      return resolve({ changed: false, lines: 0, cursor: cursors[file] || null });
    }
    const key = path.resolve(file);
    const prev = cursors[key] || cursors[file] || null;
    let start = 0;
    if (prev && typeof prev.size === 'number') {
      if (st.size < prev.size) start = 0; // rotated / truncated
      else if (st.size === prev.size && st.mtimeMs === prev.mtimeMs) {
        return resolve({ changed: false, lines: 0, cursor: prev });
      } else start = prev.size;
    }

    let handle = opts.handle || null;
    let sessionTs = null;
    const generators = Object.assign({}, opts.generators || {});
    let changed = false;
    let lines = 0;
    const stream = fs.createReadStream(file, {
      start,
      encoding: 'utf8'
    });
    const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });

    rl.on('line', (line) => {
      lines += 1;
      if (history.meta) history.meta.lines = (history.meta.lines || 0) + 1;
      const ev = parseLine(line);
      if (ev.kind === 'player:login') handle = ev.handle;
      if (ev.kind === 'session:start' && !sessionTs) sessionTs = ev.timestamp;
      if (ev.kind === 'mission:marker' && ev.missionId) generators[ev.missionId] = ev.generator;
      if (applyEvent(history, index, ev, {
        handle, generators, countHeat: true, source: 'local'
      })) changed = true;
      if (lines % INGEST_YIELD_EVERY === 0) {
        rl.pause();
        setImmediate(() => rl.resume());
      }
    });

    rl.on('close', () => {
      if (start === 0 && (sessionTs || handle || lines > 0)) {
        const player = handle || 'unknown';
        const id = idFor(['session', key, sessionTs || '', player].join('|'));
        if (!index.sessions.has(id)) {
          index.sessions.add(id);
          history.sessions.push(stampRecord({ id, player, ts: sessionTs }, { source: 'local' }));
          ensurePlayer(history, handle);
          changed = true;
        }
        if (!prev) history.meta.files = (history.meta.files || 0) + 1;
      }
      const cursor = { size: st.size, mtimeMs: st.mtimeMs };
      cursors[key] = cursor;
      resolve({ changed, lines, cursor, handle, generators });
    });

    rl.on('error', () => {
      resolve({ changed, lines, cursor: prev, handle, generators });
    });
  });
}

/**
 * Sync a list of log files into history (oldest mtime first).
 */
async function syncFiles (files, history, cursors, onProgress) {
  const index = indexHistory(history);
  const seen = new Set();
  const dated = (files || [])
    .filter(Boolean)
    .map((f) => {
      try {
        const abs = fs.realpathSync(path.resolve(f));
        return { f: abs, mtime: fs.statSync(abs).mtimeMs };
      } catch (_) { return null; }
    })
    .filter((row) => {
      if (!row || seen.has(row.f)) return false;
      seen.add(row.f);
      return true;
    })
    .sort((a, b) => a.mtime - b.mtime);

  let changed = false;
  let totalLines = 0;
  for (let i = 0; i < dated.length; i++) {
    const r = await ingestFile(dated[i].f, history, index, cursors);
    if (r.changed) changed = true;
    totalLines += r.lines || 0;
    if (onProgress && (i % 10 === 0 || i === dated.length - 1)) {
      onProgress(i + 1, dated.length, history);
    }
  }
  if (changed && !history.meta.generatedAt) {
    history.meta.generatedAt = new Date().toISOString();
  }
  return { changed, files: dated.length, lines: totalLines, index };
}

/**
 * Apply a live parsed event (from the poller) into history without heat
 * double-counting when the same bytes were already synced — callers pass
 * countHeat:true for live-only lines past the cursor.
 */
function applyLiveEvent (history, index, ev, ctx) {
  return applyEvent(history, index, ev, Object.assign({ countHeat: true }, ctx || {}));
}

function cumulativeCounts (history) {
  const h = history || emptyHistory();
  const outcomes = { Complete: 0, Abandon: 0, Fail: 0, Deactivate: 0 };
  for (const m of h.missions || []) {
    if (m.outcome && outcomes[m.outcome] !== undefined) outcomes[m.outcome] += 1;
  }
  const quantum = h.quantum || [];
  return {
    missions: (h.missions || []).length,
    deaths: (h.deaths || []).length,
    sessions: (h.sessions || []).length,
    players: (h.players || []).length,
    quantum: quantum.length,
    quantumSelect: quantum.filter((q) => q.phase === 'select').length,
    quantumArrive: quantum.filter((q) => q.phase === 'arrive').length,
    incap: (h.incap || []).length,
    crimestat: (h.crimestat || []).length,
    completed: outcomes.Complete,
    abandoned: outcomes.Abandon,
    failed: outcomes.Fail,
    deactivated: outcomes.Deactivate
  };
}

/** Compact leaf records for Fabric Tree / GroupActivityTree publish. */
function historyLeaves (history) {
  const h = normalizeHistory(history);
  const leaves = [];
  const push = (kind, row) => {
    if (!row || !row.id) return;
    leaves.push({
      id: row.id,
      kind,
      ts: row.ts || null,
      player: row.player || null
    });
  };
  for (const m of h.missions) push('mission', m);
  for (const d of h.deaths) push('death', d);
  for (const q of h.quantum) push('quantum', q);
  for (const i of h.incap) push('incap', i);
  for (const c of h.crimestat) push('crimestat', c);
  for (const s of h.sessions) push('session', s);
  leaves.sort((a, b) => String(a.id).localeCompare(String(b.id)));
  return leaves;
}

/** Default history.json path under a Hub-style store root. */
function historyPath (settingsDir) {
  if (!settingsDir) return null;
  return path.join(settingsDir, 'history.json');
}

function cursorsPath (settingsDir) {
  if (!settingsDir) return null;
  return path.join(settingsDir, 'log-cursors.json');
}

module.exports = {
  idFor,
  emptyHistory,
  normalizeHistory,
  loadHistory,
  saveHistory,
  loadCursors,
  saveCursors,
  indexHistory,
  applyEvent,
  applyLiveEvent,
  ingestFile,
  syncFiles,
  cumulativeCounts,
  historySource,
  isLocalHistoryRecord,
  historyLeaves,
  historyPath,
  cursorsPath,
  INGEST_YIELD_EVERY
};
