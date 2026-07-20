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
 *   SC_MODE=server node scripts/node.js  hosted API (signed ingest, no log)
 */

const fs = require('fs');
const path = require('path');

const LiveRelay = require('../services/LiveRelay');
const { resolveLogFile } = require('../functions/locate');
const settingsStore = require('../functions/settingsStore');
const { storeRoot, registerPath } = require('../functions/storePaths');
const { Store } = require('../types/Store');

function csv (value) {
  return String(value || '').split(',').map((s) => s.trim()).filter(Boolean);
}

/** Hub-style store root: `stores/gooncitizen` (override with SC_SETTINGS_DIR). */
function resolveSettingsDir () {
  if (process.env.SC_SETTINGS_DIR) return storeRoot(process.env.SC_SETTINGS_DIR);
  return storeRoot(path.join(__dirname, '..', 'stores'));
}

/** Build LiveRelay settings for the hosted server mode (goon.vc-style). */
function serverSettings () {
  const settingsDir = resolveSettingsDir();
  return {
    port: process.env.PORT || 3041,
    mode: 'server',
    settingsDir,
    missions: {
      enable: true,
      dir: process.env.SC_REGISTER_DIR || registerPath(settingsDir),
      officers: csv(process.env.SC_OFFICERS)
    },
    ingest: { allowedKeys: csv(process.env.SC_ROSTER) }
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

  const webhook = process.env.DISCORD_WEBHOOK_URL || persisted.discordWebhook || null;
  return {
    port: process.env.PORT || 3041,
    logfile: resolved.file,
    channel: resolved.channel,
    // Pre-fill from history when the log actually exists (the default
    // location may not have been written yet).
    seed: process.env.SC_SEED || (resolved.file && fs.existsSync(resolved.file) ? resolved.file : null),
    settingsDir,
    store,
    missions: {
      enable: true,
      dir: registerDir,
      officers: csv(process.env.SC_OFFICERS)
    },
    discord: { enable: !!webhook, webhook },
    uplink: { enable: !!process.env.SC_UPLINK_URL, url: process.env.SC_UPLINK_URL || null },
    // Wallet: ledger mode by default (auditable obligations, no bitcoind);
    // supply settings.payouts.rpc for on-chain regtest/signet escrow.
    payouts: { enable: true, ledger: true, network: process.env.SC_BTC_NETWORK || 'regtest' }
  };
}

async function main () {
  const settings = process.env.SC_MODE === 'server' ? serverSettings() : await relaySettings();
  const service = new LiveRelay(settings);
  await service.start();
  return { name: 'star-citizen', mode: settings.mode || 'relay', port: settings.port };
}

main().catch((exception) => {
  console.error('[STAR-CITIZEN]', '[ERROR]', 'Main process exception:', exception);
  process.exit(1);
});
