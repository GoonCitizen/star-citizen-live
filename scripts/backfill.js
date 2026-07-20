'use strict';

/**
 * Historic-log backfill (CLI).
 *
 * Scans saved Game.log files (the game's own `logbackups`, plus any corpus under
 * ./Gamelogs) and folds them into the durable cumulative history used by the
 * desktop app (`stores/gooncitizen/history.json`). READ-ONLY on the logs.
 *
 * Prefer the desktop / `npm start` path — every startup already runs the same
 * cursor-based sync. This CLI is for one-shot corpus imports and CI fixtures.
 *
 * Usage:
 *   npm run backfill                 # scan default locations (SC logbackups + ./Gamelogs)
 *   node scripts/backfill.js DIR...  # scan explicit directories
 */

const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { parseLine, missionType, missionFaction } = require('../functions/parser');
const { storeRoot } = require('../functions/storePaths');
const cumulativeHistory = require('../functions/cumulativeHistory');

const STORE = cumulativeHistory.historyPath(storeRoot()) || path.join(__dirname, '..', 'stores', 'gooncitizen', 'history.json');
const CURSORS = cumulativeHistory.cursorsPath(storeRoot()) || path.join(__dirname, '..', 'stores', 'gooncitizen', 'log-cursors.json');

function defaultDirs () {
  const dirs = [];
  const corpus = path.join(__dirname, '..', 'Gamelogs');
  if (fs.existsSync(corpus)) dirs.push(corpus);
  const roots = ['C:\\', 'D:\\', 'E:\\', 'F:\\'];
  const channels = ['LIVE', 'PTU', 'EPTU', 'HOTFIX', 'TECH-PREVIEW'];
  for (const r of roots) {
    for (const c of channels) {
      const lb = path.join(r, 'Roberts Space Industries', 'StarCitizen', c, 'logbackups');
      if (fs.existsSync(lb)) dirs.push(lb);
    }
  }
  return dirs;
}

function findLogs (dir) {
  const out = [];
  let entries = [];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (_) { return out; }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...findLogs(p));
    else if (/\.log$/i.test(e.name)) out.push(p);
  }
  return out;
}

/** @deprecated Prefer cumulativeHistory.syncFiles — kept for tests. */
function newAcc () {
  return { missions: [], deaths: [], sessions: [], heat: {}, players: new Set(), files: 0, lines: 0 };
}

/** @deprecated Prefer cumulativeHistory.ingestFile — kept for tests. */
function processFile (file, acc) {
  return new Promise((resolve) => {
    let handle = null;
    let sessionTs = null;
    const gen = {};
    const rl = readline.createInterface({ input: fs.createReadStream(file), crlfDelay: Infinity });
    rl.on('line', (line) => {
      acc.lines++;
      const ev = parseLine(line);
      const t = ev.timestamp ? Date.parse(ev.timestamp) : NaN;
      if (ev.kind === 'player:login') handle = ev.handle;
      if (Number.isNaN(t)) return;
      const d = new Date(t);
      const ym = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
      const k = ym + '|' + ((d.getDay() + 6) % 7) + '|' + d.getHours();
      acc.heat[k] = (acc.heat[k] || 0) + 1;
      if (ev.kind === 'session:start' && !sessionTs) sessionTs = ev.timestamp;
      if (ev.kind === 'mission:marker' && ev.missionId) gen[ev.missionId] = ev.generator;
      if (ev.kind === 'player:death') acc.deaths.push({ player: handle || 'unknown', ts: ev.timestamp });
      if (ev.kind === 'mission:end') {
        acc.missions.push({
          type: missionType(gen[ev.missionId]),
          faction: missionFaction(gen[ev.missionId]),
          outcome: ev.completionType,
          player: ev.player || handle || 'unknown',
          ts: ev.timestamp
        });
      }
    });
    rl.on('close', () => {
      acc.sessions.push({ player: handle || 'unknown', ts: sessionTs });
      acc.files++;
      if (handle) acc.players.add(handle);
      resolve();
    });
    rl.on('error', () => resolve());
  });
}

async function ingestFiles (files, onProgress) {
  const acc = newAcc();
  for (let i = 0; i < files.length; i++) {
    await processFile(files[i], acc);
    if (onProgress && (i % 25 === 0 || i === files.length - 1)) onProgress(i + 1, files.length, acc);
  }
  return acc;
}

function toStore (acc, generatedAt) {
  return {
    missions: acc.missions,
    deaths: acc.deaths,
    sessions: acc.sessions,
    heat: acc.heat,
    players: [...acc.players],
    meta: { files: acc.files, lines: acc.lines, generatedAt }
  };
}

async function main () {
  const dirs = process.argv.slice(2).length ? process.argv.slice(2) : defaultDirs();
  if (!dirs.length) { console.error('No log directories found. Pass directories explicitly.'); process.exit(1); }
  console.log('Scanning:\n  ' + dirs.join('\n  '));
  let files = [];
  for (const d of dirs) files.push(...findLogs(d));
  files = [...new Set(files)];
  console.log(`Found ${files.length} log files. Syncing into cumulative history…`);

  const history = cumulativeHistory.loadHistory(STORE);
  const cursors = cumulativeHistory.loadCursors(CURSORS);
  const result = await cumulativeHistory.syncFiles(files, history, cursors, (done, total, h) => {
    console.log(`  ${done}/${total} files · ${h.missions.length} missions · ${h.deaths.length} deaths · ${h.players.length} pilots`);
  });

  cumulativeHistory.saveHistory(STORE, history);
  cumulativeHistory.saveCursors(CURSORS, cursors);
  const c = cumulativeHistory.cumulativeCounts(history);
  console.log(`\nWrote ${STORE}`);
  console.log(`  +${result.lines} new lines across ${result.files} files`);
  console.log(`  ${c.missions} ended missions · ${c.deaths} deaths · ${c.sessions} sessions`);
  console.log(`  pilots: ${(history.players || []).join(', ') || '(none)'}`);
}

module.exports = { defaultDirs, findLogs, ingestFiles, processFile, toStore, STORE, CURSORS };

if (require.main === module) main().catch((e) => { console.error('Backfill failed:', e.message); process.exit(1); });
