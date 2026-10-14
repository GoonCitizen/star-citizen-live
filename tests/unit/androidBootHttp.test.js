'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const { listenAndroidBootHttp, isHealthGet } = require('../../functions/androidBootHttp');

function request (port, method, urlPath) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, method, path: urlPath }, (res) => {
      let buf = '';
      res.on('data', (c) => { buf += c; });
      res.on('end', () => {
        let body = null;
        try { body = buf ? JSON.parse(buf) : null; } catch (_) { body = buf; }
        resolve({ status: res.statusCode, headers: res.headers, body });
      });
    });
    req.on('error', reject);
    req.end();
  });
}

describe('androidBootHttp', () => {
  it('treats GET /services/star-citizen as the wait-screen probe', () => {
    assert.equal(isHealthGet({ method: 'GET', url: '/services/star-citizen' }), true);
    assert.equal(isHealthGet({ method: 'GET', url: '/services/star-citizen?x=1' }), true);
    assert.equal(isHealthGet({ method: 'GET', url: '/services/star-citizen/groups' }), false);
    assert.equal(isHealthGet({ method: 'POST', url: '/services/star-citizen' }), false);
  });

  it('answers the health probe before LiveRelay is attached and drains queued APIs', async () => {
    const boot = await listenAndroidBootHttp({ host: '127.0.0.1', port: 0 });
    try {
      const health = await request(boot.port, 'GET', '/services/star-citizen');
      assert.equal(health.status, 200);
      assert.equal(health.headers['x-gooncitizen-boot'], '1');
      assert.equal(health.body.status, 'STARTING');

      let handled = 0;
      const queued = request(boot.port, 'GET', '/services/star-citizen/groups');
      await new Promise((r) => setTimeout(r, 40));
      boot.attach({
        _handle (req, res) {
          handled += 1;
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true, path: req.url }));
        }
      });
      const groups = await queued;
      assert.equal(handled, 1);
      assert.equal(groups.status, 200);
      assert.equal(groups.body.ok, true);
    } finally {
      await boot.close();
    }
  });
});
