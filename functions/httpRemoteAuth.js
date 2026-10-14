'use strict';

const { isLoopbackRequest } = require('./isLoopbackRequest');

/**
 * Whether mutating dashboard HTTP must carry a Schnorr/Bearer session.
 *
 * Hosted `SC_MODE=server` always requires it. Opt-in LAN bind
 * (`httpSharedMode`) requires it for non-loopback peers so a neighbor
 * cannot speak as the unlocked desktop identity. Loopback (Electron /
 * local browser) keeps the existing unlocked-identity path.
 *
 * @param {object} [opts]
 * @param {string} [opts.mode] LiveRelay settings.mode
 * @param {boolean} [opts.httpSharedMode]
 * @param {http.IncomingMessage} [opts.req]
 * @returns {boolean}
 */
function shouldEnforceRemoteAuth (opts = {}) {
  const mode = String(opts.mode || '').trim().toLowerCase();
  if (mode === 'server') return true;
  if (opts.httpSharedMode === true && !isLoopbackRequest(opts.req)) return true;
  return false;
}

module.exports = { shouldEnforceRemoteAuth };
