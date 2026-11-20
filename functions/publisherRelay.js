'use strict';

/**
 * Helpers for an isolated publisher relay: a LiveRelay that holds nothing but
 * its own key and the Files catalog of GoonCitizen builds, peered only with the
 * Hubs it is given (a local network's stand-in for relay.goon.vc). Used by
 * `scripts/publisher-relay.js` and `scripts/deploy-local.js`.
 *
 * The relay never loads this repo's `.env`, `settings/local.js`, or
 * `~/.fabric/env`: no operator identity, Discord, Hub admin token, or Game.log.
 */

const fs = require('fs');
const path = require('path');

const ENV_PREFIXES = ['FABRIC_', 'SC_', 'DISCORD_', 'GOON_', 'BITCOIN_', 'ELECTRON_'];
const ENV_NAMES = ['PORT', 'INTERFACE', 'HOSTNAME', 'NODE_OPTIONS'];

/** `@fabric/*` trees the relay can run on, as in `scripts/ensure-fabric-linked.js`. */
const FABRIC_PACKAGES = {
  core: { env: 'FABRIC_CORE', siblings: ['fabric-clean', 'fabric'], probe: path.join('types', 'key.js') },
  http: { env: 'FABRIC_HTTP', siblings: ['fabric-http'], probe: path.join('functions', 'fabricPubkey.js') }
};

/**
 * Files in a publisher relay's directory.
 * @param {string} dir
 */
function relayPaths (dir) {
  return {
    dir,
    home: path.join(dir, 'home'),
    register: path.join(dir, 'register'),
    documents: path.join(dir, 'documents'),
    settingsFile: path.join(dir, 'relay.json'),
    keyFile: path.join(dir, 'key.json'),
    identityFile: path.join(dir, 'identity.json'),
    publishedFile: path.join(dir, 'published.json'),
    logFile: path.join(dir, 'relay.log'),
    pidFile: path.join(dir, 'relay.pid')
  };
}

/**
 * Process env for the relay: PATH and the like, nothing that configures
 * GoonCitizen or names an identity. `HOME` is inside the relay directory so
 * every `~/.fabric` fallback stays there.
 * @param {string} dir relay directory
 * @param {Object} [env] defaults to `process.env`
 * @returns {Object}
 */
function childEnv (dir, env = process.env) {
  const out = {};
  for (const [name, value] of Object.entries(env)) {
    if (ENV_NAMES.includes(name)) continue;
    if (ENV_PREFIXES.some((p) => name.startsWith(p))) continue;
    out[name] = value;
  }
  out.HOME = relayPaths(dir).home;
  out.NODE_ENV = 'production';
  return out;
}

/**
 * Resolve the `@fabric/core` / `@fabric/http` trees: explicit dir, then
 * `FABRIC_CORE` / `FABRIC_HTTP`, then a sibling checkout. A package with no
 * match is left out and the relay keeps the installed copy.
 * @param {Object} [explicit] `{ core, http }`
 * @param {Object} [opts]
 * @param {string} [opts.root] this repo (siblings are looked up next to it)
 * @param {Object} [opts.env]
 * @returns {{ core?: string, http?: string }} real paths
 */
function fabricPackageRoots (explicit = {}, opts = {}) {
  const root = opts.root || path.join(__dirname, '..');
  const env = opts.env || process.env;
  const out = {};
  for (const [name, spec] of Object.entries(FABRIC_PACKAGES)) {
    const candidates = [explicit[name], env[spec.env]]
      .concat(spec.siblings.map((s) => path.join(root, '..', s)))
      .filter(Boolean);
    for (const candidate of candidates) {
      const dir = path.resolve(candidate);
      if (fs.existsSync(path.join(dir, spec.probe))) {
        out[name] = fs.realpathSync(dir);
        break;
      }
    }
  }
  return out;
}

/**
 * LiveRelay settings for a publisher relay.
 * @param {Object} settings saved `relay.json`
 * @param {string} dir relay directory
 * @param {Object} store started register Store
 * @returns {Object}
 */
function liveRelayOptions (settings, dir, store) {
  const p = relayPaths(dir);
  return {
    port: settings.port,
    httpHost: '127.0.0.1',
    // No Game.log: a file that never exists, and no corpus directories.
    logfile: path.join(dir, 'no-game.log'),
    channel: null,
    seed: null,
    reparse: { dirs: [] },
    settingsDir: dir,
    historyFile: path.join(dir, 'history.json'),
    cursorsFile: path.join(dir, 'log-cursors.json'),
    store,
    missions: { enable: true, dir: p.register, officers: [] },
    discord: { enable: false },
    uplink: { intervalMs: 5000 },
    fabric: {
      enable: true,
      listen: true,
      port: settings.fabricPort,
      interface: '127.0.0.1',
      peersDb: path.join(dir, 'peers')
    },
    peers: (settings.fabricPeers || []).map((address) => ({ address, enabled: true })),
    payouts: { enable: true, ledger: true, network: settings.network },
    bitcoin: {
      enable: false,
      hub: settings.bitcoinHub || null,
      network: settings.network,
      adminToken: null,
      adminTokenFile: null
    },
    documents: { enable: true }
  };
}

/**
 * Hubs of a Fabric local network profile (`FabricLocalNetworkProfile`, written
 * by the Hub's `npm run deploy -- --local`): the signing instances, not the seed.
 * @param {Object} profile
 * @returns {Array<{ name: string, http: string, fabric: string }>}
 */
function profileHubs (profile) {
  if (!profile || profile.type !== 'FabricLocalNetworkProfile') {
    throw new Error('not a FabricLocalNetworkProfile');
  }
  return (profile.instances || [])
    .filter((i) => i && i.signer === true && i.http && i.fabric)
    .map((i) => ({ name: i.name, http: i.http, fabric: i.fabric }));
}

/**
 * Ports for a relay joining a local network: one past the highest HTTP and
 * Fabric ports of the profile's instances.
 * @param {Object} profile
 * @returns {{ http: number, fabric: number }}
 */
function nextPorts (profile) {
  const port = (address) => Number(String(address || '').split(':').pop()) || 0;
  const instances = (profile && profile.instances) || [];
  const http = Math.max(0, ...instances.map((i) => port(String(i.http || '').replace(/\/+$/, ''))));
  const fabric = Math.max(0, ...instances.map((i) => port(i.fabric)));
  if (!http || !fabric) throw new Error('profile lists no instance ports');
  return { http: http + 1, fabric: fabric + 1 };
}

/**
 * The fields a caller needs from a published catalog row.
 * @param {Object} doc
 * @returns {{ name: string, id: string, size: number, blobTotal: number|null, purchasePriceSats: number }}
 */
function publishedRow (doc) {
  const d = doc || {};
  return {
    name: d.name || null,
    id: d.id || null,
    size: Number(d.size) || 0,
    blobTotal: Number(d.blobTotal) || null,
    purchasePriceSats: Number(d.purchasePriceSats) || 0
  };
}

module.exports = {
  ENV_PREFIXES,
  ENV_NAMES,
  relayPaths,
  childEnv,
  fabricPackageRoots,
  liveRelayOptions,
  profileHubs,
  nextPorts,
  publishedRow
};
