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

const path = require('path');

const LiveRelay = require('../services/LiveRelay');
const { resolveLogFile } = require('../functions/locate');
const settingsStore = require('../functions/settingsStore');

function csv (value) {
  return String(value || '').split(',').map((s) => s.trim()).filter(Boolean);
}

/** Build LiveRelay settings for the hosted server mode (goon.vc-style). */
function serverSettings () {
  return {
    port: process.env.PORT || 3041,
    mode: 'server',
    missions: { enable: true, dir: process.env.SC_REGISTER_DIR || null, officers: csv(process.env.SC_OFFICERS) },
    ingest: { allowedKeys: csv(process.env.SC_ROSTER) }
  };
}

/** Build LiveRelay settings for the local relay (env > persisted > auto). */
function relaySettings () {
  // Persisted operator settings (settings.json — editable via the dashboard).
  const settingsDir = process.env.SC_SETTINGS_DIR || path.join(__dirname, '..', 'stores');
  const persisted = settingsStore.loadSettings(settingsDir);

  // Auto-locate the active log across drives/channels (SC_LOGFILE or SC_CHANNEL override).
  const resolved = resolveLogFile({
    explicit: process.env.SC_LOGFILE || persisted.logfile || null,
    channel: process.env.SC_CHANNEL || persisted.channel || null
  });
  if (resolved.file) console.log(`[STAR-CITIZEN] log: ${resolved.channel || '?'} channel (${resolved.source}) -> ${resolved.file}`);
  else console.log('[STAR-CITIZEN] no Game.log found across drives/channels - set SC_LOGFILE or SC_CHANNEL');

  const webhook = process.env.DISCORD_WEBHOOK_URL || persisted.discordWebhook || null;
  return {
    port: process.env.PORT || 3041,
    logfile: resolved.file,
    channel: resolved.channel,
    seed: process.env.SC_SEED || resolved.file,   // pre-fill from history by default
    settingsDir,
    missions: { enable: true, dir: process.env.SC_REGISTER_DIR || null, officers: csv(process.env.SC_OFFICERS) },
    discord: { enable: !!webhook, webhook },
    uplink: { enable: !!process.env.SC_UPLINK_URL, url: process.env.SC_UPLINK_URL || null }
  };
}

async function main () {
  const settings = process.env.SC_MODE === 'server' ? serverSettings() : relaySettings();
  const service = new LiveRelay(settings);
  await service.start();
  return { name: 'star-citizen', mode: settings.mode || 'relay', port: settings.port };
}

main().catch((exception) => {
  console.error('[STAR-CITIZEN]', '[ERROR]', 'Main process exception:', exception);
  process.exit(1);
});
