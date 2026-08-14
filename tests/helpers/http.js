'use strict';

const http = require('http');

/**
 * JSON HTTP helper for LiveRelay integration tests.
 * @param {number} port
 * @param {string} method
 * @param {string} reqPath
 * @param {object} [payload]
 * @returns {Promise<{status: number, body: *}>}
 */
function request (port, method, reqPath, payload) {
  return new Promise((resolve, reject) => {
    const data = payload != null ? JSON.stringify(payload) : null;
    const req = http.request({
      host: '127.0.0.1',
      port,
      method,
      path: reqPath,
      headers: Object.assign(
        { Accept: 'application/json' },
        data
          ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) }
          : {}
      )
    }, (res) => {
      let buf = '';
      res.on('data', (c) => { buf += c; });
      res.on('end', () => {
        let body = null;
        if (buf) {
          try { body = JSON.parse(buf); } catch (_) { body = buf; }
        }
        resolve({ status: res.statusCode, body });
      });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

function wait (ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

module.exports = { request, wait };
