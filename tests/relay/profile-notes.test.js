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
  return fs.mkdtempSync(path.join(os.tmpdir(), 'sc-profile-notes-'));
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

describe('profile.notes pin to profile', () => {
  it('lists authored notes and serves pinned notes on the subject profile', async () => {
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
      const created = await request(port, 'POST', `${BASE}/notes`, {
        subject: alice.pubkey,
        handle: 'Alice',
        body: 'Reliable wingman'
      });
      assert.strictEqual(created.status, 200, JSON.stringify(created.body));
      const noteId = created.body.data.id;
      assert.strictEqual(created.body.data.profilePinned, false);

      const mine = await request(port, 'GET', `${BASE}/notes?mine=1`);
      assert.strictEqual(mine.status, 200);
      assert.ok(mine.body.data.some((n) => n.id === noteId));

      const selfOff = await request(port, 'GET', `${BASE}/profiles/${alice.pubkey}`);
      assert.strictEqual(selfOff.status, 200, JSON.stringify(selfOff.body));
      assert.ok(!selfOff.body.data.notes || !selfOff.body.data.notes.notes.length);

      const pin = await request(port, 'POST', `${BASE}/notes/${noteId}/pin`, { pinned: true });
      assert.strictEqual(pin.status, 200, JSON.stringify(pin.body));
      assert.strictEqual(pin.body.data.profilePinned, true);

      const wall = await request(port, 'GET', `${BASE}/profiles/${alice.pubkey}`);
      assert.ok(wall.body.data.notes.notes.some((n) => n.body === 'Reliable wingman'));

      const myProfile = await request(port, 'GET', `${BASE}/profiles/${bob.pubkey}`);
      assert.ok(myProfile.body.data.myNotes.some((n) => n.id === noteId));
      assert.strictEqual(myProfile.body.data.shareNotes, true);

      const group = await svc.groupManager.createGroup({
        name: 'Wing',
        members: [alice.pubkey, eve.pubkey],
        visibility: 'public'
      }, bob.pubkey);

      const spoof = groupDataSync.buildShare({
        groupId: group.id,
        packs: [{
          pack: groupDataSync.PACK_PROFILE_NOTES,
          payload: {
            pubkey: alice.pubkey,
            notes: [{
              id: 'note-stolen',
              subject: bob.pubkey,
              body: 'Spoofed warning',
              author: alice.pubkey,
              revision: 1
            }]
          }
        }]
      });
      const dropped = svc._ingestGroupDataShare(spoof, eve.pubkey, {
        contract: group.contractId
      });
      assert.ok(!dropped || !dropped.some((row) => row && row.pubkey === alice.pubkey));

      const share = groupDataSync.buildShare({
        groupId: group.id,
        packs: [{
          pack: groupDataSync.PACK_PROFILE_NOTES,
          payload: {
            pubkey: alice.pubkey,
            notes: [{
              id: 'note-alice',
              subject: bob.pubkey,
              body: 'Alice pinned this about Bob',
              author: alice.pubkey,
              revision: 1
            }]
          }
        }]
      });
      const folded = svc._ingestGroupDataShare(share, alice.pubkey, {
        contract: group.contractId
      });
      assert.ok(folded && folded.some((row) => row && row.pack === 'profile.notes'));

      const bobWall = await request(port, 'GET', `${BASE}/profiles/${bob.pubkey}`);
      assert.ok(bobWall.body.data.notes.notes.some((n) => n.body === 'Alice pinned this about Bob'));
    } finally {
      await svc.stop();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
