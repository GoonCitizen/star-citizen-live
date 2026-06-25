'use strict';

/**
 * Locate the Star Citizen Game.log across install locations and channels.
 *
 * Players install SC on different drives/paths (C:, E:, "Program Files", custom
 * libraries) and run different channels (LIVE, PTU, EPTU, HOTFIX, TECH-PREVIEW).
 * The log lives at <install>\StarCitizen\<CHANNEL>\Game.log. We:
 *   1. honour an explicit path (SC_LOGFILE) if given,
 *   2. else honour a forced channel (SC_CHANNEL) within detected installs,
 *   3. else auto-pick the channel whose Game.log was modified most recently
 *      (i.e. the one you're actually playing). Ties favour test channels.
 */

const fs = require('fs');
const path = require('path');

// Tie-break priority is the array order: on equal mtime, earlier wins.
const KNOWN_CHANNELS = ['HOTFIX', 'EPTU', 'PTU', 'TECH-PREVIEW', 'LIVE'];

// Common sub-paths under a drive root where "...\StarCitizen" can live.
const INSTALL_SUBDIRS = [
  'Roberts Space Industries\\StarCitizen',
  'Program Files\\Roberts Space Industries\\StarCitizen',
  'Program Files (x86)\\Roberts Space Industries\\StarCitizen',
  'Games\\Roberts Space Industries\\StarCitizen',
  'Games\\StarCitizen\\Roberts Space Industries\\StarCitizen'
];

// TODO (packaging / Linux): this only scans Windows drive letters. The Linux
// build (members playing SC via Proton/Wine) must add prefix-based detection,
// e.g. Steam compatdata (~/.steam/steam/steamapps/compatdata/<id>/pfx/drive_c/
// .../StarCitizen/<CHANNEL>/Game.log) and Lutris prefixes. Branch on process.platform
// and add a linuxRoots()/installBases() path. See PROGRESS.md packaging note.

// Existing Windows drive roots (C:\ .. Z:\).
function driveRoots (existsSync = fs.existsSync) {
  const roots = [];
  for (let c = 67; c <= 90; c++) {           // 'C'..'Z'
    const d = `${String.fromCharCode(c)}:\\`;
    try { if (existsSync(d)) roots.push(d); } catch (_) { /* skip */ }
  }
  return roots;
}

// Candidate "...\StarCitizen" base dirs across drives, plus any caller extras.
function installBases ({ extraBases = [], existsSync = fs.existsSync } = {}) {
  const bases = [];
  for (const root of driveRoots(existsSync)) {
    for (const sub of INSTALL_SUBDIRS) bases.push(path.join(root, sub));
  }
  return extraBases.concat(bases);
}

// Expand bases × channels into candidate Game.log paths.
function candidateLogs ({ bases, channels = KNOWN_CHANNELS }) {
  const out = [];
  for (const base of bases) {
    for (const ch of channels) out.push({ channel: ch, file: path.join(base, ch, 'Game.log') });
  }
  return out;
}

// Pull the channel folder name out of a Game.log path.
function channelFromPath (p) {
  if (!p) return null;
  const parts = String(p).split(/[\\/]+/);
  const i = parts.map((x) => x.toLowerCase()).lastIndexOf('game.log');
  return i > 0 ? parts[i - 1] : null;
}

/**
 * Resolve the best Game.log. Returns { file, channel, source } where source is
 * 'explicit' | 'channel' | 'auto-latest' | 'none'. statSync/existsSync are
 * injectable for testing.
 */
function resolveLogFile ({ explicit, channel, bases, statSync = fs.statSync, existsSync = fs.existsSync } = {}) {
  if (explicit) return { file: explicit, channel: channelFromPath(explicit), source: 'explicit' };

  const baseList = bases || installBases({ existsSync });
  const channels = channel ? [channel] : KNOWN_CHANNELS;
  const candidates = candidateLogs({ bases: baseList, channels });

  let best = null;
  for (const c of candidates) {
    let st;
    try { st = statSync(c.file); } catch (_) { continue; }   // not present
    if (!st) continue;
    if (!best || st.mtimeMs > best.mtimeMs) best = { file: c.file, channel: c.channel, mtimeMs: st.mtimeMs };
  }
  if (best) return { file: best.file, channel: best.channel, source: channel ? 'channel' : 'auto-latest' };
  return { file: null, channel: null, source: 'none' };
}

module.exports = { resolveLogFile, candidateLogs, channelFromPath, installBases, KNOWN_CHANNELS, INSTALL_SUBDIRS };
