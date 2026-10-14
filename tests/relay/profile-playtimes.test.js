'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');

const LiveRelay = require('../../services/LiveRelay');
const groupDataSync = require('../../functions/groupDataSync');
const { createIdentity } = require('../../functions/identity');

const BASE = '/services/star-citizen';

function tmpDir () {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'sc-playtimes-'));
}

function request (port, method, reqPath, payload) {
  return new Promise((resolve, reject) => {
    const req = http.request({
      host: '127.0.0.1',
      port,
      method,
      path: reqPath,
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' }
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
    if (payload) req.write(JSON.stringify(payload));
    req.end();
  });
}

describe('profile.playtimes GroupDataShare pack', () => {
  it('stays off by default and only shows a peer heatmap after they share their own pack', async () => {
    const alice = createIdentity();
    const bob = createIdentity();
    const eve = createIdentity();
    const dir = tmpDir();
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
    svc.setIdentity(bob);
    const port = svc.server.address().port;
    try {
      const settings = await request(port, 'GET', '/settings');
      assert.strictEqual(settings.body.runtime.sharePlaytimes, false);

      const selfOff = await request(port, 'GET', `${BASE}/profiles/${bob.pubkey}`);
      assert.strictEqual(selfOff.status, 200, JSON.stringify(selfOff.body));
      assert.strictEqual(selfOff.body.data.self, true);
      assert.strictEqual(selfOff.body.data.sharePlaytimes, false);
      assert.strictEqual(selfOff.body.data.playtimes, null);

      const group = await svc.groupManager.createGroup({
        name: 'Wing',
        members: [alice.pubkey, eve.pubkey],
        visibility: 'public'
      }, bob.pubkey);

      const spoof = groupDataSync.buildShare({
        groupId: group.id,
        packs: [{
          pack: groupDataSync.PACK_PROFILE_PLAYTIMES,
          payload: {
            pubkey: alice.pubkey,
            cells: [{ d: 0, h: 20, n: 9 }]
          }
        }]
      });
      const dropped = svc._ingestGroupDataShare(spoof, eve.pubkey, {
        contract: group.contractId
      });
      assert.ok(!dropped || !dropped.some((row) => row && row.pubkey === alice.pubkey));

      const before = await request(port, 'GET', `${BASE}/profiles/${alice.pubkey}`);
      assert.strictEqual(before.status, 200, JSON.stringify(before.body));
      assert.strictEqual(before.body.data.self, false);
      assert.strictEqual(before.body.data.playtimes, null);

      const share = groupDataSync.buildShare({
        groupId: group.id,
        packs: [{
          pack: groupDataSync.PACK_PROFILE_PLAYTIMES,
          payload: {
            pubkey: alice.pubkey,
            cells: [{ d: 1, h: 18, n: 4 }, { d: 5, h: 21, n: 2 }]
          }
        }]
      });
      const folded = svc._ingestGroupDataShare(share, alice.pubkey, {
        contract: group.contractId
      });
      assert.ok(folded && folded.some((row) => row && row.pack === 'profile.playtimes'));

      const after = await request(port, 'GET', `${BASE}/profiles/${alice.pubkey}`);
      assert.strictEqual(after.status, 200, JSON.stringify(after.body));
      assert.ok(after.body.data.playtimes);
      assert.strictEqual(after.body.data.playtimes.shared, true);
      assert.ok(after.body.data.playtimes.cells.some((c) => c.d === 1 && c.h === 18 && c.n === 4));
      assert.ok(!after.body.data.sharePlaytimes);

      svc.history.heat['2026-08|0|20'] = 5;
      const put = await request(port, 'PUT', '/settings/sharePlaytimes', { value: true });
      assert.strictEqual(put.status, 200);
      assert.strictEqual(put.body.runtime.sharePlaytimes, true);
      const selfOn = await request(port, 'GET', `${BASE}/profiles/${bob.pubkey}`);
      assert.strictEqual(selfOn.body.data.sharePlaytimes, true);
      assert.ok(selfOn.body.data.playtimes);
      assert.ok(selfOn.body.data.playtimes.cells.some((c) => c.d === 0 && c.h === 20 && c.n === 5));
    } finally {
      await svc.stop();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
