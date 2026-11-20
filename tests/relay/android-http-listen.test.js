'use strict';

const test = require('node:test');
const assert = require('node:assert');
const http = require('http');
const os = require('os');
const path = require('path');
const fs = require('fs');

const LiveRelay = require('../../services/LiveRelay');
const { Store } = require('../../types/Store');

function request (port, method, urlPath) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, method, path: urlPath }, (res) => {
      let buf = '';
      res.on('data', (c) => { buf += c; });
      res.on('end', () => {
        let body = null;
        try { body = buf ? JSON.parse(buf) : null; } catch (_) { body = buf; }
        resolve({ status: res.statusCode, body });
      });
    });
    req.on('error', reject);
    req.end();
  });
}

test('android start serves HTTP before a slow register store finishes', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gc-android-listen-'));
  const inner = new Store({ path: path.join(dir, 'register'), json: true });
  let storeStarted = false;
  const store = new Proxy(inner, {
    get (target, prop) {
      if (prop === 'start') {
        return async () => {
          await new Promise((r) => setTimeout(r, 350));
          const out = await target.start();
          storeStarted = true;
          return out;
        };
      }
      return target[prop];
    }
  });

  const svc = new LiveRelay({
    mode: 'android',
    port: 0,
    httpHost: '127.0.0.1',
    store,
    fabric: { enable: false },
    discord: { enable: false },
    missions: { enable: false },
    logfile: null
  });

  const fromListen = new Promise((resolve, reject) => {
    svc.on('listening', () => {
      const startedAtListen = storeStarted;
      const addr = svc.server && svc.server.address();
      const port = addr && typeof addr === 'object' ? addr.port : 0;
      request(port, 'GET', '/services/star-citizen')
        .then((res) => resolve({ res, startedAtListen }))
        .catch(reject);
    });
  });

  await svc.start();
  try {
    const { res, startedAtListen } = await fromListen;
    assert.strictEqual(res.status, 200);
    assert.equal(startedAtListen, false, 'HTTP bound before store.start finished');
    assert.equal(storeStarted, true);
  } finally {
    await svc.stop();
  }
});

test('android CORS answers only the app WebView and this relay, not other localhost pages', () => {
  const svc = new LiveRelay({ mode: 'android', port: 3041, fabric: { enable: false }, discord: { enable: false }, missions: { enable: false }, logfile: null });
  const cors = (origin) => svc._localDashboardCorsHeaders({ headers: { origin } })['Access-Control-Allow-Origin'];
  assert.equal(cors('https://localhost'), 'https://localhost');
  assert.equal(cors('capacitor://localhost'), 'capacitor://localhost');
  assert.equal(cors('http://127.0.0.1:3041'), 'http://127.0.0.1:3041');
  assert.equal(cors('http://localhost:8080'), undefined, 'another app\'s local server');
  assert.equal(cors('https://localhost:4443'), undefined);
  assert.equal(cors('capacitor://evil.example'), undefined);
  assert.equal(cors(''), undefined);
  const desktop = new LiveRelay({ port: 3041, fabric: { enable: false }, discord: { enable: false }, missions: { enable: false }, logfile: null });
  assert.deepEqual(desktop._localDashboardCorsHeaders({ headers: { origin: 'https://localhost' } }), {});
});
