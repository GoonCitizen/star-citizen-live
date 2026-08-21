#!/usr/bin/env node
'use strict';

/**
 * Main server entry — boots a LiveRelay instance from the environment and
 * persisted operator settings. The service definition itself lives in
 * services/LiveRelay.js; this script owns process-level concerns (env
 * parsing, log auto-detection, startup logging).
 *
 * Modes:
 *   node scripts/node.js                 local relay (log tailing + dashboard)
 *   SC_MODE=server node scripts/node.js  public relay (signed HTTP, no Game.log,
 *                                        Fabric Peer on unless SC_FABRIC=0)
 *   SC_MODE=android node scripts/node.js mobile local node (no Game.log; Fabric Peer on)
 *
 * Public-seed operators: docs/PRODUCTION.md (nvm 24.15 + pm2).
 */

const fs = require('fs');
const path = require('path');

const LiveRelay = require('../services/LiveRelay');
const { resolveLogFile } = require('../functions/locate');
const settingsStore = require('../functions/settingsStore');
const { storeRoot, registerPath } = require('../functions/storePaths');
const { Store } = require('../types/Store');
const { applyFabricEnvConfig, loadRepoDotEnv } = require('../functions/fabricEnvIdentity');
const { applyGoonCitizenEnvAliases } = require('../functions/goonCitizenEnvAliases');
const { fabricBootBlock, fabricPeerSeeds } = require('../functions/fabricRelayBoot');
const { buildAndroidRelaySettings } = require('../functions/androidRelaySettings');
let resolveFabricPeerInterface;
try {
  ({ resolveFabricPeerInterface } = require('@fabric/core/functions/fabricListenInterface'));
} catch (_) {
  resolveFabricPeerInterface = function resolveFabricPeerInterfaceFallback (opts = {}) {
    const env = opts.env || process.env;
    for (const key of ['FABRIC_INTERFACE', 'FABRIC_PEER_INTERFACE']) {
      const v = String(env[key] || '').trim();
      if (v) return v;
    }
    const explicit = String(opts.interface || opts.host || '').trim();
    if (explicit) return explicit;
    return '0.0.0.0';
  };
}

let localSettings = {};
try {
  localSettings = require('../settings/local');
} catch (_) {
  localSettings = {};
}

function csv (value) {
  return String(value || '').split(',').map((s) => s.trim()).filter(Boolean);
}

/** Hub-style store root: `stores/gooncitizen` (override with SC_SETTINGS_DIR). */
function resolveSettingsDir () {
  if (process.env.SC_SETTINGS_DIR) return storeRoot(process.env.SC_SETTINGS_DIR);
  return storeRoot(path.join(__dirname, '..', 'stores'));
}

/**
 * Build LiveRelay settings for a public GoonCitizen relay (`SC_MODE=server`).
 * Signed HTTP + no Game.log; Fabric Peer stays on unless `SC_FABRIC=0`.
 * HTTP binds loopback unless FABRIC_HUB_INTERFACE (or aliases) is set —
 * put Caddy in front. See docs/PRODUCTION.md.
 */
async function serverSettings () {
  const settingsDir = resolveSettingsDir();
  const registerDir = process.env.SC_REGISTER_DIR || registerPath(settingsDir);
  const store = new Store({ path: registerDir });
  await store.start();
  console.log(`[STAR-CITIZEN] fabric store: ${registerDir}`);
  const persisted = settingsStore.loadSettings(store);
  const discordConfig = require('../functions/discordConfig');
  const discord = discordConfig.resolveDiscordConfig({
    localDiscord: localSettings.discord || {},
    persisted,
    settingsDir,
    env: process.env
  });
  const httpHost = String(
    process.env.FABRIC_HUB_INTERFACE ||
    process.env.FABRIC_HTTP_INTERFACE ||
    process.env.INTERFACE ||
    ''
  ).trim() || '127.0.0.1';
  const fabricEnable = process.env.SC_FABRIC === '0' ? false : true;
  const fabric = fabricBootBlock({
    env: process.env,
    localSettings,
    listen: fabricEnable,
    resolveInterface: resolveFabricPeerInterface
  });
  const peerSeeds = fabricPeerSeeds({ localSettings });
  return {
    port: process.env.PORT || 3041,
    mode: 'server',
    httpHost,
    settingsDir,
    historyFile: path.join(settingsDir, 'history.json'),
    cursorsFile: path.join(settingsDir, 'log-cursors.json'),
    store,
    missions: {
      enable: true,
      dir: registerDir,
      officers: csv(process.env.SC_OFFICERS)
    },
    ingest: { allowedKeys: csv(process.env.SC_ROSTER) },
    discord,
    fabric,
    peers: peerSeeds,
    bitcoin: Object.assign({
      enable: false,
      hub: process.env.SC_BITCOIN_HUB || 'http://127.0.0.1:8080',
      network: process.env.SC_BTC_NETWORK || 'regtest'
    }, localSettings.bitcoin || {}),
    documents: Object.assign({
      enable: false
    }, localSettings.documents || {})
  };
}

/**
 * Build LiveRelay settings for the local relay (env > persisted > auto).
 * Opens the Fabric Store first — operator settings live there, not in a file.
 */
async function relaySettings () {
  const settingsDir = resolveSettingsDir();
  const registerDir = process.env.SC_REGISTER_DIR || registerPath(settingsDir);
  const store = new Store({ path: registerDir });
  await store.start();
  console.log(`[STAR-CITIZEN] fabric store: ${registerDir}`);
  const persisted = settingsStore.loadSettings(store);

  // Auto-locate the active log across drives/channels (SC_LOGFILE or SC_CHANNEL override).
  const resolved = resolveLogFile({
    explicit: process.env.SC_LOGFILE || persisted.logfile || null,
    channel: process.env.SC_CHANNEL || persisted.channel || null
  });
  if (resolved.source === 'default') {
    console.log(`[STAR-CITIZEN] no install detected — tailing the default location ${resolved.file} (starts the moment the game writes it)`);
  } else {
    console.log(`[STAR-CITIZEN] log: ${resolved.channel || '?'} channel (${resolved.source}) -> ${resolved.file}`);
  }

  const discordConfig = require('../functions/discordConfig');
  const discord = discordConfig.resolveDiscordConfig({
    localDiscord: localSettings.discord || {},
    persisted,
    settingsDir,
    env: process.env
  });
  return {
    port: process.env.PORT || 3041,
    logfile: resolved.file,
    channel: resolved.channel,
    // Pre-fill the Live tab when the log actually exists (the default
    // location may not have been written yet). Cumulative history is
    // synced separately into settingsDir/history.json on every start.
    seed: process.env.SC_SEED || (resolved.file && fs.existsSync(resolved.file) ? resolved.file : null),
    settingsDir,
    historyFile: path.join(settingsDir, 'history.json'),
    cursorsFile: path.join(settingsDir, 'log-cursors.json'),
    store,
    missions: {
      enable: true,
      dir: registerDir,
      officers: csv(process.env.SC_OFFICERS)
    },
    discord,
    uplink: { intervalMs: 5000 },
    fabric: fabricBootBlock({
      env: process.env,
      localSettings,
      listen: process.env.SC_FABRIC === '0' ? false : true,
      resolveInterface: resolveFabricPeerInterface
    }),
    peers: fabricPeerSeeds({ localSettings }),
    // Wallet: ledger mode by default (auditable obligations, no bitcoind);
    // supply settings.payouts.rpc for on-chain regtest/signet escrow.
    payouts: Object.assign(
      { enable: true, ledger: true, network: process.env.SC_BTC_NETWORK || 'regtest' },
      localSettings.payouts || {}
    ),
    bitcoin: Object.assign({
      enable: true,
      hub: process.env.SC_BITCOIN_HUB || 'http://127.0.0.1:8080',
      network: process.env.SC_BTC_NETWORK || 'regtest',
      adminToken: null,
      adminTokenFile: null
    }, localSettings.bitcoin || {}, {
      adminToken: process.env.FABRIC_HUB_ADMIN_TOKEN ||
        (localSettings.bitcoin && localSettings.bitcoin.adminToken) ||
        null,
      adminTokenFile: process.env.FABRIC_HUB_ADMIN_TOKEN_FILE ||
        (localSettings.bitcoin && localSettings.bitcoin.adminTokenFile) ||
        null,
      hub: process.env.SC_BITCOIN_HUB ||
        (localSettings.bitcoin && localSettings.bitcoin.hub) ||
        'http://127.0.0.1:8080'
    }),
    documents: Object.assign({
      enable: false
    }, localSettings.documents || {}),
    // Instance default group — Fabric message id / fabric:<hex> / group id.
    // Seeds Store primaryGroupId when unset (see LiveRelay._applyDefaultGroupFromLocal).
    defaultGroupMessageId: localSettings.defaultGroupMessageId ||
      (localSettings.groups && localSettings.groups.defaultGroupMessageId) ||
      process.env.SC_DEFAULT_GROUP_MESSAGE_ID ||
      null
  };
}

async function main () {
  loadRepoDotEnv();
  applyGoonCitizenEnvAliases(process.env);
  if (process.env.SC_UPLINK_URL) {
    console.warn('[STAR-CITIZEN] SC_UPLINK_URL is ignored (D-010 — use Fabric Peer seeds, not HTTPS uplink)');
  }
  const { identity, updated, source } = applyFabricEnvConfig(process.env);
  if (identity) {
    console.log(`[STAR-CITIZEN] publishing identity: ${identity.pubkey.slice(0, 16)}… (${source}${updated ? ', FABRIC_XPRV stamped' : ''})`);
  } else {
    console.log('[STAR-CITIZEN] no FABRIC_XPRV / FABRIC_SEED — Fabric Peer stays down until identity is unlocked');
  }
  const settings = process.env.SC_MODE === 'server'
    ? await serverSettings()
    : process.env.SC_MODE === 'android'
      ? await buildAndroidRelaySettings()
      : await relaySettings();
  const service = new LiveRelay(settings);
  await service.start();
  if (identity) service.setIdentity(identity);
  return { name: 'star-citizen', mode: settings.mode || 'relay', port: settings.port };
}

main().catch((exception) => {
  console.error('[STAR-CITIZEN]', '[ERROR]', 'Main process exception:', exception);
  process.exit(1);
});
