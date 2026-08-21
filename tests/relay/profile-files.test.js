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
const FILE_ID = 'ab'.repeat(32);

function tmpDir () {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'sc-profile-files-'));
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

describe('profile.files pin to profile', () => {
  it('lists only pinned files and serves a dedicated file page', async () => {
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
      svc.registerStore.put('documents', FILE_ID, {
        id: FILE_ID,
        sha256: FILE_ID,
        name: 'gooncitizen.dmg',
        mime: 'application/octet-stream',
        size: 4096,
        published: true,
        purchasePriceSats: 4,
        created: '2026-08-13T00:00:00.000Z'
      });

      const settings = await request(port, 'GET', '/settings');
      assert.strictEqual(settings.body.runtime.shareFiles, false);

      const selfOff = await request(port, 'GET', `${BASE}/profiles/${bob.pubkey}`);
      assert.strictEqual(selfOff.status, 200, JSON.stringify(selfOff.body));
      assert.strictEqual(selfOff.body.data.shareFiles, false);
      assert.deepStrictEqual(selfOff.body.data.files.files, []);

      const pageOff = await request(port, 'GET', `${BASE}/files/${FILE_ID}`);
      assert.strictEqual(pageOff.status, 200, JSON.stringify(pageOff.body));
      assert.strictEqual(pageOff.body.type, 'FileRecord');
      assert.strictEqual(pageOff.body.data.profilePinned, false);
      assert.strictEqual(pageOff.body.data.record.name, 'gooncitizen.dmg');

      const pin = await request(port, 'POST', `${BASE}/files/${FILE_ID}/pin`, { pinned: true });
      assert.strictEqual(pin.status, 200, JSON.stringify(pin.body));
      assert.strictEqual(pin.body.data.profilePinned, true);

      const selfOn = await request(port, 'GET', `${BASE}/profiles/${bob.pubkey}`);
      assert.strictEqual(selfOn.body.data.shareFiles, true);
      assert.ok(selfOn.body.data.files.files.some((f) => f.name === 'gooncitizen.dmg'));
      assert.ok(selfOn.body.data.files.files[0].href.includes('/files/'));
      assert.strictEqual(selfOn.body.data.files.files[0].publisher, bob.pubkey);

      const group = await svc.groupManager.createGroup({
        name: 'Wing',
        members: [alice.pubkey, eve.pubkey],
        visibility: 'public'
      }, bob.pubkey);

      const spoof = groupDataSync.buildShare({
        groupId: group.id,
        packs: [{
          pack: groupDataSync.PACK_PROFILE_FILES,
          payload: {
            pubkey: alice.pubkey,
            files: [{
              id: FILE_ID,
              name: 'stolen.dmg',
              size: 99,
              published: true,
              purchasePriceSats: 1
            }]
          }
        }]
      });
      const dropped = svc._ingestGroupDataShare(spoof, eve.pubkey, {
        contract: group.contractId
      });
      assert.ok(!dropped || !dropped.some((row) => row && row.pubkey === alice.pubkey));

      const before = await request(port, 'GET', `${BASE}/profiles/${alice.pubkey}`);
      assert.strictEqual(before.body.data.files, null);

      const share = groupDataSync.buildShare({
        groupId: group.id,
        packs: [{
          pack: groupDataSync.PACK_PROFILE_FILES,
          payload: {
            pubkey: alice.pubkey,
            files: [{
              id: FILE_ID,
              name: 'alice-build.apk',
              mime: 'application/vnd.android.package-archive',
              size: 2048,
              published: true,
              purchasePriceSats: 2
            }]
          }
        }]
      });
      const folded = svc._ingestGroupDataShare(share, alice.pubkey, {
        contract: group.contractId
      });
      assert.ok(folded && folded.some((row) => row && row.pack === 'profile.files'));

      const after = await request(port, 'GET', `${BASE}/profiles/${alice.pubkey}`);
      assert.ok(after.body.data.files.files.some((f) => f.name === 'alice-build.apk'));
      assert.strictEqual(after.body.data.files.files[0].publisher, alice.pubkey);
      assert.strictEqual(after.body.data.peering.string, '');

      const peerFile = await request(port, 'GET', `${BASE}/files/${FILE_ID}`);
      assert.strictEqual(peerFile.status, 200);
      assert.strictEqual(peerFile.body.data.local, true);

      const spa = await new Promise((resolve, reject) => {
        http.get({ host: '127.0.0.1', port, path: '/files/' + FILE_ID }, (res) => {
          resolve({ status: res.statusCode, type: res.headers['content-type'] });
          res.resume();
        }).on('error', reject);
      });
      assert.strictEqual(spa.status, 200);
      assert.match(String(spa.type || ''), /text\/html/);
    } finally {
      await svc.stop();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
