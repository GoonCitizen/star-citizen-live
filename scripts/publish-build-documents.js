#!/usr/bin/env node
'use strict';

/**
 * Publish final GoonCitizen builds into the **local node's** Files catalog.
 * Peers see them on Fabric `P2P_INVENTORY_REQUEST` once published.
 *
 * Usage:
 *   npm start                                          # local node (documents.enable)
 *   npm run build:browser                              # SPA → assets/index.html
 *   npm run build:desktop                              # optional installers → dist/
 *   npm run publish:builds -- [--dry-run] [--sats-per-kib 1] [--price N]
 *
 * Env: SC_RELAY_URL / PORT (default http://127.0.0.1:3041)
 */

const path = require('path');
const {
  listBuildArtifacts,
  resolveIngestPath,
  relayBase,
  publishArtifact,
  mimeForFilename
} = require('../functions/publishBuildDocuments');

const root = path.resolve(__dirname, '..');

function printHelp () {
  console.log(`Usage:
  npm run publish:builds -- [options] [extra-file…]

  Publish assets/index.html, dist/ installers, and Android APKs into this
  node's Files catalog (Advanced → Files). Requires a running local node
  with settings.documents.enable.

  --dry-run          List artifacts; do not POST
  --price <sats>     Flat list price per file (split across AMP blobs)
  --pin              Pin each published build to this node's profile (📌)
  --sats-per-kib <n> Override documents.satsPerKiB (default 1 = size-based)
  --sats-per-byte <n> Override documents.satsPerByte
  --host <url>       LiveRelay origin (default SC_RELAY_URL or http://127.0.0.1:3041)
  --no-spa           Skip assets/index.html
  --no-dist          Skip dist/ installers
  --no-apk           Skip android/app/build/outputs/**/*.apk
  extra-file         Extra path inside this repo (loopback ingest)

Env: SC_RELAY_URL, PORT, SC_HTTP_PORT
`);
}

function parseArgs (argv) {
  const opts = {
    dryRun: false,
    pin: false,
    price: null,
    satsPerKiB: null,
    satsPerByte: null,
    host: null,
    spa: true,
    dist: true,
    apk: true,
    extras: []
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--help' || a === '-h') {
      opts.help = true;
    } else if (a === '--dry-run') {
      opts.dryRun = true;
    } else if (a === '--pin' || a === '--pin-to-profile') {
      opts.pin = true;
    } else if (a === '--no-spa') {
      opts.spa = false;
    } else if (a === '--no-dist') {
      opts.dist = false;
    } else if (a === '--no-apk') {
      opts.apk = false;
    } else if (a === '--price' || a === '--purchasePriceSats') {
      opts.price = Math.max(0, Math.floor(Number(argv[++i])));
    } else if (a === '--sats-per-kib' || a === '--satsPerKiB') {
      opts.satsPerKiB = Number(argv[++i]);
    } else if (a === '--sats-per-byte' || a === '--satsPerByte') {
      opts.satsPerByte = Number(argv[++i]);
    } else if (a === '--host') {
      opts.host = argv[++i];
    } else if (a.startsWith('--price=')) {
      opts.price = Math.max(0, Math.floor(Number(a.slice('--price='.length))));
    } else if (a.startsWith('--sats-per-kib=')) {
      opts.satsPerKiB = Number(a.slice('--sats-per-kib='.length));
    } else if (a.startsWith('--sats-per-byte=')) {
      opts.satsPerByte = Number(a.slice('--sats-per-byte='.length));
    } else if (a.startsWith('--host=')) {
      opts.host = a.slice('--host='.length);
    } else if (a === '--') {
      opts.extras.push(...argv.slice(i + 1));
      break;
    } else if (a.startsWith('-')) {
      throw new Error('unknown flag: ' + a);
    } else {
      opts.extras.push(a);
    }
  }
  return opts;
}

async function main () {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) {
    printHelp();
    return 0;
  }

  const artifacts = listBuildArtifacts(root, {
    spa: opts.spa,
    dist: opts.dist,
    apk: opts.apk
  });
  for (const extra of opts.extras) {
    const abs = resolveIngestPath(path.resolve(extra), root);
    artifacts.push({
      kind: 'extra',
      path: abs,
      name: path.basename(abs),
      mime: mimeForFilename(abs)
    });
  }

  if (!artifacts.length) {
    console.error('[PUBLISH:BUILDS] no artifacts — run npm run build:browser (and build:desktop / android APK) first');
    return 1;
  }

  const host = relayBase({ host: opts.host });
  console.log('[PUBLISH:BUILDS] relay', host);
  for (const row of artifacts) {
    console.log('[PUBLISH:BUILDS]', row.kind, row.name, row.path);
  }

  if (opts.dryRun) {
    console.log('[PUBLISH:BUILDS] dry-run — ' + artifacts.length + ' file(s)');
    return 0;
  }

  const published = [];
  for (const row of artifacts) {
    const pubOpts = { host };
    if (opts.price != null) pubOpts.purchasePriceSats = opts.price;
    if (opts.satsPerKiB != null) pubOpts.satsPerKiB = opts.satsPerKiB;
    if (opts.satsPerByte != null) pubOpts.satsPerByte = opts.satsPerByte;
    if (opts.pin) pubOpts.pinToProfile = true;
    const doc = await publishArtifact(row, pubOpts);
    published.push(doc);
    const bits = [
      doc && doc.name,
      doc && doc.id,
      (doc && doc.size) + 'B',
      (doc && doc.blobTotal) + ' blobs',
      (doc && doc.purchasePriceSats) + ' sats',
      (doc && doc.profilePinned) || opts.pin ? 'pinned' : null
    ];
    console.log('[PUBLISH:BUILDS] published', bits.filter(Boolean).join(' '));
  }
  console.log('[PUBLISH:BUILDS] done — ' + published.length + ' document(s) in Files');
  return 0;
}

main().then((code) => {
  process.exit(code || 0);
}).catch((err) => {
  console.error('[PUBLISH:BUILDS]', err && err.message ? err.message : err);
  process.exit(1);
});
