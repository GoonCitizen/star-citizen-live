'use strict';

/**
 * Capacitor-NodeJS entry helper. The plugin loads `nodejs/index.js` via
 * `require()`, so `require.main === module` is never true inside
 * `scripts/android-node.js`. This always invokes `main()` so LiveRelay binds
 * loopback HTTP (chat, groups, store, replay).
 */

const fs = require('fs');
const path = require('path');

function signalBridgeReady () {
  try {
    const bridge = require('bridge');
    if (bridge && bridge.channel && typeof bridge.channel.send === 'function') {
      bridge.channel.send('ready');
    }
  } catch (_) { /* desktop / tests — no Capacitor bridge */ }
}

function resolveAndroidNodeScript (nodejsRoot, fsImpl) {
  const fsUse = fsImpl || fs;
  const staged = path.join(nodejsRoot, 'app', 'scripts', 'android-node.js');
  const repo = path.join(nodejsRoot, '..', '..', 'scripts', 'android-node.js');
  if (fsUse.existsSync(staged)) {
    if (!process.env.SC_APP_ROOT) process.env.SC_APP_ROOT = path.join(nodejsRoot, 'app');
    return staged;
  }
  if (fsUse.existsSync(repo)) return repo;
  throw new Error('GoonCitizen Android node missing — run npm run android:sync');
}

/**
 * @param {string} nodejsRoot Directory that contains `index.js` (`android-www/nodejs`).
 * @param {Object} [opts]
 * @param {Function} [opts.requireImpl]
 * @param {typeof fs} [opts.fs]
 * @param {boolean} [opts.signalReady=true]
 * @returns {Promise<*>}
 */
function runFromNodejsRoot (nodejsRoot, opts = {}) {
  if (opts.signalReady !== false) signalBridgeReady();
  const script = resolveAndroidNodeScript(nodejsRoot, opts.fs);
  const req = opts.requireImpl || require;
  const mod = req(script);
  if (!mod || typeof mod.main !== 'function') {
    throw new Error('android-node missing main()');
  }
  return Promise.resolve(mod.main());
}

module.exports = {
  signalBridgeReady,
  resolveAndroidNodeScript,
  runFromNodejsRoot
};
