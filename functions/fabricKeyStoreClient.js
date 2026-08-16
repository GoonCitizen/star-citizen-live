'use strict';

/**
 * JS client for the local Capacitor plugin `FabricKeyStore`.
 * Missing plugin (desktop, tests without a mock) is a silent no-op.
 */

function fabricKeyStorePlugin () {
  try {
    return window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.FabricKeyStore;
  } catch (_) {
    return null;
  }
}

async function keyStoreStatus () {
  const plugin = fabricKeyStorePlugin();
  if (!plugin || typeof plugin.status !== 'function') return { available: false };
  try {
    const status = await plugin.status();
    return status && typeof status === 'object' ? status : { available: false };
  } catch (_) {
    return { available: false };
  }
}

async function readWrappedIdentityJson () {
  const plugin = fabricKeyStorePlugin();
  if (!plugin || typeof plugin.readIdentity !== 'function') return null;
  const result = await plugin.readIdentity();
  if (!result || result.json == null || result.json === '') return null;
  return String(result.json);
}

async function writeWrappedIdentityJson (json) {
  const plugin = fabricKeyStorePlugin();
  if (!plugin || typeof plugin.writeIdentity !== 'function') return { ok: false, skipped: true };
  const result = await plugin.writeIdentity({ json: String(json) });
  return { ok: !!(result && result.ok !== false), backend: result && result.backend };
}

async function clearWrappedIdentity () {
  const plugin = fabricKeyStorePlugin();
  if (!plugin || typeof plugin.clearIdentity !== 'function') return { ok: true, skipped: true };
  await plugin.clearIdentity();
  return { ok: true };
}

async function setSecureFlag (enabled) {
  const plugin = fabricKeyStorePlugin();
  if (!plugin || typeof plugin.setSecureFlag !== 'function') return { ok: false, skipped: true };
  try {
    await plugin.setSecureFlag({ enabled: !!enabled });
    return { ok: true, enabled: !!enabled };
  } catch (_) {
    return { ok: false };
  }
}

module.exports = {
  fabricKeyStorePlugin,
  keyStoreStatus,
  readWrappedIdentityJson,
  writeWrappedIdentityJson,
  clearWrappedIdentity,
  setSecureFlag
};
