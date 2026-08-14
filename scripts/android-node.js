'use strict';

/**
 * Embedded Android entry — local LiveRelay + Fabric Peer (D-010).
 * HTTP binds loopback. Remote I/O is Fabric TCP/NOISE only.
 *
 * Run from repo: `SC_MODE=android node scripts/android-node.js`
 * On device: Capacitor-NodeJS loads `android-www/nodejs/index.js`, which
 * always calls `main()` (require.main is index.js, not this file).
 */

const fs = require('fs');
const path = require('path');

function appRoot () {
  if (process.env.SC_APP_ROOT) return path.resolve(process.env.SC_APP_ROOT);
  const here = __dirname;
  if (fs.existsSync(path.join(here, '..', 'services', 'LiveRelay.js'))) {
    return path.join(here, '..');
  }
  if (fs.existsSync(path.join(here, 'services', 'LiveRelay.js'))) return here;
  return path.join(here, '..');
}

function writableDataPath () {
  try {
    const { getDataPath } = require('bridge');
    const p = getDataPath();
    if (p) return p;
  } catch (_) { /* desktop / tests */ }
  if (process.env.SC_SETTINGS_DIR) return process.env.SC_SETTINGS_DIR;
  return path.join(appRoot(), 'stores');
}

async function main () {
  const root = appRoot();
  process.env.SC_MODE = 'android';
  if (!process.env.FABRIC_HUB_INTERFACE && !process.env.INTERFACE && !process.env.FABRIC_HTTP_INTERFACE) {
    process.env.FABRIC_HUB_INTERFACE = '127.0.0.1';
  }
  const dataPath = writableDataPath();
  process.env.SC_SETTINGS_DIR = process.env.SC_SETTINGS_DIR || path.join(dataPath, 'stores');

  let LiveRelay;
  try {
    LiveRelay = require(path.join(root, 'services', 'LiveRelay.js'));
  } catch (e) {
    console.error('[STAR-CITIZEN] [ERROR] cannot load LiveRelay:', e && e.stack ? e.stack : e);
    throw e;
  }
  let identity = null;
  let source = null;
  const { applyGoonCitizenEnvAliases } = require(path.join(root, 'functions', 'goonCitizenEnvAliases.js'));
  applyGoonCitizenEnvAliases(process.env);
  try {
    const { applyFabricEnvConfig, loadRepoDotEnv } = require(path.join(root, 'functions', 'fabricEnvIdentity.js'));
    loadRepoDotEnv(root);
    ({ identity, source } = applyFabricEnvConfig(process.env));
  } catch (e) {
    console.warn('[STAR-CITIZEN] fabric env identity skipped:', e && e.message ? e.message : e);
  }
  const { buildAndroidRelaySettings } = require(path.join(root, 'functions', 'androidRelaySettings.js'));
  const settings = await buildAndroidRelaySettings({ dataPath: process.env.SC_SETTINGS_DIR });
  const service = new LiveRelay(settings);
  try {
    await service.start();
  } catch (e) {
    console.error('[STAR-CITIZEN] [ERROR] LiveRelay start:', e && e.stack ? e.stack : e);
    if (!service.server) throw e;
    console.warn('[STAR-CITIZEN] loopback HTTP is up — keeping the local node after start error');
  }
  if (identity) {
    service.setIdentity(identity);
    console.log(`[STAR-CITIZEN] android identity from env (${source})`);
  } else {
    console.log('[STAR-CITIZEN] android node up — unlock identity in the local UI to start the Fabric Peer');
  }
  return service;
}

if (require.main === module) {
  main().catch((exception) => {
    console.error('[STAR-CITIZEN]', '[ERROR]', 'Android node exception:', exception);
    process.exit(1);
  });
}

module.exports = { main, appRoot };
