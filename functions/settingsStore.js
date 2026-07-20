'use strict';

// Persisted runtime settings — the desktop/relay counterpart of the Hub's
// settings under `stores/hub`. Plain JSON on disk at
// `stores/gooncitizen/settings.json` (CLI) or
// `<userData>/stores/gooncitizen/settings.json` (desktop).
// Only allowlisted keys are persisted, so the file stays a small, auditable
// operator config (never secrets like the identity key).

const fs = require('fs');
const path = require('path');

const FILENAME = 'settings.json';

// Operator-editable keys (mirrors the Hub's allowlisted-settings approach).
const ALLOWED_KEYS = [
  'logfile',    // explicit Game.log path (null = auto-detect)
  'channel',    // forced SC channel (LIVE/PTU/EPTU/HOTFIX/TECH-PREVIEW)
  'peers',      // [{ id, url, label, enabled }] — remote hubs receiving signed events
  'uplinkIntervalMs',
  'discordWebhook',
  'openAtLogin',
  'identityAutoLockMinutes' // 0 = off; default 30 (mirrors Hub identity lock prefs)
];

function settingsPath (dir) {
  return path.join(dir, FILENAME);
}

/**
 * Load persisted settings (unknown keys dropped).
 * @param {String} dir Directory containing settings.json.
 * @returns {Object} Settings object ({} when absent/corrupt).
 */
function loadSettings (dir) {
  try {
    const raw = JSON.parse(fs.readFileSync(settingsPath(dir), 'utf8'));
    const out = {};
    for (const key of ALLOWED_KEYS) {
      if (raw[key] !== undefined) out[key] = raw[key];
    }
    return out;
  } catch (_) {
    return {};
  }
}

/**
 * Persist one setting. Returns the full updated settings object.
 * @param {String} dir Directory for settings.json (created if missing).
 * @param {String} key Allowlisted setting name.
 * @param {*} value JSON-serializable value (undefined/null removes it).
 */
function putSetting (dir, key, value) {
  if (!ALLOWED_KEYS.includes(key)) throw new Error(`unknown setting: ${key}`);
  const current = loadSettings(dir);
  if (value === undefined || value === null) delete current[key];
  else current[key] = value;
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(settingsPath(dir), JSON.stringify(current, null, 2) + '\n');
  return current;
}

module.exports = {
  FILENAME,
  ALLOWED_KEYS,
  settingsPath,
  loadSettings,
  putSetting
};
