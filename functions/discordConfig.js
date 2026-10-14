'use strict';

/**
 * Resolve GoonCitizen Discord config from settings/local.js, env, Fabric Store
 * (non-secrets), and optional secrets file under the store root.
 *
 * Secrets (bot token, app secret, webhook) are never written to the Fabric Store.
 */

const fs = require('fs');
const path = require('path');

const {
  normalizeDiscordSettings,
  discordRuntimeSummary
} = require('@fabric/discord/functions/normalizeDiscordSettings');

const SECRETS_FILE = 'discord.secrets.json';

function secretsPath (settingsDir) {
  const root = String(settingsDir || '').trim();
  if (!root) return null;
  return path.join(root, SECRETS_FILE);
}

function readSecretsFile (settingsDir) {
  const p = secretsPath(settingsDir);
  if (!p || !fs.existsSync(p)) return {};
  try {
    const raw = JSON.parse(fs.readFileSync(p, 'utf8'));
    return raw && typeof raw === 'object' ? raw : {};
  } catch (_) {
    return {};
  }
}

/**
 * Persist Discord secrets beside the store root (gitignored under stores/).
 * Empty string clears a field. Omitting a key leaves it unchanged.
 *
 * @param {string} settingsDir
 * @param {object} patch
 * @returns {object} redacted summary
 */
function writeSecretsFile (settingsDir, patch = {}) {
  const p = secretsPath(settingsDir);
  if (!p) throw new Error('settingsDir required to store Discord secrets');
  const prev = readSecretsFile(settingsDir);
  const next = Object.assign({}, prev);
  for (const key of ['token', 'appSecret', 'webhook']) {
    if (!Object.prototype.hasOwnProperty.call(patch, key)) continue;
    const v = patch[key];
    if (v === null || v === undefined || String(v).trim() === '') {
      delete next[key];
    } else {
      next[key] = String(v).trim();
    }
  }
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(next, null, 2) + '\n', { mode: 0o600 });
  return {
    tokenConfigured: !!next.token,
    appSecretConfigured: !!next.appSecret,
    webhookConfigured: !!next.webhook
  };
}

/**
 * Merge local.js discord bag + env + Store + secrets file into normalized settings.
 *
 * @param {object} [opts]
 * @param {object} [opts.localDiscord] settings/local.js discord
 * @param {object} [opts.persisted] Fabric Store settings map
 * @param {string} [opts.settingsDir]
 * @param {NodeJS.ProcessEnv} [opts.env]
 * @returns {object} normalizeDiscordSettings result
 */
function resolveDiscordConfig (opts = {}) {
  const env = opts.env || process.env;
  const local = (opts.localDiscord && typeof opts.localDiscord === 'object')
    ? opts.localDiscord
    : {};
  const persisted = (opts.persisted && typeof opts.persisted === 'object')
    ? opts.persisted
    : {};
  const secrets = readSecretsFile(opts.settingsDir);

  const appId = String(
    env.DISCORD_APP_ID ||
    env.DISCORD_CLIENT_ID ||
    (local.app && local.app.id) ||
    local.appId ||
    persisted.discordAppId ||
    ''
  ).trim() || null;

  const token = String(
    env.DISCORD_BOT_TOKEN ||
    local.token ||
    secrets.token ||
    ''
  ).trim() || null;

  const appSecret = String(
    env.DISCORD_APP_SECRET ||
    env.DISCORD_CLIENT_SECRET ||
    (local.app && local.app.secret) ||
    local.appSecret ||
    secrets.appSecret ||
    ''
  ).trim() || null;

  const webhook = String(
    env.DISCORD_WEBHOOK_URL ||
    local.webhook ||
    secrets.webhook ||
    ''
  ).trim() || null;

  const channel = String(
    env.DISCORD_CHANNEL_ID ||
    local.channel ||
    persisted.discordChannel ||
    ''
  ).trim() || null;

  const enableFlag = persisted.discordBotEnable != null
    ? persisted.discordBotEnable === true
    : (local.enable === true || local.enable === undefined);

  const announce = (key, localDefault) => {
    const storeKey = `discord${key.charAt(0).toUpperCase()}${key.slice(1)}`;
    if (persisted[storeKey] != null) return persisted[storeKey] === true;
    if (local[key] != null) return local[key] === true;
    return !!localDefault;
  };

  const normalized = normalizeDiscordSettings({
    enable: enableFlag && !!(token || webhook),
    token,
    webhook,
    channel,
    app: { id: appId, secret: appSecret },
    announceKills: announce('announceKills', local.announceKills !== false),
    announcePlayerJoins: announce('announcePlayerJoins', local.announcePlayerJoins !== false),
    announceActivities: announce('announceActivities', !!local.announceActivities),
    announceMissions: announce('announceMissions', !!local.announceMissions),
    announceCombat: announce('announceCombat', !!local.announceCombat),
    announceIncaps: announce('announceIncaps', !!local.announceIncaps)
  });
  // @fabric/discord treats a token/webhook as enable=true; honor the Store flag.
  normalized.enable = enableFlag && !!(normalized.token || normalized.webhook);
  return normalized;
}

module.exports = {
  SECRETS_FILE,
  secretsPath,
  readSecretsFile,
  writeSecretsFile,
  resolveDiscordConfig,
  normalizeDiscordSettings,
  discordRuntimeSummary
};
