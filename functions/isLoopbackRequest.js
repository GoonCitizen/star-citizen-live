'use strict';

/**
 * True when the HTTP peer is this machine (loopback). Used to gate the
 * Android identity session onto the local node only.
 *
 * @param {http.IncomingMessage} req
 * @returns {boolean}
 */
function isLoopbackRequest (req) {
  const sock = (req && req.socket) || {};
  const conn = (req && req.connection) || {};
  const raw = String(sock.remoteAddress || conn.remoteAddress || '');
  const addr = raw.replace(/^::ffff:/i, '').toLowerCase();
  return addr === '127.0.0.1' || addr === '::1' || addr === 'localhost';
}

module.exports = { isLoopbackRequest };
