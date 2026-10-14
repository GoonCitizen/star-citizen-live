'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const LiveRelay = require('../../services/LiveRelay');
const { createIdentity } = require('../../functions/identity');
const { request } = require('../helpers/http');
const { categoryForKind, buildLiveFeed } = require('../../functions/liveFeed');
const FabricNetwork = require('../../services/FabricNetwork');

const BASE = '/services/star-citizen';

async function startRelay () {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sc-local-groups-'));
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
  return { svc, dir, port: svc.server.address().port };
}

describe('local groups and identity notes HTTP', () => {
  it('creates a tag, adds a Discord member, notes them, and lists the feed', async () => {
    const { svc, dir, port } = await startRelay();
    const alice = createIdentity();
    try {
      svc.setIdentity(alice);

      const created = await request(port, 'POST', `${BASE}/local-groups`, { name: 'Hangar' });
      assert.strictEqual(created.status, 200);
      const groupId = created.body.data.id;

      const added = await request(port, 'POST', `${BASE}/local-groups/${groupId}/members`, {
        actor: 'discord:u1',
        handle: 'alice'
      });
      assert.strictEqual(added.status, 200);
      assert.ok(added.body.data.members.some((m) => m.actor === 'discord:u1'));

      const listed = await request(port, 'GET', `${BASE}/local-groups`);
      assert.strictEqual(listed.status, 200);
      assert.strictEqual(listed.body.data.length, 1);

      const note = await request(port, 'POST', `${BASE}/notes`, {
        subject: 'discord:u1',
        handle: 'alice',
        body: 'Nights-only gunner'
      });
      assert.strictEqual(note.status, 200);
      assert.strictEqual(note.body.data.visibility, 'private');

      const notes = await request(port, 'GET', `${BASE}/notes?subject=${encodeURIComponent('discord:u1')}`);
      assert.strictEqual(notes.status, 200);
      assert.strictEqual(notes.body.data.length, 1);

      const bob = createIdentity();
      const shared = await request(port, 'POST', `${BASE}/notes/${note.body.data.id}/share`, {
        scope: 'peer',
        peerPubkey: bob.pubkey
      });
      assert.strictEqual(shared.status, 200);
      assert.strictEqual(shared.body.data.note.visibility, 'peer');
      assert.ok(shared.body.data.payload);
      assert.strictEqual(
        shared.body.data.payload.peerB,
        shared.body.data.note.sharePeerPubkey
      );

      const removed = await request(
        port,
        'DELETE',
        `${BASE}/local-groups/${groupId}/members/${encodeURIComponent('discord:u1')}`
      );
      assert.strictEqual(removed.status, 200);
      assert.strictEqual(removed.body.data.members.length, 0);

      const feed = await request(port, 'GET', `${BASE}/feed`);
      assert.strictEqual(feed.status, 200);
      const kinds = (feed.body.items || []).map((i) => i.kind);
      assert.ok(kinds.includes('LocalGroupCreate') || kinds.includes('LocalGroupMemberAdd'));
      assert.ok(kinds.includes('IdentityNote') || kinds.includes('NoteShare'));
      assert.ok((feed.body.categories || []).some((pair) => pair[0] === 'note'));
    } finally {
      await svc.stop();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('note feed mapping', () => {
  it('maps note and local-tag kinds onto the Notes category', () => {
    assert.strictEqual(categoryForKind('NoteShare'), 'note');
    assert.strictEqual(categoryForKind('NoteUpdate'), 'note');
    assert.strictEqual(categoryForKind('IdentityNote'), 'note');
    assert.strictEqual(categoryForKind('LocalGroupMemberAdd'), 'note');
    assert.strictEqual(FabricNetwork.isKnownAppRelayType('NoteShare'), true);
    assert.strictEqual(FabricNetwork.isKnownAppRelayType('NoteUpdate'), true);
  });

  it('includes inbox note and tag events plus Discord chat in the live feed', () => {
    const feed = buildLiveFeed({
      chat: [{
        id: 'd1',
        channel: 'discord:c1',
        author: 'discord:u1',
        handle: 'alice',
        body: 'o7 from Discord',
        ts: '2026-08-13T12:00:02.000Z'
      }],
      inbox: [{
        id: 'n1',
        kind: 'NoteShare',
        ts: '2026-08-13T12:00:03.000Z',
        title: 'Shared note',
        body: 'Nights-only gunner',
        handle: 'alice',
        source: '03aa',
        refs: { scope: 'peer', noteId: 'note-1', subject: 'discord:u1' }
      }, {
        id: 'g1',
        kind: 'LocalGroupMemberAdd',
        ts: '2026-08-13T12:00:01.000Z',
        title: 'Added to Hangar',
        body: 'alice',
        handle: 'alice',
        refs: { localGroupId: 'lg-1', actor: 'discord:u1' }
      }, {
        id: 'skip',
        kind: 'MissionBroadcast',
        ts: '2026-08-13T12:00:04.000Z',
        title: 'skip me'
      }]
    }, { limit: 50 });
    assert.ok(feed.items.some((i) => i.kind === 'ChatMessage' && i.id === 'chat:d1'));
    const note = feed.items.find((i) => i.kind === 'NoteShare');
    assert.ok(note);
    assert.strictEqual(note.category, 'note');
    const tag = feed.items.find((i) => i.kind === 'LocalGroupMemberAdd');
    assert.ok(tag);
    assert.strictEqual(tag.category, 'note');
    assert.strictEqual(tag.source, 'local');
    assert.ok(!feed.items.some((i) => i.kind === 'MissionBroadcast' && i.id === 'inbox:skip'));
  });
});
