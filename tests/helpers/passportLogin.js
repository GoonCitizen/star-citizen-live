'use strict';

/**
 * Sign a test identity in to a LiveRelay over loopback with Passport v2, the
 * same native flow the desktop and Android apps use (`signInToRelay`).
 */

const { signInToRelay } = require('../../functions/fabricLoginClient');

/**
 * @param {number} port LiveRelay HTTP port.
 * @param {object} identity From `createIdentity()`.
 * @param {{ origin?: string }} [opts]
 * @returns {Promise<string>} Bearer token.
 */
async function passportLogin (port, identity, opts = {}) {
  const out = await signInToRelay(identity, opts.origin || `http://127.0.0.1:${port}`);
  if (!out.ok || !out.token) throw new Error('Passport sign-in failed: ' + (out.error || 'no token'));
  return out.token;
}

module.exports = { passportLogin };
