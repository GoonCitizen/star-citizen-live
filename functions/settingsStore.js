'use strict';

// Operator settings on the Fabric Store — the desktop/relay counterpart of the
// Hub's settings under `stores/hub`. Settings are records in the `settings`
// collection of the shared register Store (`types/Store.js` → `@fabric/core`
// LevelDB at `stores/gooncitizen/register`). The application never writes a
// settings JSON file; a legacy `settings.json` is imported once by the Store
// on start and then retired (renamed `.migrated`).
//
// Only allowlisted keys are persisted, so the collection stays a small,
// auditable operator config (never secrets like the identity key).

// Operator-editable keys (mirrors the Hub's allowlisted-settings approach).
const ALLOWED_KEYS = [
  'logfile',    // explicit Game.log path (null = auto-detect)
  'channel',    // forced SC channel (LIVE/PTU/EPTU/HOTFIX/TECH-PREVIEW)
  'peers',      // [{ id, url, label, enabled }] — remote hubs receiving signed events
  'uplinkIntervalMs',
  'discordWebhook',
  'openAtLogin',
  'identityAutoLockMinutes', // 0 = off; default 30 (mirrors Hub identity lock prefs)
  'shareLogsGlobal',         // push parsed log events to peer hubs for org aggregation (default true)
  'snapshotsEnabled',        // periodic screen snapshots (opt-in; desktop only)
  'snapshotIntervalSeconds', // capture cadence (default 10, min 2)
  'snapshotAutoPurge',       // delete oldest snapshots beyond the disk cap (default true)
  'snapshotMaxMB',           // disk cap for the snapshot library (default 256 MB)
  'notifyDesktop',           // master toggle for desktop/OS notifications (default true)
  'notifyChatGlobal',        // notify on new global chat messages (default true)
  'notifyChatGroups',        // notify on new group chat messages (default true)
  'notifyWhenFocused',       // also notify while the app window is focused (default false)
  'nickname',                // operator display name for chat (pubkey remains the actor id)
  'notifyMissionBroadcasts'  // desktop notify when a peer broadcasts a mission (default true)
];

const NICKNAME_MAX = 32;

/**
 * Normalize a display nickname. Empty clears it. Strips control chars;
 * does not replace the cryptographic identity (pubkey stays authoritative).
 * @param {*} value
 * @returns {string|null}
 */
function sanitizeNickname (value) {
  if (value === undefined || value === null || value === '') return null;
  const s = String(value)
    .replace(/[\u0000-\u001f\u007f]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ')
    .slice(0, NICKNAME_MAX);
  return s || null;
}

/**
 * Load persisted settings from the Fabric Store (unknown keys dropped).
 * Synchronous after `store.start()` — the Store keeps collections in memory.
 * @param {import('../types/Store').Store} store Shared register Store.
 * @returns {Object} Settings object ({} when store absent or empty).
 */
function loadSettings (store) {
  const out = {};
  if (!store) return out;
  for (const key of ALLOWED_KEYS) {
    const record = store.get('settings', key);
    if (record && record.value !== undefined && record.value !== null) out[key] = record.value;
  }
  return out;
}

/**
 * Persist one setting into the Fabric Store. Returns the full updated
 * settings object. `null`/`undefined` clears the setting.
 * @param {import('../types/Store').Store} store Shared register Store.
 * @param {String} key Allowlisted setting name.
 * @param {*} value JSON-serializable value (undefined/null removes it).
 */
function putSetting (store, key, value) {
  if (!ALLOWED_KEYS.includes(key)) throw new Error(`unknown setting: ${key}`);
  if (!store) throw new Error('settings store required');
  let next = value === undefined ? null : value;
  if (key === 'nickname') next = sanitizeNickname(next);
  store.put('settings', key, { id: key, value: next });
  return loadSettings(store);
}

module.exports = {
  ALLOWED_KEYS,
  NICKNAME_MAX,
  sanitizeNickname,
  loadSettings,
  putSetting
};
