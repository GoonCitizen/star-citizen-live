'use strict';

/**
 * Historic-log backfill.
 *
 * Scans saved Game.log files (the game's own `logbackups`, plus any corpus under
 * ./Gamelogs) and aggregates them into a compact `stores/history.json` that the
 * dashboard's Analyze tab reads. READ-ONLY on the logs; it only writes the store.
 *
 * Each log is attributed to the pilot from its own "User Login Success - Handle[..]"
 * line, so a multi-pilot corpus produces a real org-wide dataset. We keep ONLY the
 * compact records the dashboard needs (ended missions, deaths, sessions, and a
 * per-month day x hour activity histogram) - never the raw lines - so memory and
 * the output file stay small even over gigabytes of logs.
 *
 * Usage:
 *   npm run backfill                 # scan default locations (SC logbackups + ./Gamelogs)
 *   node scripts/backfill.js DIR...  # scan explicit directories
 */

const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { parseLine, missionType, missionFaction } = require('../app/parser');

const STORE = path.join(__dirname, '..', 'stores', 'history.json');

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

function newAcc () {
  return { missions: [], deaths: [], sessions: [], heat: {}, players: new Set(), files: 0, lines: 0 };
}

function processFile (file, acc) {
  return new Promise((resolve) => {
    let handle = null;
    let sessionTs = null;
    const gen = {};   // missionId -> generator name (for mission-type)
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
  console.log(`Found ${files.length} log files. Parsing…`);

  const acc = await ingestFiles(files, (done, total, a) => {
    console.log(`  ${done}/${total} files · ${a.missions.length} missions · ${a.deaths.length} deaths · ${a.players.size} pilots`);
  });

  fs.mkdirSync(path.dirname(STORE), { recursive: true });
  fs.writeFileSync(STORE, JSON.stringify(toStore(acc, new Date().toISOString())));
  console.log(`\nWrote ${STORE}`);
  console.log(`  ${acc.files} files · ${acc.lines.toLocaleString()} lines`);
  console.log(`  ${acc.missions.length} ended missions · ${acc.deaths.length} deaths · ${acc.sessions.length} sessions`);
  console.log(`  pilots: ${[...acc.players].join(', ') || '(none)'}`);
}

module.exports = { defaultDirs, findLogs, ingestFiles, processFile, toStore, STORE };

if (require.main === module) main().catch((e) => { console.error('Backfill failed:', e.message); process.exit(1); });
