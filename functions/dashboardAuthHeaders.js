'use strict';

/**
 * Authorization headers for Dashboard-owned fetches. Browsers sign in with a
 * Passport session cookie that rides along on its own; only a native client
 * holding a Bearer token passes one.
 */

/**
 * @param {object} [opts]
 * @param {string} [opts.token] Native-client Bearer token.
 * @param {object} [opts.headers] Merge base headers.
 * @returns {object}
 */
function dashboardAuthHeaders (opts = {}) {
  const headers = Object.assign({}, opts.headers || {});
  const token = opts.token != null ? String(opts.token).trim() : '';
  if (token) headers.Authorization = 'Bearer ' + token;
  return headers;
}

module.exports = {
  dashboardAuthHeaders
};
