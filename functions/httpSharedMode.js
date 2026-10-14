'use strict';

/**
 * HTTP shared-mode listen host helpers — canonical in `@fabric/http`.
 * Local fallback lets the Android embedded node boot when that package is not
 * staged into the APK.
 */

try {
  module.exports = require('@fabric/http/functions/httpSharedMode');
} catch (err) {
  if (err && err.code !== 'MODULE_NOT_FOUND') throw err;
  const DEFAULT_HTTP_LISTEN_ENV_KEYS = Object.freeze([
    'FABRIC_HUB_INTERFACE',
    'INTERFACE',
    'FABRIC_HTTP_INTERFACE'
  ]);

  function isHttpSharedModeEnabled (raw) {
    if (raw === undefined || raw === null) return false;
    if (raw === true || raw === 1) return true;
    if (typeof raw === 'string') {
      const s = raw.trim().toLowerCase();
      return s === 'true' || s === '1' || s === 'yes' || s === 'on';
    }
    return false;
  }

  function resolveHttpListenHost (opts = {}) {
    const env = opts.env || process.env;
    if (opts.envHost != null) {
      const forced = String(opts.envHost).trim();
      if (forced) return forced;
    }
    const explicit = String(opts.host || '').trim();
    if (explicit) return explicit;
    const keys = Array.isArray(opts.envHostKeys) && opts.envHostKeys.length
      ? opts.envHostKeys
      : DEFAULT_HTTP_LISTEN_ENV_KEYS;
    for (const key of keys) {
      const v = String(env[key] || '').trim();
      if (v) return v;
    }
    if (String(opts.mode || '') === 'server') return '0.0.0.0';
    if (isHttpSharedModeEnabled(opts.httpSharedMode)) return '0.0.0.0';
    return '127.0.0.1';
  }

  module.exports = {
    DEFAULT_HTTP_LISTEN_ENV_KEYS,
    isHttpSharedModeEnabled,
    resolveHttpListenHost
  };
}
