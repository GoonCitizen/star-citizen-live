'use strict';

const test = require('node:test');
const assert = require('node:assert');
const http = require('http');
const net = require('net');
const fs = require('fs');
const os = require('os');
const path = require('path');

const LiveRelay = require('../../services/LiveRelay');
const settingsStore = require('../../functions/settingsStore');
const {
  isHttpSharedModeEnabled,
  resolveHttpListenHost
} = require('../../functions/httpSharedMode');
const { Store } = require('../../types/Store');

function request (port, method, reqPath, payload) {
  return new Promise((resolve, reject) => {
    const req = http.request({
      host: '127.0.0.1',
      port,
      method,
      path: reqPath,
      headers: { 'Content-Type': 'application/json' }
    }, (res) => {
      let buf = '';
      res.on('data', (c) => { buf += c; });
      res.on('end', () => resolve({ status: res.statusCode, body: buf ? JSON.parse(buf) : null }));
    });
    req.on('error', reject);
    if (payload) req.write(JSON.stringify(payload));
    req.end();
  });
}

function canConnect (host, port) {
  return new Promise((resolve) => {
    const socket = net.connect({ host, port }, () => {
      socket.end();
      resolve(true);
    });
    socket.on('error', () => resolve(false));
    socket.setTimeout(500, () => {
      socket.destroy();
      resolve(false);
    });
  });
}

test('httpSharedMode helpers: coerce and resolve listen host', () => {
  assert.strictEqual(isHttpSharedModeEnabled(true), true);
  assert.strictEqual(isHttpSharedModeEnabled('1'), true);
  assert.strictEqual(isHttpSharedModeEnabled(false), false);
  assert.strictEqual(isHttpSharedModeEnabled(undefined), false);

  assert.strictEqual(resolveHttpListenHost({ mode: 'relay', env: {} }), '127.0.0.1');
  assert.strictEqual(resolveHttpListenHost({ mode: 'relay', httpSharedMode: true, env: {} }), '0.0.0.0');
  assert.strictEqual(resolveHttpListenHost({ mode: 'server', env: {} }), '0.0.0.0');
  assert.strictEqual(resolveHttpListenHost({
    mode: 'relay',
    httpSharedMode: false,
    env: { FABRIC_HUB_INTERFACE: '192.168.1.10' }
  }), '192.168.1.10');
  assert.strictEqual(resolveHttpListenHost({
    mode: 'relay',
    env: { FABRIC_HUB_INTERFACE: '65.21.231.149' }
  }), '65.21.231.149');
  assert.strictEqual(resolveHttpListenHost({
    mode: 'server',
    host: '127.0.0.1',
    env: {}
  }), '127.0.0.1');
});

test('relay HTTP defaults to loopback; httpSharedMode setting is allowlisted', async () => {
  assert.ok(settingsStore.ALLOWED_KEYS.includes('httpSharedMode'));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sc-http-bind-'));
  const store = new Store({ path: path.join(dir, 'register') });
  await store.start();
  settingsStore.putSetting(store, 'httpSharedMode', true);
  assert.strictEqual(settingsStore.loadSettings(store).httpSharedMode, true);
  settingsStore.putSetting(store, 'httpSharedMode', 'yes');
  assert.strictEqual(settingsStore.loadSettings(store).httpSharedMode, false);
  settingsStore.putSetting(store, 'httpSharedMode', true);

  const svc = new LiveRelay({
    port: 0,
    store,
    settingsDir: dir,
    peers: [],
    fabric: { enable: false },
    discord: { enable: false }
  });
  await svc.start();
  assert.strictEqual(svc._httpListenHost(), '0.0.0.0');
  const port = svc.server.address().port;
  const runtime = (await request(port, 'GET', '/settings')).body.runtime;
  assert.strictEqual(runtime.httpSharedMode, true);
  assert.strictEqual(runtime.httpHost, '0.0.0.0');
  assert.ok(await canConnect('127.0.0.1', port));

  await request(port, 'PUT', '/settings/httpSharedMode', { value: false });
  // Rebind is deferred until the PUT response finishes.
  let host = null;
  for (let i = 0; i < 40; i++) {
    await new Promise((r) => setTimeout(r, 50));
    host = svc._httpListenHost();
    if (host === '127.0.0.1' && svc.server && svc.server.listening) break;
  }
  assert.strictEqual(host, '127.0.0.1');
  const after = (await request(port, 'GET', '/settings')).body.runtime;
  assert.strictEqual(after.httpSharedMode, false);
  assert.strictEqual(after.httpHost, '127.0.0.1');
  assert.ok(await canConnect('127.0.0.1', port));

  await svc.stop();
  await store.stop();
  fs.rmSync(dir, { recursive: true, force: true });
});

test('relay without shared mode binds 127.0.0.1', async () => {
  const svc = new LiveRelay({
    port: 0,
    peers: [],
    fabric: { enable: false },
    discord: { enable: false }
  });
  await svc.start();
  assert.strictEqual(svc._httpListenHost(), '127.0.0.1');
  const addr = svc.server.address();
  assert.ok(addr.address === '127.0.0.1' || addr.address === '::ffff:127.0.0.1' || addr.address === '::1');
  await svc.stop();
});
