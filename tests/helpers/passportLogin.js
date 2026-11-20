'use strict';

/**
 * Sign a test identity in to a LiveRelay over loopback with Passport v2, the
 * same native flow the desktop and Android apps use (`signInToRelay`).
 */

const { signInToRelay } = require('../../functions/fabricLoginClient');

/**
 * @param {number} port LiveRelay HTTP port.
 * @param {object} identity From `createIdentity()`.
 * @param {{ origin?: string }} [opts] A public origin to sign in on; requests still go to
 *   the loopback port, as a reverse proxy would send them.
 * @returns {Promise<string>} Bearer token.
 */
async function passportLogin (port, identity, opts = {}) {
  const local = `http://127.0.0.1:${port}`;
  const origin = opts.origin || local;
  const fetchImpl = (url, init) => globalThis.fetch(String(url).startsWith(origin) ? local + String(url).slice(origin.length) : url, init);
  const out = await signInToRelay(identity, origin, { fetchImpl });
  if (!out.ok || !out.token) throw new Error('Passport sign-in failed: ' + (out.error || 'no token'));
  return out.token;
}

module.exports = { passportLogin };
