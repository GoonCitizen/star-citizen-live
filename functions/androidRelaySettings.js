'use strict';

/**
 * LiveRelay settings for a local-first Android node (D-010 / threat model).
 *
 * HTTP stays on loopback. The Fabric Peer is the only remote plane. No Game.log,
 * Discord bot, Hub Bitcoin proxy, or document HTTPS.
 */

const path = require('path');
const { Store } = require('../types/Store');
const { storeRoot, registerPath } = require('./storePaths');

function csv (value) {
  return String(value || '').split(',').map((s) => s.trim()).filter(Boolean);
}

function resolveAndroidSettingsDir (opts = {}) {
  const env = opts.env || process.env;
  if (env.SC_SETTINGS_DIR) return storeRoot(env.SC_SETTINGS_DIR);
  if (opts.settingsDir) return storeRoot(opts.settingsDir);
  if (opts.dataPath) return storeRoot(path.join(opts.dataPath, 'stores'));
  return storeRoot(path.join(__dirname, '..', 'stores'));
}

/**
 * @param {Object} [opts]
 * @param {NodeJS.ProcessEnv} [opts.env]
 * @param {string} [opts.settingsDir]
 * @param {string} [opts.dataPath] nodejs-mobile writable dir (`bridge.getDataPath()`)
 * @param {import('../types/Store')} [opts.store]
 * @returns {Promise<Object>}
 */
async function buildAndroidRelaySettings (opts = {}) {
  const env = opts.env || process.env;
  const settingsDir = resolveAndroidSettingsDir(opts);
  const registerDir = env.SC_REGISTER_DIR || registerPath(settingsDir);
  const store = opts.store || new Store({ path: registerDir, json: true });
  // LiveRelay.start() opens the store after loopback HTTP is bound. Starting
  // it here would hide JSON-collection load behind the wait screen.

  const fabricPort = Number(env.FABRIC_PORT);
  const httpPort = Number(env.PORT);
  return {
    port: (Number.isFinite(httpPort) && httpPort > 0) ? httpPort : 3041,
    mode: 'android',
    logfile: null,
    seed: null,
    channel: null,
    httpSharedMode: false,
    httpHost: '127.0.0.1',
    settingsDir,
    historyFile: path.join(settingsDir, 'history.json'),
    cursorsFile: path.join(settingsDir, 'log-cursors.json'),
    store,
    missions: {
      enable: true,
      dir: registerDir,
      officers: csv(env.SC_OFFICERS)
    },
    discord: { enable: false },
    uplink: { intervalMs: 5000 },
    fabric: {
      enable: env.SC_FABRIC === '0' ? false : true,
      listen: true,
      port: (Number.isFinite(fabricPort) && fabricPort > 0) ? fabricPort : 7777,
      interface: env.FABRIC_INTERFACE || env.FABRIC_PEER_INTERFACE || '0.0.0.0'
    },
    payouts: { enable: true, ledger: true, network: env.SC_BTC_NETWORK || 'regtest' },
    bitcoin: { enable: false },
    documents: { enable: false },
    ingest: { httpEnable: false }
  };
}

module.exports = {
  buildAndroidRelaySettings,
  resolveAndroidSettingsDir
};
