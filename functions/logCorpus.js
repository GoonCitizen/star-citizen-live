'use strict';

/**
 * Log corpus discovery — every Game.log + logbackup a player owns locally.
 *
 * Used by startup cumulative sync (D-014), CLI backfill, and GET …/corpus so
 * Analyze can show which files feed “all of my own logs.”
 */

const fs = require('fs');
const path = require('path');
const {
  installBases,
  discoverGameLogs,
  channelFromPath,
  logbackupsBeside,
  KNOWN_CHANNELS
} = require('./locate');

/**
 * Recursively collect `*.log` under a directory.
 * SC logbackups use names like:
 *   Game Build(12269732) 24 Jul 26 (10 33 36).log
 * (spaces + parentheses; still ends in `.log`).
 * @param {string} dir
 * @param {{ readdirSync?: function }} [opts]
 * @returns {string[]}
 */
function findLogs (dir, opts = {}) {
  const readdirSync = opts.readdirSync || fs.readdirSync;
  const out = [];
  let entries = [];
  try { entries = readdirSync(dir, { withFileTypes: true }); } catch (_) { return out; }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...findLogs(p, opts));
    else if (/\.log$/i.test(e.name)) out.push(p);
  }
  return out;
}

/**
 * Directories that typically hold historical SC logs for this machine.
 * Always includes `<channel>/logbackups` under detected installs (LIVE first
 * among known channels for product focus) plus the sibling `logbackups` next
 * to any explicit / discovered Game.log (covers custom SC_LOGFILE paths).
 * @param {{
 *   repoRoot?: string,
 *   logfile?: string|null,
 *   extraDirs?: string[],
 *   includeLiveChannels?: boolean,
 *   existsSync?: function,
 *   readdirSync?: function,
 *   platform?: string,
 *   homedir?: function|string
 * }} [opts]
 * @returns {string[]}
 */
function defaultCorpusDirs (opts = {}) {
  const existsSync = opts.existsSync || fs.existsSync;
  const repoRoot = opts.repoRoot || path.join(__dirname, '..');
  const dirs = [];
  const seen = new Set();
  const add = (d) => {
    if (!d) return;
    let abs;
    try { abs = path.resolve(d); } catch (_) { return; }
    if (seen.has(abs)) return;
    try { if (!existsSync(abs)) return; } catch (_) { return; }
    seen.add(abs);
    dirs.push(abs);
  };

  add(path.join(repoRoot, 'Gamelogs'));
  // Note: repo `samples/` is not auto-scanned (can be 100MB+). Import it
  // explicitly via Feed → Import logs (or POST …/corpus/import).

  // Prefer LIVE/logbackups, then other channels, under every install base.
  const bases = installBases(opts);
  const channels = ['LIVE'].concat(KNOWN_CHANNELS.filter((ch) => ch !== 'LIVE'));
  for (const base of bases) {
    for (const ch of channels) {
      add(path.join(base, ch, 'logbackups'));
    }
  }

  // Sibling logbackups next to the live / explicit Game.log (custom installs).
  add(logbackupsBeside(opts.logfile));

  // Sibling logbackups next to every discovered channel Game.log.
  if (opts.includeLiveChannels !== false) {
    for (const row of discoverGameLogs(opts)) {
      add(logbackupsBeside(row.file));
    }
  }

  for (const d of opts.extraDirs || []) add(d);
  return dirs;
}

/**
 * Absolute, de-duplicated list of log files to fold into cumulative history.
 * @param {{
 *   logfile?: string|null,
 *   extraDirs?: string[],
 *   extraFiles?: string[],
 *   repoRoot?: string,
 *   includeLiveChannels?: boolean,
 *   existsSync?: function,
 *   readdirSync?: function,
 *   realpathSync?: function,
 *   platform?: string,
 *   homedir?: function|string
 * }} [opts]
 * @returns {string[]}
 */
function discoverCorpusFiles (opts = {}) {
  const existsSync = opts.existsSync || fs.existsSync;
  const realpathSync = opts.realpathSync || fs.realpathSync;
  const seen = new Set();
  const files = [];

  const push = (f) => {
    if (!f) return;
    let abs;
    try {
      abs = path.resolve(f);
      if (existsSync(abs)) abs = realpathSync(abs);
    } catch (_) {
      return;
    }
    if (seen.has(abs)) return;
    seen.add(abs);
    files.push(abs);
  };

  if (opts.includeLiveChannels !== false) {
    for (const row of discoverGameLogs(opts)) push(row.file);
  }

  for (const dir of defaultCorpusDirs(opts)) {
    for (const f of findLogs(dir, opts)) push(f);
  }

  for (const f of opts.extraFiles || []) push(f);

  if (opts.logfile) push(opts.logfile);

  return files;
}

/**
 * Operator / UI summary of what is tracked and how far cursors have consumed.
 * @param {{ files: string[], cursors?: object, history?: object, liveLogfile?: string|null }} args
 */
function summarizeCorpus (args = {}) {
  const files = Array.isArray(args.files) ? args.files : [];
  const cursors = (args.cursors && typeof args.cursors === 'object') ? args.cursors : {};
  const history = args.history || {};
  const live = args.liveLogfile ? path.resolve(args.liveLogfile) : null;
  const rows = [];
  let totalSize = 0;
  let consumedBytes = 0;
  let pendingFiles = 0;

  for (const file of files) {
    let st = null;
    try { st = fs.statSync(file); } catch (_) { st = null; }
    const key = (() => {
      try { return fs.realpathSync(path.resolve(file)); } catch (_) { return path.resolve(file); }
    })();
    const cur = cursors[key] || cursors[file] || null;
    const size = st ? st.size : 0;
    const mtimeMs = st ? st.mtimeMs : null;
    const cursorSize = cur && Number.isFinite(cur.size) ? cur.size : 0;
    const synced = !!(st && cur && cur.size === st.size && cur.mtimeMs === st.mtimeMs);
    const pending = !!(st && (!cur || cur.size < st.size || cur.mtimeMs !== st.mtimeMs));
    if (pending) pendingFiles += 1;
    totalSize += size;
    consumedBytes += Math.min(cursorSize, size || cursorSize);
    rows.push({
      path: file,
      channel: channelFromPath(file),
      role: (live && path.resolve(file) === live) ? 'live' : (/\blogbackups\b/i.test(file) ? 'backup' : 'corpus'),
      exists: !!st,
      size,
      mtime: mtimeMs != null ? new Date(mtimeMs).toISOString() : null,
      cursorSize,
      synced,
      pending
    });
  }

  rows.sort((a, b) => {
    if (a.role === 'live' && b.role !== 'live') return -1;
    if (b.role === 'live' && a.role !== 'live') return 1;
    return String(a.path).localeCompare(String(b.path));
  });

  const meta = history.meta || {};
  return {
    type: 'LogCorpus',
    fileCount: rows.length,
    pendingFiles,
    totalSize,
    consumedBytes,
    liveLogfile: live,
    ownerPubkey: meta.ownerPubkey || null,
    lastSyncAt: meta.lastFlushAt || meta.generatedAt || null,
    historyCounts: {
      missions: (history.missions || []).length,
      deaths: (history.deaths || []).length,
      sessions: (history.sessions || []).length,
      players: (history.players || []).length,
      files: meta.files || 0,
      lines: meta.lines || 0
    },
    files: rows
  };
}

/**
 * Stamp local ownership metadata onto history after a sync.
 * @param {object} history
 * @param {{ ownerPubkey?: string|null, fileCount?: number }} stamp
 */
function stampHistoryOwnership (history, stamp = {}) {
  if (!history || typeof history !== 'object') return history;
  history.meta = history.meta || {};
  if (stamp.ownerPubkey) history.meta.ownerPubkey = String(stamp.ownerPubkey);
  if (Number.isFinite(stamp.fileCount)) history.meta.corpusFiles = stamp.fileCount;
  history.meta.corpusSyncedAt = new Date().toISOString();
  return history;
}

module.exports = {
  findLogs,
  defaultCorpusDirs,
  discoverCorpusFiles,
  summarizeCorpus,
  stampHistoryOwnership,
  logbackupsBeside
};
