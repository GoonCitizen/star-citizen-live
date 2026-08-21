'use strict';

/**
 * Bind loopback HTTP before LiveRelay is required.
 *
 * Capacitor's wait screen (`functions/androidLocalNode.js`) unblocks on any
 * GET `/services/star-citizen` with status < 500. Requiring LiveRelay (and
 * `@fabric/*`) is the slow part of Android boot — this listener answers that
 * probe immediately and queues other requests until `attach(service)`.
 */

const http = require('http');

function requestPathname (req) {
  try {
    return new URL(req.url || '/', 'http://127.0.0.1').pathname;
  } catch (_) {
    return '';
  }
}

function isHealthGet (req) {
  if (!req || (req.method !== 'GET' && req.method !== 'HEAD')) return false;
  const pathname = requestPathname(req);
  return pathname === '/services/star-citizen' || pathname === '/services/star-citizen/';
}

function sendStarting (req, res) {
  const body = JSON.stringify({
    type: 'StarCitizen',
    status: 'STARTING',
    data: { status: 'STARTING', android: true, boot: 'http' }
  });
  res.writeHead(200, {
    'Content-Type': 'application/json',
    'X-GoonCitizen-Boot': '1'
  });
  if (req.method === 'HEAD') return res.end();
  res.end(body);
}

/**
 * @param {Object} [opts]
 * @param {string} [opts.host]
 * @param {number} [opts.port]
 * @returns {Promise<{ server: import('http').Server, attach: Function, close: Function, host: string, port: number }>}
 */
function listenAndroidBootHttp (opts = {}) {
  const host = opts.host || '127.0.0.1';
  const port = Number(opts.port) > 0 ? Number(opts.port) : 3041;
  const queue = [];
  let service = null;
  let attached = false;

  function onRequest (req, res) {
    if (attached && service && typeof service._handle === 'function') {
      return service._handle(req, res);
    }
    if (isHealthGet(req)) return sendStarting(req, res);
    queue.push({ req, res });
  }

  const server = http.createServer(onRequest);

  function attach (svc) {
    service = svc || null;
    attached = true;
    if (service) {
      service.server = server;
      if (service.settings) service.settings.listen = false;
    }
    const pending = queue.splice(0);
    for (const item of pending) {
      try {
        if (service && typeof service._handle === 'function') {
          service._handle(item.req, item.res);
        } else {
          item.res.writeHead(503, { 'Content-Type': 'application/json' });
          item.res.end(JSON.stringify({ error: 'local node failed to start' }));
        }
      } catch (e) {
        try {
          if (!item.res.headersSent) {
            item.res.writeHead(500, { 'Content-Type': 'application/json' });
          }
          item.res.end(JSON.stringify({ error: String((e && e.message) || e) }));
        } catch (_) { /* already sent */ }
      }
    }
    return server;
  }

  function close () {
    return new Promise((resolve) => {
      server.close(() => resolve());
    });
  }

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => {
      server.removeListener('error', reject);
      const addr = server.address();
      const bound = (addr && typeof addr === 'object' && addr.port) ? addr.port : port;
      resolve({ server, attach, close, host, port: bound });
    });
  });
}

module.exports = {
  listenAndroidBootHttp,
  isHealthGet
};
