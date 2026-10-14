'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');

const LiveRelay = require('../../services/LiveRelay');
const { createIdentity, signEnvelope } = require('../../functions/identity');
const { request } = require('../helpers/http');

const BASE = '/services/star-citizen';

function spaGet (port, reqPath) {
  return new Promise((resolve, reject) => {
    http.get({ host: '127.0.0.1', port, path: reqPath }, (res) => {
      let buf = '';
      res.on('data', (c) => { buf += c; });
      res.on('end', () => resolve({
        status: res.statusCode,
        type: res.headers['content-type'],
        body: buf
      }));
    }).on('error', reject);
  });
}

async function login (port, identity) {
  const envelope = signEnvelope(identity, { intent: 'login', ts: new Date().toISOString() });
  const res = await request(port, 'POST', `${BASE}/auth`, envelope);
  assert.equal(res.status, 200, res.body && res.body.error);
  return res.body.data.token;
}

function authRequest (port, method, reqPath, payload, token) {
  return new Promise((resolve, reject) => {
    const data = payload != null ? JSON.stringify(payload) : null;
    const req = http.request({
      host: '127.0.0.1',
      port,
      method,
      path: reqPath,
      headers: Object.assign(
        { Accept: 'application/json' },
        token ? { Authorization: `Bearer ${token}` } : {},
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

describe('SPA shell routes and hosted group wallet', () => {
  it('serves HTML for /ui, /groups, /files, and /locations', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sc-spa-'));
    const svc = new LiveRelay({
      port: 0,
      listen: true,
      mode: 'relay',
      settingsDir: dir,
      fabric: { enable: false, listen: false, port: 0, peers: [] },
      missions: { enable: false },
      discord: { enable: false }
    });
    await svc.start();
    try {
      const port = svc.server.address().port;
      const paths = [
        `${BASE}/ui`,
        '/groups',
        '/groups/wing-1',
        '/files',
        '/files/deadbeef',
        '/locations',
        '/locations/orison'
      ];
      for (const p of paths) {
        const res = await spaGet(port, p);
        assert.equal(res.status, 200, p);
        assert.match(res.type || '', /text\/html/, p);
        assert.ok(res.body && res.body.length > 0, p);
      }
    } finally {
      await svc.stop();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('hosted GET /groups/:id/wallet is 403 for non-members', async () => {
    const alice = createIdentity();
    const eve = createIdentity();
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sc-wallet-403-'));
    const svc = new LiveRelay({
      port: 0,
      listen: true,
      mode: 'server',
      settingsDir: dir,
      fabric: { enable: false, listen: false, port: 0, peers: [] },
      missions: { enable: false },
      discord: { enable: false }
    });
    await svc.start();
    try {
      const port = svc.server.address().port;
      const aliceToken = await login(port, alice);
      const eveToken = await login(port, eve);
      const created = await authRequest(port, 'POST', `${BASE}/groups`, { name: 'Wing' }, aliceToken);
      assert.equal(created.status, 200, created.body && created.body.error);
      const groupId = created.body.data.id;

      const member = await authRequest(port, 'GET', `${BASE}/groups/${groupId}/wallet`, null, aliceToken);
      assert.equal(member.status, 200, member.body && member.body.error);
      assert.equal(member.body.type, 'GroupWallet');

      const outsider = await authRequest(port, 'GET', `${BASE}/groups/${groupId}/wallet`, null, eveToken);
      assert.equal(outsider.status, 403);
      assert.match(String(outsider.body && outsider.body.error), /members only/i);

      const missing = await authRequest(port, 'GET', `${BASE}/groups/no-such/wallet`, null, aliceToken);
      assert.equal(missing.status, 404);
    } finally {
      await svc.stop();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
