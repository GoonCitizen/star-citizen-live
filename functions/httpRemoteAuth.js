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

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1']);

/**
 * A write sent by some other web page through the user's browser. Loopback
 * writes act as the unlocked identity, so a page on another origin (or a DNS
 * rebinding name that now points at 127.0.0.1) must not reach them. The
 * dashboard's own origin is loopback on the port the request arrived on.
 *
 * @param {http.IncomingMessage} req
 * @param {object} [opts]
 * @param {number} [opts.port] Port the dashboard is served on
 * @param {function(string): boolean} [opts.allowOrigin] Extra trusted origins (Android WebView)
 * @returns {boolean}
 */
function isForeignBrowserWrite (req, opts = {}) {
  const method = String((req && req.method) || 'GET').toUpperCase();
  if (SAFE_METHODS.has(method)) return false;
  const headers = (req && req.headers) || {};
  const raw = headers.origin;
  if (raw == null || raw === '') {
    return String(headers['sec-fetch-site'] || '').toLowerCase() === 'cross-site';
  }
  const origin = String(raw).trim();
  if (typeof opts.allowOrigin === 'function' && opts.allowOrigin(origin)) return false;
  let url;
  try {
    url = new URL(origin);
  } catch (_) {
    return true;
  }
  if (url.protocol !== 'http:') return true;
  const host = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  const port = Number(url.port || 80);
  return !(LOOPBACK_HOSTS.has(host) && port === Number(opts.port));
}

module.exports = { shouldEnforceRemoteAuth, isForeignBrowserWrite };
