'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');

const fsBrowser = require('../../functions/fsBrowser');
const settingsStore = require('../../functions/settingsStore');
const logCorpus = require('../../functions/logCorpus');
const LiveRelay = require('../../services/LiveRelay');
const { Store } = require('../../types/Store');

function tmpDir () {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'sc-fsbrowser-'));
}

function request (port, method, reqPath, payload) {
  return new Promise((resolve, reject) => {
    const req = http.request({
      host: '127.0.0.1',
      port,
      method,
      path: reqPath,
      headers: { 'Content-Type': 'application/json' }
    }, (res) => {
      let buf = '';
      res.on('data', (c) => { buf += c; });
      res.on('end', () => resolve({ status: res.statusCode, body: buf ? JSON.parse(buf) : null }));
    });
    req.on('error', reject);
    if (payload) req.write(JSON.stringify(payload));
    req.end();
  });
}

test('sanitizeCorpusDirs resolves unique absolute paths', () => {
  const a = path.resolve('/tmp/a');
  const b = path.resolve('/tmp/b');
  assert.deepStrictEqual(
    fsBrowser.sanitizeCorpusDirs(['/tmp/a', '/tmp/a/', '  /tmp/b  ', '', null, 1]),
    [a, b]
  );
  assert.deepStrictEqual(fsBrowser.sanitizeCorpusDirs(null), []);
});

test('listDirectory lists dirs and .log files with badges', () => {
  const dir = tmpDir();
  const sub = path.join(dir, 'backups');
  fs.mkdirSync(sub);
  fs.writeFileSync(path.join(dir, 'Game.log'), 'x');
  fs.writeFileSync(path.join(dir, 'notes.txt'), 'y');
  fs.writeFileSync(path.join(sub, 'old.log'), 'z');
  fs.writeFileSync(path.join(dir, '.hidden'), 'h');

  const listing = fsBrowser.listDirectory(dir);
  assert.strictEqual(listing.type, 'FsListing');
  assert.strictEqual(listing.path, fs.realpathSync(path.resolve(dir)));
  assert.strictEqual(listing.logCount, 1);
  assert.ok(listing.entries.some((e) => e.name === 'backups' && e.type === 'dir' && e.logCount === 1));
  assert.ok(listing.entries.some((e) => e.name === 'Game.log' && e.isLog));
  assert.ok(listing.entries.some((e) => e.name === 'notes.txt' && !e.isLog));
  assert.ok(!listing.entries.some((e) => e.name === '.hidden'));

  fs.rmSync(dir, { recursive: true, force: true });
});

test('discoverCorpusFiles includes extraDirs from the file browser', () => {
  const dir = tmpDir();
  const logFile = path.join(dir, 'imported.log');
  fs.writeFileSync(logFile, 'line\n');
  const files = logCorpus.discoverCorpusFiles({
    logfile: null,
    includeLiveChannels: false,
    repoRoot: path.join(dir, 'no-repo'),
    extraDirs: [dir],
    existsSync: (p) => fs.existsSync(p),
    realpathSync: (p) => fs.realpathSync(p),
    readdirSync: (p, opts) => fs.readdirSync(p, opts),
    platform: 'linux',
    homedir: () => path.join(dir, 'home')
  });
  assert.ok(files.includes(fs.realpathSync(logFile)) || files.includes(path.resolve(logFile)));
  fs.rmSync(dir, { recursive: true, force: true });
});

test('corpusDirs and corpusFiles settings round-trip on the Fabric Store', async () => {
  const dir = tmpDir();
  const store = new Store({ path: path.join(dir, 'register') });
  await store.start();
  assert.ok(settingsStore.ALLOWED_KEYS.includes('corpusDirs'));
  assert.ok(settingsStore.ALLOWED_KEYS.includes('corpusFiles'));
  settingsStore.putSetting(store, 'corpusDirs', ['/logs/a', '/logs/a', '/logs/b']);
  settingsStore.putSetting(store, 'corpusFiles', ['/logs/a/Game.log', '/logs/a/Game.log']);
  const loaded = settingsStore.loadSettings(store);
  assert.deepStrictEqual(loaded.corpusDirs, [
    path.resolve('/logs/a'),
    path.resolve('/logs/b')
  ]);
  assert.deepStrictEqual(loaded.corpusFiles, [path.resolve('/logs/a/Game.log')]);
  settingsStore.putSetting(store, 'corpusDirs', []);
  settingsStore.putSetting(store, 'corpusFiles', []);
  assert.strictEqual(settingsStore.loadSettings(store).corpusDirs, undefined);
  assert.strictEqual(settingsStore.loadSettings(store).corpusFiles, undefined);
  await store.stop();
  fs.rmSync(dir, { recursive: true, force: true });
});

test('GET /fs and POST /corpus/import persist dirs and individual files', async () => {
  const root = tmpDir();
  const logsDir = path.join(root, 'my-logs');
  fs.mkdirSync(logsDir);
  const gameLog = path.join(logsDir, 'Game.log');
  const loneLog = path.join(root, 'lone-session.log');
  // Minimal line so cumulative sync has something to chew on.
  fs.writeFileSync(gameLog, '<2026-07-19T12:00:00.000Z> [Notice] <MissionSystem> Mission m1 started\n');
  fs.writeFileSync(loneLog, '<2026-07-19T13:00:00.000Z> [Notice] <MissionSystem> Mission m2 started\n');

  const svc = new LiveRelay({
    port: 0,
    settingsDir: root,
    logfile: null,
    missions: { enable: false },
    fabric: { enable: false },
    peers: []
  });
  await svc.start();
  const port = svc.server.address().port;
  try {
    const listing = await request(port, 'GET', `/services/star-citizen/fs?path=${encodeURIComponent(logsDir)}`);
    assert.strictEqual(listing.status, 200);
    assert.strictEqual(listing.body.type, 'FsListing');
    assert.ok(listing.body.entries.some((e) => e.name === 'Game.log' && e.isLog));

    const importedDir = await request(port, 'POST', '/services/star-citizen/corpus/import', {
      dirs: [logsDir],
      sync: true
    });
    assert.strictEqual(importedDir.status, 200, JSON.stringify(importedDir.body));
    assert.strictEqual(importedDir.body.type, 'LogCorpusImport');
    assert.ok(importedDir.body.importedDirs.some((d) => path.resolve(d) === path.resolve(logsDir)));

    const importedFile = await request(port, 'POST', '/services/star-citizen/corpus/import', {
      files: [loneLog],
      sync: true
    });
    assert.strictEqual(importedFile.status, 200, JSON.stringify(importedFile.body));
    assert.ok(importedFile.body.importedFiles.some((f) => path.resolve(f) === path.resolve(loneLog)));
    assert.ok(importedFile.body.corpus.fileCount >= 2);

    const corpus = await request(port, 'GET', '/services/star-citizen/corpus');
    assert.ok(corpus.body.importedDirs.length >= 1);
    assert.ok(corpus.body.importedFiles.length >= 1);
    assert.ok(corpus.body.files.some((f) => f.path.includes('Game.log')));
    assert.ok(corpus.body.files.some((f) => f.path.includes('lone-session.log')));

    const removedFile = await request(port, 'POST', '/services/star-citizen/corpus/remove', {
      files: [loneLog]
    });
    assert.strictEqual(removedFile.status, 200);
    assert.strictEqual(removedFile.body.importedFiles.length, 0);

    const removed = await request(port, 'POST', '/services/star-citizen/corpus/remove', {
      dirs: [logsDir]
    });
    assert.strictEqual(removed.status, 200);
    assert.strictEqual(removed.body.importedDirs.length, 0);
  } finally {
    await svc.stop();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('filesystem browse is refused in hosted server mode', async () => {
  const svc = new LiveRelay({
    port: 0,
    mode: 'server',
    settingsDir: tmpDir(),
    missions: { enable: false },
    fabric: { enable: false }
  });
  await svc.start();
  const port = svc.server.address().port;
  try {
    assert.strictEqual((await request(port, 'GET', '/services/star-citizen/fs')).status, 400);
    assert.strictEqual((await request(port, 'POST', '/services/star-citizen/corpus/import', { dirs: ['/x'] })).status, 400);
  } finally {
    await svc.stop();
  }
});
