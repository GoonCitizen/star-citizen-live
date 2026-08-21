'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const LiveRelay = require('../../services/LiveRelay');
const groupDataSync = require('../../functions/groupDataSync');
const identityNotes = require('../../functions/identityNotes');
const { createIdentity } = require('../../functions/identity');

const FILE_ID = 'ab'.repeat(32);

async function startRelay () {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sc-gds-'));
  const svc = new LiveRelay({
    port: 0,
    listen: false,
    mode: 'relay',
    settingsDir: dir,
    fabric: { enable: false, listen: false, port: 0, peers: [] },
    missions: { enable: false },
    discord: { enable: false }
  });
  await svc.start();
  return { svc, dir };
}

function stubNetwork (svc) {
  const published = [];
  svc.fabricNetwork = {
    ready: true,
    setGroupContractKnown () {},
    publishGroupContract () {},
    publishGroupDataShare (contractId, payload) {
      published.push({ contractId, payload });
      return { ok: true };
    },
    async stop () {},
    setIdentity () {},
    setPeers () {}
  };
  return published;
}

describe('LiveRelay GroupDataShare publish', () => {
  it('publishes chat catalog, throttles, then bypasses with _publishGroupDataShareNow', async () => {
    const alice = createIdentity();
    const { svc, dir } = await startRelay();
    try {
      svc.setIdentity(alice);
      const published = stubNetwork(svc);
      const group = await svc.groupManager.createGroup({ name: 'Wing', visibility: 'public' }, alice.pubkey);
      assert.ok(group.contractId);
      svc._shareDiscordCatalog = true;
      const catalog = { guilds: [{ id: 'g1', name: 'Fleet Ops', memberCount: 3, channels: [], members: [] }] };
      svc._discordCatalogCache = { at: Date.now(), data: catalog, inflight: null };

      svc._maybePublishGroupDataShare(catalog);
      assert.equal(published.length, 1);
      assert.equal(published[0].contractId, group.contractId);
      const packs = published[0].payload.packs.map((p) => p.pack);
      assert.ok(packs.includes(groupDataSync.PACK_CHAT_CATALOG));

      svc._maybePublishGroupDataShare(catalog);
      assert.equal(published.length, 1, '5-minute throttle holds a second pass');

      svc._maybePublishDiscordCatalogShare(catalog);
      assert.equal(published.length, 1, 'alias uses the same throttle');

      svc._publishGroupDataShareNow();
      assert.equal(published.length, 2);
    } finally {
      await svc.stop();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('skips when fabric is down, identity is locked, or share flags are off', async () => {
    const alice = createIdentity();
    const bob = createIdentity();
    const { svc, dir } = await startRelay();
    try {
      svc.setIdentity(alice);
      const published = stubNetwork(svc);
      await svc.groupManager.createGroup({ name: 'Wing' }, alice.pubkey);
      const catalog = { guilds: [{ id: 'g1', name: 'Fleet Ops' }] };

      svc._maybePublishGroupDataShare(catalog);
      assert.equal(published.length, 0, 'no share flags and no pinned files/notes');

      svc._shareDiscordCatalog = true;
      svc.fabricNetwork.ready = false;
      svc._publishGroupDataShareNow();
      assert.equal(published.length, 0);

      svc.fabricNetwork.ready = true;
      svc._identity = null;
      svc._publishGroupDataShareNow();
      assert.equal(published.length, 0);

      svc._identity = bob;
      svc._shareDiscordCatalog = true;
      svc._publishGroupDataShareNow();
      assert.equal(published.length, 0, 'bob is not in alice\'s group tree');
    } finally {
      await svc.stop();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('publishes pinned files, notes, and playtimes packs', async () => {
    const alice = createIdentity();
    const { svc, dir } = await startRelay();
    try {
      svc.setIdentity(alice);
      const published = stubNetwork(svc);
      await svc.groupManager.createGroup({ name: 'Wing' }, alice.pubkey);

      svc.registerStore.put('documents', FILE_ID, {
        id: FILE_ID,
        sha256: FILE_ID,
        name: 'gooncitizen.dmg',
        mime: 'application/octet-stream',
        size: 4096,
        published: true,
        profilePinned: true,
        purchasePriceSats: 4,
        created: '2026-08-13T00:00:00.000Z'
      });
      const note = identityNotes.createNote(svc.registerStore, {
        subject: alice.pubkey,
        body: 'o7 from the hangar',
        author: alice.pubkey
      });
      identityNotes.setProfilePinned(svc.registerStore, note.id, true);

      svc._sharePlaytimes = true;
      svc._analyticsDataset = () => ({ heatcells: [{ d: 1, h: 12, n: 4 }] });

      svc._publishGroupDataShareNow();
      assert.equal(published.length, 1);
      const packs = published[0].payload.packs.map((p) => p.pack);
      assert.ok(packs.includes(groupDataSync.PACK_PROFILE_FILES));
      assert.ok(packs.includes(groupDataSync.PACK_PROFILE_NOTES));
      assert.ok(packs.includes(groupDataSync.PACK_PROFILE_PLAYTIMES));
    } finally {
      await svc.stop();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('emits a warning when publishGroupDataShare throws', async () => {
    const alice = createIdentity();
    const { svc, dir } = await startRelay();
    try {
      svc.setIdentity(alice);
      stubNetwork(svc);
      await svc.groupManager.createGroup({ name: 'Wing' }, alice.pubkey);
      svc.fabricNetwork.publishGroupDataShare = () => { throw new Error('peer offline'); };
      svc._shareDiscordCatalog = true;
      svc._discordCatalogCache = {
        at: 0,
        data: { guilds: [{ id: 'g1', name: 'Fleet Ops' }] },
        inflight: null
      };
      const warnings = [];
      svc.on('warning', (m) => warnings.push(String(m)));
      svc._publishGroupDataShareNow();
      assert.ok(warnings.some((m) => /GroupDataShare publish failed/.test(m)));
    } finally {
      await svc.stop();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
