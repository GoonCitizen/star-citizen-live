#!/usr/bin/env node
'use strict';

/**
 * Publisher relay: an isolated LiveRelay that publishes this tree's builds
 * (dashboard, installers, APKs) into its own Files catalog for a set of Hubs to
 * see through Fabric inventory. A local network's relay.goon.vc; the Hub
 * deploy (`hub.fabric.pub` `scripts/deploy.js`) drives it.
 *
 * It never runs `scripts/node.js` and never reads `.env`, `settings/local.js`,
 * or `~/.fabric`: its own generated key (`<dir>/key.json`), `HOME` inside
 * `<dir>`, no `FABRIC_*` / `SC_*` / `DISCORD_*` env, Discord and Bitcoin off,
 * no Game.log, and only the given peers.
 *
 * Usage:
 *   npm run publisher:relay -- start   --dir <dir> --port <http> --fabric-port <port>
 *                                      [--peer host:port]… [--network regtest]
 *                                      [--bitcoin-hub <url>] [--fabric-core <dir>]
 *                                      [--fabric-http <dir>] [--fresh] [--wait-peers <n>]
 *   npm run publisher:relay -- publish --dir <dir> [--no-spa] [--no-dist] [--no-apk] [--dry-run]
 *   npm run publisher:relay -- status  --dir <dir>
 *   npm run publisher:relay -- stop    --dir <dir>
 *   npm run publisher:relay -- reset   --dir <dir> [--keys]
 *
 * `--json` prints one JSON object on stdout (progress goes to stderr).
 */

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const {
  relayPaths,
  childEnv,
  fabricPackageRoots,
  liveRelayOptions,
  publishedRow
} = require('../functions/publisherRelay');
const {
  listBuildArtifacts,
  jsonRequest,
  publishArtifact
} = require('../functions/publishBuildDocuments');

const ROOT = path.join(__dirname, '..');
const TAG = '[PUBLISHER:RELAY]';

function log (...args) {
  console.error(TAG, ...args);
}

function sleep (ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseArgs (argv) {
  const first = argv[0] && !argv[0].startsWith('-') ? 1 : 0;
  const opts = { command: first ? argv[0] : null, peers: [], spa: true, dist: true, apk: true };
  const value = (i) => {
    if (argv[i] === undefined) throw new Error('missing value for ' + argv[i - 1]);
    return argv[i];
  };
  for (let i = first; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dir') opts.dir = path.resolve(value(++i));
    else if (a === '--port') opts.port = Number(value(++i));
    else if (a === '--fabric-port') opts.fabricPort = Number(value(++i));
    else if (a === '--peer') opts.peers.push(value(++i));
    else if (a === '--network') opts.network = value(++i);
    else if (a === '--bitcoin-hub') opts.bitcoinHub = value(++i);
    else if (a === '--fabric-core') opts.fabricCore = value(++i);
    else if (a === '--fabric-http') opts.fabricHttp = value(++i);
    else if (a === '--wait-peers') opts.waitPeers = Number(value(++i));
    else if (a === '--fresh') opts.fresh = true;
    else if (a === '--keys') opts.keys = true;
    else if (a === '--no-spa') opts.spa = false;
    else if (a === '--no-dist') opts.dist = false;
    else if (a === '--no-apk') opts.apk = false;
    else if (a === '--dry-run') opts.dryRun = true;
    else if (a === '--json') opts.json = true;
    else if (a === '--help' || a === '-h') opts.help = true;
    else if (opts.command === 'run' && !opts.settingsFile) opts.settingsFile = path.resolve(a);
    else throw new Error('unknown argument: ' + a);
  }
  return opts;
}

function readJson (file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (_) { return null; }
}

function writeJson (file, value, mode = 0o644) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2) + '\n', { mode });
  fs.renameSync(tmp, file);
  fs.chmodSync(file, mode);
}

function readPid (dir) {
  const n = Number(String((() => {
    try { return fs.readFileSync(relayPaths(dir).pidFile, 'utf8'); } catch (_) { return ''; }
  })()).trim());
  return Number.isInteger(n) && n > 0 ? n : null;
}

function pidAlive (pid) {
  if (!pid) return false;
  try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; }
}

/**
 * Resolve every require of the given `@fabric/*` packages (from this tree and
 * from each other) through `<dir>/runtime/node_modules`, symlinked to
 * `packages`, so one copy of each loads and package `exports` maps still apply.
 */
function useFabricPackages (dir, packages) {
  const names = Object.keys(packages || {}).filter((n) => packages[n]);
  if (!names.length) return;
  const Module = require('module');
  const runtime = path.join(dir, 'runtime');
  for (const name of names) {
    const link = path.join(runtime, 'node_modules', '@fabric', name);
    fs.mkdirSync(path.dirname(link), { recursive: true });
    let current = null;
    try { current = fs.readlinkSync(link); } catch (_) {}
    if (current !== packages[name]) {
      try { fs.unlinkSync(link); } catch (_) {}
      fs.symlinkSync(packages[name], link, 'dir');
    }
  }
  const redirected = (request) => names.some((n) => request === `@fabric/${n}` || request.startsWith(`@fabric/${n}/`));
  const resolve = Module._resolveFilename;
  Module._resolveFilename = function (request, parent, isMain, options) {
    if (redirected(request)) return resolve.call(this, request, parent, isMain, { paths: [runtime] });
    return resolve.call(this, request, parent, isMain, options);
  };
}

/** The relay's own key; kept across restarts and resets (unless `--keys`). */
function ensureKey (dir) {
  const file = relayPaths(dir).keyFile;
  const existing = readJson(file);
  if (existing && existing.xprv) {
    fs.chmodSync(file, 0o600);
    return existing;
  }
  const Key = require('@fabric/core/types/key');
  const key = new Key();
  const record = { xprv: key.xprv, pubkey: key.pubkey, createdAt: new Date().toISOString() };
  writeJson(file, record, 0o600);
  return record;
}

function settingsFor (opts) {
  const saved = readJson(relayPaths(opts.dir).settingsFile) || {};
  const pick = (name, fallback) => (opts[name] !== undefined ? opts[name] : (saved[name] !== undefined ? saved[name] : fallback));
  return {
    port: pick('port'),
    fabricPort: pick('fabricPort'),
    network: pick('network', 'regtest'),
    fabricPeers: opts.peers.length ? opts.peers : (saved.fabricPeers || []),
    bitcoinHub: pick('bitcoinHub', null),
    fabricPackages: fabricPackageRoots({ core: opts.fabricCore, http: opts.fabricHttp }, { root: ROOT })
  };
}

function relayGet (port, pathname, timeoutMs = 5000) {
  let timer = null;
  const timeout = new Promise((resolve, reject) => {
    timer = setTimeout(() => reject(new Error('timeout')), timeoutMs);
  });
  return Promise.race([jsonRequest(`http://127.0.0.1:${port}`, 'GET', pathname), timeout])
    .finally(() => clearTimeout(timer));
}

function peerConnected (p) {
  if (!p) return false;
  if (p.connected === true) return true;
  return /^(connected|open|online)$/i.test(String(p.status || p.state || ''));
}

async function status (dir) {
  const p = relayPaths(dir);
  const s = readJson(p.settingsFile) || {};
  const h = {
    dir,
    pid: readPid(dir),
    running: false,
    http: s.port ? `http://127.0.0.1:${s.port}` : null,
    fabric: s.fabricPort ? `127.0.0.1:${s.fabricPort}` : null,
    pubkey: (readJson(p.identityFile) || {}).pubkey || null,
    fabricPeers: null,
    documents: null,
    published: (readJson(p.publishedFile) || {}).documents || []
  };
  h.running = pidAlive(h.pid);
  if (!h.running || !s.port) return h;
  try {
    const r = await relayGet(s.port, '/services/star-citizen/peers');
    const rows = (r.body && r.body.data) || [];
    h.fabricPeers = rows.filter(peerConnected).length;
  } catch (_) {}
  try {
    const r = await relayGet(s.port, '/services/star-citizen/documents');
    const data = (r.body && r.body.data) || {};
    const rows = Array.isArray(data) ? data : data.documents;
    if (Array.isArray(rows)) h.documents = rows.filter((d) => d && d.published === true).length;
  } catch (_) {}
  return h;
}

async function stop (dir, timeoutMs = 45000) {
  const pid = readPid(dir);
  try { fs.unlinkSync(relayPaths(dir).pidFile); } catch (_) {}
  if (!pid || !pidAlive(pid)) return false;
  try { process.kill(pid, 'SIGTERM'); } catch (_) {}
  const t0 = Date.now();
  while (pidAlive(pid) && Date.now() - t0 < timeoutMs) await sleep(500);
  if (pidAlive(pid)) {
    try { process.kill(pid, 'SIGKILL'); } catch (_) {}
  }
  return true;
}

/** Remove the catalog (and everything else but the key unless `keys`). */
function clear (dir, { catalogOnly = false, keys = false } = {}) {
  const p = relayPaths(dir);
  if (!fs.existsSync(dir)) return;
  const names = catalogOnly
    ? [p.register, p.documents, p.publishedFile].map((f) => path.basename(f))
    : fs.readdirSync(dir).filter((name) => keys || name !== path.basename(p.keyFile));
  for (const name of names) fs.rmSync(path.join(dir, name), { recursive: true, force: true });
}

async function start (opts) {
  const dir = opts.dir;
  const p = relayPaths(dir);
  const settings = settingsFor(opts);
  if (!settings.port || !settings.fabricPort) throw new Error('--port and --fabric-port are required');

  const running = pidAlive(readPid(dir));
  if (running && !opts.fresh) {
    log('already running');
    return status(dir);
  }
  if (running) await stop(dir);
  if (opts.fresh) clear(dir, { catalogOnly: true });

  fs.mkdirSync(p.home, { recursive: true });
  useFabricPackages(dir, settings.fabricPackages);
  const key = ensureKey(dir);
  writeJson(p.settingsFile, { ...settings, xprv: key.xprv }, 0o600);

  const out = fs.openSync(p.logFile, 'a');
  const child = spawn(process.execPath, [__filename, 'run', p.settingsFile], {
    cwd: dir,
    env: childEnv(dir),
    detached: true,
    stdio: ['ignore', out, out]
  });
  child.unref();
  fs.closeSync(out);
  fs.writeFileSync(p.pidFile, String(child.pid) + '\n');
  log(`started pid ${child.pid}; log ${p.logFile}`);

  const t0 = Date.now();
  for (;;) {
    try {
      const r = await relayGet(settings.port, '/services/star-citizen/peers', 3000);
      if (r.status === 200) break;
    } catch (_) {}
    if (!pidAlive(child.pid)) throw new Error(`relay exited during start; see ${p.logFile}`);
    if (Date.now() - t0 > 120000) throw new Error(`HTTP 127.0.0.1:${settings.port} did not respond in time`);
    await sleep(500);
  }

  const want = opts.waitPeers !== undefined ? opts.waitPeers : settings.fabricPeers.length;
  let h = await status(dir);
  const t1 = Date.now();
  while ((h.fabricPeers || 0) < want) {
    if (Date.now() - t1 > 90000) {
      throw new Error(`${h.fabricPeers || 0} Fabric peer(s) after 90 s (wanted ${want})`);
    }
    await sleep(1000);
    h = await status(dir);
  }
  log(`up: ${h.http}, fabric ${h.fabric}, key ${h.pubkey}, ${h.fabricPeers} peer(s)`);
  return h;
}

async function publish (opts) {
  const dir = opts.dir;
  const s = readJson(relayPaths(dir).settingsFile);
  if (!s || !pidAlive(readPid(dir))) throw new Error('relay is not running; start it first');
  const artifacts = listBuildArtifacts(ROOT, { spa: opts.spa, dist: opts.dist, apk: opts.apk });
  if (!artifacts.length) throw new Error('no builds — run npm run build:browser (and build:installers) first');
  if (opts.dryRun) {
    for (const row of artifacts) log('would publish', row.kind, row.name);
    return { dryRun: true, artifacts: artifacts.map((a) => ({ kind: a.kind, name: a.name, path: a.path })) };
  }
  const host = `http://127.0.0.1:${s.port}`;
  const documents = [];
  for (const row of artifacts) {
    log('publishing', row.name);
    const doc = publishedRow(await publishArtifact(row, { host, pinToProfile: true }));
    documents.push(doc);
    log('published', doc.name, doc.id, `${doc.size}B`, `${doc.blobTotal} blobs`, `${doc.purchasePriceSats} sats`);
  }
  const record = { publishedAt: new Date().toISOString(), documents };
  writeJson(relayPaths(dir).publishedFile, record);
  return record;
}

/** The relay process itself (`start` spawns it). */
async function run (settingsFile) {
  const s = JSON.parse(fs.readFileSync(settingsFile, 'utf8'));
  const dir = path.dirname(settingsFile);
  const p = relayPaths(dir);
  useFabricPackages(dir, s.fabricPackages);
  const LiveRelay = require('../services/LiveRelay');
  const { Store } = require('../types/Store');
  const { loadFabricEnvIdentity } = require('../functions/fabricEnvIdentity');

  const identity = loadFabricEnvIdentity({ FABRIC_XPRV: s.xprv, HOME: p.home }, {
    allowWalletFallback: false,
    allowLocalIdentityFallback: false
  });
  if (!identity) throw new Error('could not restore the relay key');
  writeJson(p.identityFile, { pubkey: identity.pubkey });

  const store = new Store({ path: p.register });
  await store.start();
  const relay = new LiveRelay(liveRelayOptions(s, dir, store));
  relay.on('error', (e) => log((e && e.message) || e));
  await relay.start();
  relay.setIdentity(identity);
  log(`up: http 127.0.0.1:${s.port}, fabric 127.0.0.1:${s.fabricPort}, key ${identity.pubkey}`);

  const shutdown = async () => {
    try { await relay.stop(); } catch (_) {}
    process.exit(0);
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

function printHelp () {
  const text = fs.readFileSync(__filename, 'utf8').match(/\/\*\*([\s\S]*?)\*\//)[1];
  console.log(text.replace(/^ \* ?/gm, '').trim());
}

function print (opts, result) {
  if (opts.json) {
    process.stdout.write(JSON.stringify(result) + '\n');
    return;
  }
  console.log(JSON.stringify(result, null, 2));
}

async function main () {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help || !opts.command) {
    printHelp();
    return 0;
  }
  if (opts.command === 'run') {
    if (!opts.settingsFile) throw new Error('run <relay.json>');
    await run(opts.settingsFile);
    return null;
  }
  if (!opts.dir) throw new Error('--dir is required');
  switch (opts.command) {
    case 'start':
      print(opts, await start(opts));
      return 0;
    case 'publish':
      print(opts, await publish(opts));
      return 0;
    case 'status':
      print(opts, await status(opts.dir));
      return 0;
    case 'stop':
      print(opts, { stopped: await stop(opts.dir) });
      return 0;
    case 'reset':
      await stop(opts.dir);
      clear(opts.dir, { keys: !!opts.keys });
      print(opts, { reset: true, keys: !!opts.keys });
      return 0;
    default:
      throw new Error('unknown command: ' + opts.command);
  }
}

if (require.main === module) {
  main().then((code) => {
    if (code !== null) process.exit(code);
  }).catch((err) => {
    log((err && err.message) || err);
    process.exit(1);
  });
}

module.exports = { start, publish, status, stop, clear };
