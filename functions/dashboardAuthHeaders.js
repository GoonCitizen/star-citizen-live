'use strict';

/**
 * Authorization headers for Dashboard-owned fetches (hosted SiteLogin Bearer).
 */

const {
  readStoredSiteLoginToken
} = require('./goonCitizenClientEnvironment');

/**
 * @param {object} [opts]
 * @param {string} [opts.token] Explicit Bearer (wins over storage).
 * @param {Storage} [opts.storage]
 * @param {object} [opts.headers] Merge base headers.
 * @returns {object}
 */
function dashboardAuthHeaders (opts = {}) {
  const headers = Object.assign({}, opts.headers || {});
  const token = (opts.token != null && String(opts.token).trim())
    ? String(opts.token).trim()
    : readStoredSiteLoginToken(opts.storage);
  if (token) {
    headers.Authorization = 'Bearer ' + token;
  }
  return headers;
}

module.exports = {
  dashboardAuthHeaders,
  readStoredSiteLoginToken
};
