'use strict';

/**
 * Loud operator warning when dashboard HTTP is not loopback-behind-Caddy.
 * Caddy → 127.0.0.1 makes every client look local; without SC_MODE=server the
 * desktop unlocked-identity path would apply to the public origin.
 *
 * @param {Object} [opts]
 * @param {string} [opts.host] listen address from `_httpListenHost`
 * @param {string} [opts.mode] LiveRelay `settings.mode`
 * @param {boolean} [opts.httpSharedMode]
 * @returns {string|null} console.warn line, or null when the bind is loopback
 */
function httpBindWarning (opts = {}) {
  const host = String(opts.host || '').trim().toLowerCase();
  const mode = String(opts.mode || '').trim().toLowerCase();
  const loopback = host === '127.0.0.1' || host === '::1' || host === 'localhost';
  if (!host || loopback) return null;
  if (mode === 'server') {
    return `[STAR-CITIZEN] HTTP bound on ${host} with SC_MODE=server. Prefer loopback behind Caddy (docs/PRODUCTION.md). Do not trust X-Forwarded-For.`;
  }
  if (opts.httpSharedMode === true || host === '0.0.0.0' || host === '::') {
    return `[STAR-CITIZEN] HTTP bound on ${host} without SC_MODE=server — reverse-proxy clients look like loopback and inherit the unlocked operator. Use SC_MODE=server (docs/PRODUCTION.md).`;
  }
  return `[STAR-CITIZEN] HTTP bound on ${host} without SC_MODE=server. Prefer 127.0.0.1 (docs/PRODUCTION.md).`;
}

module.exports = { httpBindWarning };
