'use strict';

/**
 * Android identity blob persistence.
 *
 * Canonical store: Android Keystore wrap (`FabricKeyStore`) over the
 * password-sealed JSON blob, in app-private files. Capacitor Preferences
 * and WebView localStorage are read once for migration, then scrubbed.
 * If Keystore is missing, Preferences-only is the fallback — never localStorage.
 */

const IDENTITY_PREF = 'gooncitizen.android.identity';
const AUTOLOCK_PREF = 'gooncitizen.android.autolock';
const {
  readWrappedIdentityJson,
  writeWrappedIdentityJson,
  clearWrappedIdentity
} = require('./fabricKeyStoreClient');

function capacitorPreferences () {
  try {
    return window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.Preferences;
  } catch (_) {
    return null;
  }
}

function scrubIdentityLocalStorage () {
  try { localStorage.removeItem(IDENTITY_PREF); } catch (_) { /* WebView storage optional */ }
  try { localStorage.removeItem(AUTOLOCK_PREF); } catch (_) { /* same */ }
}

function parseBlob (raw) {
  if (raw == null || raw === '') return null;
  if (typeof raw === 'object') return raw;
  try { return JSON.parse(raw); } catch (_) { return null; }
}

async function readPreferencesIdentity () {
  const prefs = capacitorPreferences();
  if (!prefs || typeof prefs.get !== 'function') return null;
  try {
    const result = await prefs.get({ key: IDENTITY_PREF });
    return parseBlob(result && result.value);
  } catch (_) {
    return null;
  }
}

function readLocalStorageIdentity () {
  try {
    return parseBlob(localStorage.getItem(IDENTITY_PREF));
  } catch (_) {
    return null;
  }
}

async function writePreferencesIdentity (json) {
  const prefs = capacitorPreferences();
  if (!prefs || typeof prefs.set !== 'function') return false;
  try {
    await prefs.set({ key: IDENTITY_PREF, value: json });
    return true;
  } catch (_) {
    return false;
  }
}

async function removePreferencesIdentity () {
  const prefs = capacitorPreferences();
  if (!prefs || typeof prefs.remove !== 'function') return;
  try { await prefs.remove({ key: IDENTITY_PREF }); } catch (_) { /* ignore */ }
}

async function persistIdentityBlob (blob) {
  const json = JSON.stringify(blob);
  try {
    const wrapped = await writeWrappedIdentityJson(json);
    if (wrapped && wrapped.ok && !wrapped.skipped) {
      await removePreferencesIdentity();
      scrubIdentityLocalStorage();
      return { backend: wrapped.backend || 'keystore' };
    }
  } catch (_) {
    /* fall through to Preferences */
  }
  await writePreferencesIdentity(json);
  scrubIdentityLocalStorage();
  return { backend: 'preferences' };
}

async function readIdentityBlob () {
  try {
    const wrappedJson = await readWrappedIdentityJson();
    const wrapped = parseBlob(wrappedJson);
    if (wrapped) {
      scrubIdentityLocalStorage();
      return wrapped;
    }
  } catch (_) {
    /* unwrap failed — try leftover Preferences, not localStorage */
  }
  const fromPrefs = await readPreferencesIdentity();
  if (fromPrefs) {
    await persistIdentityBlob(fromPrefs);
    return fromPrefs;
  }
  const fromLocal = readLocalStorageIdentity();
  if (fromLocal) {
    await persistIdentityBlob(fromLocal);
    return fromLocal;
  }
  scrubIdentityLocalStorage();
  return null;
}

async function clearIdentityBlob () {
  try { await clearWrappedIdentity(); } catch (_) { /* still scrub copies */ }
  await removePreferencesIdentity();
  scrubIdentityLocalStorage();
}

async function readAutoLockMinutes (fallback) {
  const prefs = capacitorPreferences();
  if (prefs && typeof prefs.get === 'function') {
    try {
      const result = await prefs.get({ key: AUTOLOCK_PREF });
      if (result && result.value != null && result.value !== '') {
        return Math.max(0, Number(result.value) || 0);
      }
    } catch (_) { /* plugin not ready */ }
  }
  try {
    const raw = localStorage.getItem(AUTOLOCK_PREF);
    if (raw != null && raw !== '') {
      const minutes = Math.max(0, Number(raw) || 0);
      await writeAutoLockMinutes(minutes);
      return minutes;
    }
  } catch (_) { /* ignore */ }
  return fallback == null ? 15 : fallback;
}

async function writeAutoLockMinutes (minutes) {
  const value = String(Math.max(0, Number(minutes) || 0));
  const prefs = capacitorPreferences();
  if (prefs && typeof prefs.set === 'function') {
    try { await prefs.set({ key: AUTOLOCK_PREF, value }); } catch (_) { /* ignore */ }
  }
  try { localStorage.removeItem(AUTOLOCK_PREF); } catch (_) { /* ignore */ }
}

module.exports = {
  IDENTITY_PREF,
  AUTOLOCK_PREF,
  readIdentityBlob,
  persistIdentityBlob,
  clearIdentityBlob,
  readAutoLockMinutes,
  writeAutoLockMinutes,
  scrubIdentityLocalStorage
};
