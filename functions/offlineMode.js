'use strict';

/**
 * Desktop Offline Mode — one operator switch that stops networking and sharing.
 * Saved share preferences stay in the Store; they apply again when this is off.
 */

const PREF_KEY = 'gooncitizen.offlineMode';

const OFFLINE_ERROR = 'Offline Mode is on — networking and sharing are off';

/**
 * Dashboard tabs and hash aliases whose job is the mesh, Discord, Hub, or a share.
 * Home, Missions, Map, Fleets, and Library stay (local play).
 */
const HIDDEN_TABS = new Set([
  'chat',
  'groups',
  'network',
  'wallet',
  'documents',
  'notifications',
  'peers',
  'messages',
  'live',
  'feed',
  'devices'
]);

/**
 * @param {*} value
 * @returns {boolean}
 */
function isOfflineMode (value) {
  return value === true;
}

/**
 * @param {string} tab
 * @returns {boolean}
 */
function tabHidden (tab) {
  return HIDDEN_TABS.has(String(tab || ''));
}

/**
 * Browser hint so the first paint matches the last toggle before /settings returns.
 * The relay setting is the source of truth and overwrites this.
 * @returns {boolean}
 */
function readOfflinePref () {
  try {
    if (typeof localStorage === 'undefined' || !localStorage) return false;
    return localStorage.getItem(PREF_KEY) === '1';
  } catch (_) {
    return false;
  }
}

/**
 * @param {boolean} on
 */
function writeOfflinePref (on) {
  try {
    if (typeof localStorage === 'undefined' || !localStorage) return;
    if (on) localStorage.setItem(PREF_KEY, '1');
    else localStorage.removeItem(PREF_KEY);
  } catch (_) { /* private mode */ }
}

/**
 * @param {Function} [fetchImpl]
 * @returns {Promise<boolean>}
 */
async function readOfflineMode (fetchImpl) {
  const doFetch = fetchImpl || (typeof fetch === 'function' ? fetch : null);
  if (!doFetch) return false;
  try {
    const res = await doFetch('/settings');
    if (!res || !res.ok) return readOfflinePref();
    const j = await res.json();
    const on = !!(j && (
      (j.settings && j.settings.offlineMode === true) ||
      (j.runtime && j.runtime.offlineMode === true)
    ));
    writeOfflinePref(on);
    return on;
  } catch (_) {
    return readOfflinePref();
  }
}

module.exports = {
  PREF_KEY,
  OFFLINE_ERROR,
  HIDDEN_TABS,
  isOfflineMode,
  tabHidden,
  readOfflinePref,
  writeOfflinePref,
  readOfflineMode
};
