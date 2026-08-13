'use strict';

/**
 * Locate the Star Citizen Game.log across install locations and channels.
 *
 * Players install SC on different drives/paths and run different channels
 * (LIVE, PTU, EPTU, HOTFIX, TECH-PREVIEW). The log lives at
 *   <install>/StarCitizen/<CHANNEL>/Game.log
 * We:
 *   1. honour an explicit path (SC_LOGFILE) if given,
 *   2. else honour a forced channel (SC_CHANNEL) within detected installs,
 *   3. else auto-pick the channel whose Game.log was modified most recently
 *      (i.e. the one you're actually playing). Ties favour test channels.
 *
 * Windows: drive-letter scan of common RSI install subdirs.
 * Linux / macOS: Wine + Steam Proton compatdata prefixes (drive_c) + ~/.wine.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

// Tie-break priority is the array order: on equal mtime, earlier wins.
const KNOWN_CHANNELS = ['HOTFIX', 'EPTU', 'PTU', 'TECH-PREVIEW', 'LIVE'];

// Common sub-paths under a drive root / Wine drive_c where StarCitizen can live.
const INSTALL_SUBDIRS = [
  path.join('Program Files', 'Roberts Space Industries', 'StarCitizen'),
  path.join('Roberts Space Industries', 'StarCitizen'),
  path.join('Program Files (x86)', 'Roberts Space Industries', 'StarCitizen'),
  path.join('Games', 'Roberts Space Industries', 'StarCitizen'),
  path.join('Games', 'StarCitizen', 'Roberts Space Industries', 'StarCitizen')
];

const DEFAULT_LOGFILE_WIN = 'C:\\Program Files\\Roberts Space Industries\\StarCitizen\\LIVE\\Game.log';

/** @deprecated Prefer defaultLogFile() — kept for existing tests / callers. */
const DEFAULT_LOGFILE = DEFAULT_LOGFILE_WIN;

function steamLibraryRoots (home, existsSync = fs.existsSync) {
  const candidates = [
    path.join(home, '.steam', 'steam'),
    path.join(home, '.steam', 'root'),
    path.join(home, '.local', 'share', 'Steam'),
    path.join(home, '.var', 'app', 'com.valvesoftware.Steam', '.local', 'share', 'Steam'),
    // macOS Steam
    path.join(home, 'Library', 'Application Support', 'Steam')
  ];
  return candidates.filter((p) => {
    try { return existsSync(p); } catch (_) { return false; }
  });
}

/**
 * Wine / Proton `drive_c` roots to scan for RSI installs.
 * @param {{ homedir?: function, existsSync?: function, readdirSync?: function, platform?: string }} [opts]
 * @returns {string[]}
 */
function wineDriveRoots (opts = {}) {
  const existsSync = opts.existsSync || fs.existsSync;
  const readdirSync = opts.readdirSync || fs.readdirSync;
  const platform = opts.platform || process.platform;
  if (platform === 'win32') return [];

  const home = typeof opts.homedir === 'function' ? opts.homedir() : (opts.homedir || os.homedir());
  const roots = [];
  const wineHome = path.join(home, '.wine', 'drive_c');
  try { if (existsSync(wineHome)) roots.push(wineHome); } catch (_) { /* skip */ }

  for (const steam of steamLibraryRoots(home, existsSync)) {
    const compat = path.join(steam, 'steamapps', 'compatdata');
    let ids = [];
    try { ids = readdirSync(compat); } catch (_) { continue; }
    for (const id of ids) {
      const driveC = path.join(compat, String(id), 'pfx', 'drive_c');
      try { if (existsSync(driveC)) roots.push(driveC); } catch (_) { /* skip */ }
    }
  }
  return roots;
}

// Existing Windows drive roots (C:\ .. Z:\).
function driveRoots (existsSync = fs.existsSync) {
  const roots = [];
  for (let c = 67; c <= 90; c++) {           // 'C'..'Z'
    const d = `${String.fromCharCode(c)}:\\`;
    try { if (existsSync(d)) roots.push(d); } catch (_) { /* skip */ }
  }
  return roots;
}

/**
 * Candidate ".../StarCitizen" base dirs across the host OS.
 * @param {{ extraBases?: string[], existsSync?: function, readdirSync?: function, homedir?: function|string, platform?: string }} [opts]
 */
function installBases (opts = {}) {
  const existsSync = opts.existsSync || fs.existsSync;
  const platform = opts.platform || process.platform;
  const bases = [];

  if (platform === 'win32') {
    for (const root of driveRoots(existsSync)) {
      for (const sub of INSTALL_SUBDIRS) bases.push(path.join(root, sub));
    }
  } else {
    for (const driveC of wineDriveRoots(opts)) {
      for (const sub of INSTALL_SUBDIRS) bases.push(path.join(driveC, sub));
    }
  }

  const extras = Array.isArray(opts.extraBases) ? opts.extraBases : [];
  return extras.concat(bases);
}

function defaultLogFile (opts = {}) {
  const platform = opts.platform || process.platform;
  if (platform === 'win32') return DEFAULT_LOGFILE_WIN;
  const home = typeof opts.homedir === 'function' ? opts.homedir() : (opts.homedir || os.homedir());
  // Conventional Proton LIVE path under the first Steam library (may not exist yet —
  // the poller retries until the file appears).
  const steams = steamLibraryRoots(home, opts.existsSync || fs.existsSync);
  if (steams.length) {
    return path.join(
      steams[0],
      'steamapps',
      'compatdata',
      'starcitizen',
      'pfx',
      'drive_c',
      'Program Files',
      'Roberts Space Industries',
      'StarCitizen',
      'LIVE',
      'Game.log'
    );
  }
  return path.join(home, '.wine', 'drive_c', 'Program Files', 'Roberts Space Industries', 'StarCitizen', 'LIVE', 'Game.log');
}

// Expand bases × channels into candidate Game.log paths.
function candidateLogs ({ bases, channels = KNOWN_CHANNELS }) {
  const out = [];
  for (const base of bases) {
    for (const ch of channels) out.push({ channel: ch, file: path.join(base, ch, 'Game.log') });
  }
  return out;
}

// Pull the channel folder name out of a Game.log (or logbackup) path.
//   …/LIVE/Game.log              → LIVE
//   …/LIVE/logbackups/old.log    → LIVE  (not "logbackups")
function channelFromPath (p) {
  if (!p) return null;
  const parts = String(p).split(/[\\/]+/);
  const lower = parts.map((x) => x.toLowerCase());
  const lb = lower.lastIndexOf('logbackups');
  if (lb > 0) return parts[lb - 1] || null;
  const i = lower.lastIndexOf('game.log');
  return i > 0 ? parts[i - 1] : null;
}

/**
 * Sibling `logbackups` directory next to a channel Game.log.
 * Returns null when the path already lives under logbackups.
 * @param {string|null|undefined} logfile
 * @returns {string|null}
 */
function logbackupsBeside (logfile) {
  if (!logfile) return null;
  let abs;
  try { abs = path.resolve(String(logfile)); } catch (_) { return null; }
  const dir = path.dirname(abs);
  if (/^logbackups$/i.test(path.basename(dir))) return null;
  return path.join(dir, 'logbackups');
}

/**
 * Every existing Game.log under detected installs (all channels).
 * @returns {Array<{ file: string, channel: string|null, mtimeMs: number, size: number }>}
 */
function discoverGameLogs (opts = {}) {
  const existsSync = opts.existsSync || fs.existsSync;
  const statSync = opts.statSync || fs.statSync;
  const baseList = opts.bases || installBases(opts);
  const channels = opts.channels || KNOWN_CHANNELS;
  const out = [];
  for (const c of candidateLogs({ bases: baseList, channels })) {
    let st;
    try { st = statSync(c.file); } catch (_) { continue; }
    if (!st) continue;
    if (typeof st.isFile === 'function' && !st.isFile()) continue;
    out.push({
      file: c.file,
      channel: c.channel,
      mtimeMs: st.mtimeMs,
      size: st.size
    });
  }
  return out.sort((a, b) => a.mtimeMs - b.mtimeMs);
}

/**
 * Resolve the best Game.log. Returns { file, channel, source } where source is
 * 'explicit' | 'channel' | 'auto-latest' | 'default'. When no install is
 * detected we fall back to a platform default so the relay can tail as soon
 * as the file exists. statSync/existsSync are injectable for testing.
 */
function resolveLogFile ({
  explicit,
  channel,
  bases,
  statSync = fs.statSync,
  existsSync = fs.existsSync,
  platform = process.platform,
  homedir
} = {}) {
  if (explicit) return { file: explicit, channel: channelFromPath(explicit), source: 'explicit' };

  const baseList = bases || installBases({ existsSync, platform, homedir });
  const channels = channel ? [channel] : KNOWN_CHANNELS;
  const candidates = candidateLogs({ bases: baseList, channels });

  let best = null;
  for (const c of candidates) {
    let st;
    try { st = statSync(c.file); } catch (_) { continue; }
    if (!st) continue;
    if (!best || st.mtimeMs > best.mtimeMs) best = { file: c.file, channel: c.channel, mtimeMs: st.mtimeMs };
  }
  if (best) return { file: best.file, channel: best.channel, source: channel ? 'channel' : 'auto-latest' };
  return {
    file: defaultLogFile({ platform, homedir, existsSync }),
    channel: 'LIVE',
    source: 'default'
  };
}

module.exports = {
  resolveLogFile,
  candidateLogs,
  channelFromPath,
  logbackupsBeside,
  installBases,
  discoverGameLogs,
  wineDriveRoots,
  defaultLogFile,
  KNOWN_CHANNELS,
  INSTALL_SUBDIRS,
  DEFAULT_LOGFILE,
  DEFAULT_LOGFILE_WIN
};
