#!/usr/bin/env node
'use strict';

/**
 * Deploy GoonCitizen onto a local Fabric network: run relay-goon-vc (this
 * network's relay.goon.vc, a publisher relay — `scripts/publisher-relay.js`)
 * peered with the network's Hubs, publish this tree's builds into its Files
 * catalog, and check that every Hub lists them through Fabric inventory
 * (`RefreshDocumentMarket` / `ListDocumentOffers`).
 *
 * The Hubs come from the network profile the Hub writes
 * (`npm run deploy -- --network <n> --local start` in hub.fabric.pub):
 * `--profile <file>`, else `<hub>/stores/local-network/<network>/network-profile.json`
 * with `<hub>` = `--hub <dir>`, `FABRIC_HUB`, or the sibling `../hub.fabric.pub`.
 *
 * Usage:
 *   npm run deploy:local -- [start|publish|status|stop|reset] [--network regtest]
 *                           [--profile <file> | --hub <dir>] [--dir <relay dir>]
 *                           [--port <http>] [--fabric-port <port>] [--no-apk]
 *                           [--fabric-core <dir>] [--fabric-http <dir>] [--keys] [--json]
 *
 *   start    (re)start relay-goon-vc with an empty catalog, publish the builds
 *            (npm run build:installers:packed first), check the Hubs list them
 *   publish  same as start
 *   status   relay health
 *   stop     stop the relay
 *   reset    stop, then delete everything but the relay key (`--keys` too)
 *
 * The relay lives in `stores/local-network/<network>/relay-goon-vc/` and keeps
 * its key there; its ports default to one past the profile's instances.
 */

const fs = require('fs');
const path = require('path');
const relay = require('./publisher-relay');
const { profileHubs, nextPorts } = require('../functions/publisherRelay');
const { jsonRequest } = require('../functions/publishBuildDocuments');

const ROOT = path.join(__dirname, '..');
const NAME = 'relay-goon-vc';
const TAG = '[DEPLOY:LOCAL]';

function log (...args) {
  console.error(TAG, ...args);
}

function sleep (ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseArgs (argv) {
  const opts = { command: 'start', network: 'regtest', apk: true };
  const value = (i) => {
    if (argv[i] === undefined) throw new Error('missing value for ' + argv[i - 1]);
    return argv[i];
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--network' || a === '-n') opts.network = value(++i);
    else if (a === '--profile') opts.profile = path.resolve(value(++i));
    else if (a === '--hub') opts.hub = path.resolve(value(++i));
    else if (a === '--dir') opts.dir = path.resolve(value(++i));
    else if (a === '--port') opts.port = Number(value(++i));
    else if (a === '--fabric-port') opts.fabricPort = Number(value(++i));
    else if (a === '--fabric-core') opts.fabricCore = value(++i);
    else if (a === '--fabric-http') opts.fabricHttp = value(++i);
    else if (a === '--no-apk') opts.apk = false;
    else if (a === '--keys') opts.keys = true;
    else if (a === '--json') opts.json = true;
    else if (a === '--help' || a === '-h') opts.command = 'help';
    else if (!a.startsWith('-')) opts.command = a;
    else throw new Error('unknown flag: ' + a);
  }
  return opts;
}

function profileFile (opts) {
  if (opts.profile) return opts.profile;
  const hub = opts.hub || process.env.FABRIC_HUB || path.join(ROOT, '..', 'hub.fabric.pub');
  return path.join(hub, 'stores', 'local-network', opts.network, 'network-profile.json');
}

function readProfile (opts) {
  const file = profileFile(opts);
  let profile = null;
  try { profile = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (_) {}
  if (!profile) throw new Error(`no network profile at ${file}; start the Hub network first (hub.fabric.pub: npm run deploy -- --network ${opts.network} --local start)`);
  if (profile.network && profile.network !== opts.network) {
    throw new Error(`${file} is a ${profile.network} profile, not ${opts.network}`);
  }
  return profile;
}

function relayDir (opts) {
  return opts.dir || path.join(ROOT, 'stores', 'local-network', opts.network, NAME);
}

function hubRpc (base, method, timeoutMs = 15000) {
  let timer = null;
  const timeout = new Promise((resolve, reject) => {
    timer = setTimeout(() => reject(new Error('timeout')), timeoutMs);
  });
  const call = jsonRequest(base, 'POST', '/services/rpc', { jsonrpc: '2.0', id: Date.now(), method, params: [] });
  return Promise.race([call, timeout]).finally(() => clearTimeout(timer));
}

/**
 * Ask a Hub for its peers' inventories until it lists every document id.
 * @returns {Promise<{ seen: string[], missing: string[], offers: number }>}
 */
async function hubLists (hub, ids, timeoutMs = 90000) {
  const want = new Set(ids);
  const t0 = Date.now();
  let seen = new Set();
  let offers = 0;
  while (Date.now() - t0 < timeoutMs) {
    try { await hubRpc(hub.http, 'RefreshDocumentMarket'); } catch (_) {}
    await sleep(2000);
    try {
      const r = await hubRpc(hub.http, 'ListDocumentOffers');
      const result = (r.body && r.body.result) || {};
      const rows = Array.isArray(result) ? result : (result.offers || result.data || []);
      offers = rows.length;
      seen = new Set(rows.map((o) => String(o.documentId || o.id || '').toLowerCase()).filter((id) => want.has(id)));
      if (seen.size === want.size) break;
    } catch (_) {}
  }
  return { seen: [...seen], missing: ids.filter((id) => !seen.has(id)), offers };
}

async function deploy (opts) {
  const profile = readProfile(opts);
  const hubs = profileHubs(profile);
  if (!hubs.length) throw new Error('the network profile lists no Hubs');
  const ports = nextPorts(profile);
  const dir = relayDir(opts);
  log(`${NAME}: ${dir}, peers ${hubs.map((h) => `${h.name} ${h.fabric}`).join(', ')}`);

  await relay.start({
    dir,
    fresh: true,
    port: opts.port || ports.http,
    fabricPort: opts.fabricPort || ports.fabric,
    network: profile.network || opts.network,
    peers: hubs.map((h) => h.fabric),
    fabricCore: opts.fabricCore,
    fabricHttp: opts.fabricHttp
  });

  const { documents } = await relay.publish({ dir, spa: true, dist: true, apk: opts.apk });
  if (!documents.some((d) => !/\.html$/i.test(d.name))) {
    throw new Error('nothing but the dashboard was published; run npm run build:installers:packed first');
  }

  const ids = documents.map((d) => d.id);
  const problems = [];
  for (const hub of hubs) {
    const result = await hubLists(hub, ids);
    log(`${hub.name}: lists ${result.seen.length}/${ids.length} GoonCitizen document(s) from ${NAME} (${result.offers} offer(s) in total)`);
    if (result.missing.length) {
      const names = documents.filter((d) => result.missing.includes(d.id)).map((d) => d.name);
      problems.push(`${hub.name} does not list ${names.join(', ')}`);
    }
  }
  for (const d of documents.filter((row) => !row.blobTotal)) {
    log(`${d.name} is listed but has no blob pack: over the Fabric document limit ` +
      '(core MAX_DOCUMENT_BLOBS × blob size), so peers can see it but not fetch it');
  }
  if (problems.length) throw new Error(`publish not visible:\n  - ${problems.join('\n  - ')}`);
  return relay.status(dir);
}

function printHealth (h) {
  const mib = (n) => (n / 1048576).toFixed(1) + ' MiB';
  console.log(`${NAME}  ${h.running ? 'up  ' : 'down'} ${h.http || ''}  fabric ${h.fabric || '?'}`);
  if (h.running) {
    console.log(`${''.padEnd(NAME.length)}  fabric peers ${h.fabricPeers == null ? '?' : h.fabricPeers}  documents ${h.documents == null ? '?' : h.documents}  key ${h.pubkey || '?'}`);
  }
  for (const d of h.published || []) {
    const pack = d.blobTotal ? `${d.blobTotal} blobs` : 'listed only, over the document limit';
    console.log(`${''.padEnd(NAME.length)}  published ${d.name} (${mib(d.size)}, ${d.purchasePriceSats} sats, ${pack})`);
  }
}

function printHelp () {
  const text = fs.readFileSync(__filename, 'utf8').match(/\/\*\*([\s\S]*?)\*\//)[1];
  console.log(text.replace(/^ \* ?/gm, '').trim());
}

async function main () {
  const opts = parseArgs(process.argv.slice(2));
  const dir = relayDir(opts);
  let result;
  switch (opts.command) {
    case 'help':
      printHelp();
      return;
    case 'start':
    case 'publish':
      result = await deploy(opts);
      break;
    case 'status':
      result = await relay.status(dir);
      break;
    case 'stop':
      result = { stopped: await relay.stop(dir) };
      log(`${NAME}: ${result.stopped ? 'stopped' : 'not running'}`);
      break;
    case 'reset':
      await relay.stop(dir);
      relay.clear(dir, { keys: !!opts.keys });
      result = { reset: true, keys: !!opts.keys };
      log(`${NAME}: reset${opts.keys ? ' (key removed)' : ''}`);
      break;
    default:
      throw new Error('unknown command: ' + opts.command);
  }
  if (opts.json) console.log(JSON.stringify(result));
  else if (result && 'running' in result) printHealth(result);
}

main().catch((err) => {
  log((err && err.message) || err);
  process.exit(1);
});
