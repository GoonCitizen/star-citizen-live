'use strict';

const path = require('path');
const { test } = require('node:test');
const assert = require('node:assert');
const {
  resolveLogFile,
  wineDriveRoots,
  installBases,
  discoverGameLogs,
  defaultLogFile,
  channelFromPath,
  logbackupsBeside
} = require('../../functions/locate');
const logCorpus = require('../../functions/logCorpus');

test('wineDriveRoots finds Steam Proton pfx drive_c', () => {
  const home = '/home/player';
  const steam = path.join(home, '.local', 'share', 'Steam');
  const driveC = path.join(steam, 'steamapps', 'compatdata', '12345', 'pfx', 'drive_c');
  const exists = new Set([
    steam,
    path.join(steam, 'steamapps', 'compatdata'),
    driveC,
    path.join(home, '.wine', 'drive_c')
  ]);
  const roots = wineDriveRoots({
    platform: 'linux',
    homedir: () => home,
    existsSync: (p) => exists.has(p),
    readdirSync: (p) => {
      if (p.endsWith('compatdata')) return ['12345'];
      return [];
    }
  });
  assert.ok(roots.includes(driveC));
  assert.ok(roots.includes(path.join(home, '.wine', 'drive_c')));
});

test('installBases on linux joins RSI subdirs under ~/.wine/drive_c', () => {
  const home = '/home/x';
  const driveC = path.join(home, '.wine', 'drive_c');
  const bases = installBases({
    platform: 'linux',
    homedir: () => home,
    existsSync: (p) => p === driveC,
    readdirSync: () => []
  });
  assert.ok(bases.some((b) => b.startsWith(driveC) && b.includes('StarCitizen')));
});

test('discoverGameLogs returns existing channel logs under a base', () => {
  const base = '/sc';
  const live = path.join(base, 'LIVE', 'Game.log');
  const hotfix = path.join(base, 'HOTFIX', 'Game.log');
  const rows = discoverGameLogs({
    bases: [base],
    statSync: (f) => {
      if (f === live) return { mtimeMs: 100, size: 10, isFile: () => true };
      if (f === hotfix) return { mtimeMs: 200, size: 20, isFile: () => true };
      throw new Error('ENOENT');
    }
  });
  assert.strictEqual(rows.length, 2);
  assert.strictEqual(rows[0].channel, 'LIVE');
  assert.strictEqual(rows[1].channel, 'HOTFIX');
});

test('defaultLogFile is not the Windows C: path on linux', () => {
  const f = defaultLogFile({ platform: 'linux', homedir: () => '/home/u', existsSync: () => false });
  assert.ok(!/^C:\\/i.test(f));
  assert.ok(f.includes('StarCitizen'));
});

test('resolveLogFile auto-latest still works with bases', () => {
  const base = 'E:\\SC';
  const mtimes = {
    [path.join(base, 'LIVE', 'Game.log')]: 100,
    [path.join(base, 'HOTFIX', 'Game.log')]: 500
  };
  const r = resolveLogFile({
    bases: [base],
    statSync: (f) => { if (f in mtimes) return { mtimeMs: mtimes[f] }; throw new Error('ENOENT'); }
  });
  assert.strictEqual(r.channel, 'HOTFIX');
});

test('logCorpus discover + summarize reports pending vs synced', () => {
  const dir = path.join(__dirname, 'fixtures');
  const sample = path.join(dir, 'sample-missions.log');
  const files = logCorpus.discoverCorpusFiles({
    logfile: sample,
    includeLiveChannels: false,
    repoRoot: path.join(__dirname, '..', '..', '..', 'no-such-repo-root'),
    existsSync: (p) => p === sample || p === path.dirname(sample),
    realpathSync: (p) => p,
    readdirSync: () => []
  });
  assert.ok(files.includes(sample) || files.some((f) => f.endsWith('sample-missions.log')));

  const cursors = {};
  const summary = logCorpus.summarizeCorpus({
    files: [sample],
    cursors,
    history: { missions: [{ id: '1' }], deaths: [], sessions: [], players: ['a'], meta: {} },
    liveLogfile: sample
  });
  assert.strictEqual(summary.fileCount, 1);
  assert.strictEqual(summary.files[0].role, 'live');
  assert.strictEqual(summary.files[0].pending, true);
  assert.strictEqual(summary.historyCounts.missions, 1);
});

test('channelFromPath attributes LIVE/logbackups files to LIVE', () => {
  const scBackup = 'Game Build(12269732) 24 Jul 26 (10 33 36).log';
  assert.strictEqual(channelFromPath('C:/RSI/StarCitizen/LIVE/Game.log'), 'LIVE');
  assert.strictEqual(
    channelFromPath(`C:/RSI/StarCitizen/LIVE/logbackups/${scBackup}`),
    'LIVE'
  );
  assert.strictEqual(
    channelFromPath('/pfx/drive_c/Program Files/Roberts Space Industries/StarCitizen/LIVE/logbackups/session.log'),
    'LIVE'
  );
  assert.strictEqual(logbackupsBeside('/sc/LIVE/Game.log'), path.join('/sc/LIVE', 'logbackups'));
  assert.strictEqual(logbackupsBeside(`/sc/LIVE/logbackups/${scBackup}`), null);
});

test('discoverCorpusFiles imports sibling LIVE/logbackups next to Game.log', () => {
  // Real SC rotation name (spaces + build id + date/time).
  const backupName = 'Game Build(12269732) 24 Jul 26 (10 33 36).log';
  const liveLog = path.join('/custom', 'StarCitizen', 'LIVE', 'Game.log');
  const backupDir = path.join('/custom', 'StarCitizen', 'LIVE', 'logbackups');
  const backupFile = path.join(backupDir, backupName);
  const exists = new Set([liveLog, backupDir, backupFile]);
  const files = logCorpus.discoverCorpusFiles({
    logfile: liveLog,
    includeLiveChannels: false,
    repoRoot: '/no-such-repo',
    platform: 'linux',
    existsSync: (p) => exists.has(p),
    realpathSync: (p) => p,
    readdirSync: (dir, opts) => {
      if (dir === backupDir) {
        const ent = { name: backupName, isDirectory: () => false };
        return opts && opts.withFileTypes ? [ent] : [backupName];
      }
      return [];
    },
    homedir: () => '/home/nobody'
  });
  assert.ok(files.includes(liveLog), 'live Game.log included');
  assert.ok(files.includes(backupFile), 'SC-named LIVE/logbackups file imported into corpus');

  const summary = logCorpus.summarizeCorpus({
    files,
    cursors: {},
    history: { missions: [], deaths: [], sessions: [], players: [], meta: {} },
    liveLogfile: liveLog
  });
  const backupRow = summary.files.find((r) => r.path === backupFile);
  assert.ok(backupRow, 'backup summarized');
  assert.strictEqual(backupRow.role, 'backup');
  assert.strictEqual(backupRow.channel, 'LIVE');
});
