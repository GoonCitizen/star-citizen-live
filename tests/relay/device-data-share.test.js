'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const LiveRelay = require('../../services/LiveRelay');
const { createIdentity } = require('../../functions/identity');
const { createNote, getNote, listNotes } = require('../../functions/identityNotes');
const localGroups = require('../../functions/localGroups');
const deviceDataSync = require('../../functions/deviceDataSync');
const { groupContractDefinition } = require('../../contracts/gooncitizenGroup');

function tmpDir (prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

async function startRelay (dir) {
  const relay = new LiveRelay({
    port: 0,
    listen: true,
    mode: 'android',
    settingsDir: dir,
    logfile: path.join(dir, 'missing.log'),
    fabric: { enable: false, listen: false, port: 0, peers: [] },
    missions: { enable: false },
    discord: { enable: false }
  });
  await relay.start();
  return { relay, dir };
}

function linkCluster (relay, a, b) {
  const nonce = crypto.randomBytes(32).toString('hex');
  relay.identityCluster.ingestCrossSign({
    localPubkey: a.pubkey,
    peerPubkey: b.pubkey,
    nonce
  });
  relay.identityCluster.ingestCrossSign({
    localPubkey: b.pubkey,
    peerPubkey: a.pubkey,
    nonce
  });
  assert.equal(relay.identityCluster.clusterEquals(a.pubkey, b.pubkey), true);
}

describe('DeviceDataShare cluster-gated account replay', () => {
  let phone;
  let desktopIdent;
  let phoneIdent;
  let stranger;

  before(async () => {
    phone = await startRelay(tmpDir('gc-dds-phone-'));
    desktopIdent = createIdentity();
    phoneIdent = createIdentity();
    stranger = createIdentity();
    phone.relay.setIdentity(phoneIdent);
  });

  after(async () => {
    if (phone && phone.relay) {
      if (phone.relay._accountReplayTimer) {
        clearTimeout(phone.relay._accountReplayTimer);
        phone.relay._accountReplayTimer = null;
      }
      await phone.relay.stop();
    }
    if (phone && phone.dir) {
      try { fs.rmSync(phone.dir, { recursive: true, force: true }); } catch (_) { /* ignore */ }
    }
  });

  it('applies notes, local tags, profile, and group genesis from a cluster peer', () => {
    linkCluster(phone.relay, desktopIdent, phoneIdent);

    const { Store } = require('../../types/Store');
    const desktopStore = new Store();
    const note = createNote(desktopStore, {
      subject: 'discord:u-wing',
      body: 'Thursday hangar',
      author: desktopIdent.pubkey
    });
    const tag = localGroups.createGroup(desktopStore, {
      name: 'Hangar',
      createdBy: desktopIdent.pubkey
    });

    const definition = groupContractDefinition({
      groupId: 'group-starjump-sync',
      creator: desktopIdent.pubkey,
      validators: [desktopIdent.pubkey],
      threshold: 1,
      createdAt: '2026-08-14T00:00:00.000Z',
      meta: { name: 'Starjump', visibility: 'private' }
    });

    const share = deviceDataSync.buildShare({
      fromPubkey: desktopIdent.pubkey,
      packs: [
        {
          pack: deviceDataSync.PACK_PROFILE,
          payload: {
            pubkey: desktopIdent.pubkey,
            nickname: 'Neorion',
            bio: 'Pilot',
            mnemonic: 'should-not-travel'
          }
        },
        {
          pack: deviceDataSync.PACK_NOTES,
          payload: { notes: [note] }
        },
        {
          pack: deviceDataSync.PACK_LOCAL_TAGS,
          payload: { tags: [tag] }
        },
        {
          pack: deviceDataSync.PACK_GROUPS,
          payload: {
            groups: [{
              id: definition.groupId,
              name: 'Starjump',
              creator: desktopIdent.pubkey,
              members: [desktopIdent.pubkey],
              visibility: 'private',
              definition
            }]
          }
        }
      ]
    });
    assert.ok(share);
    assert.ok(!JSON.stringify(share).includes('should-not-travel'));

    const applied = phone.relay._ingestDeviceDataShare(share, desktopIdent.pubkey);
    assert.ok(applied);

    assert.equal(phone.relay._nickname, 'Neorion');
    assert.equal(getNote(phone.relay.registerStore, note.id).body, 'Thursday hangar');
    assert.equal(listNotes(phone.relay.registerStore).length >= 1, true);
    assert.ok(localGroups.getGroup(phone.relay.registerStore, tag.id));
    const group = phone.relay.groupManager.getGroup('group-starjump-sync');
    assert.ok(group);
    assert.equal(group.name, 'Starjump');
    assert.equal(phone.relay.groupManager.isMember('group-starjump-sync', phoneIdent.pubkey), true);
  });

  it('drops a share from a pubkey that is not in the cluster', () => {
    const share = deviceDataSync.buildShare({
      fromPubkey: stranger.pubkey,
      packs: [{
        pack: deviceDataSync.PACK_PROFILE,
        payload: { pubkey: stranger.pubkey, nickname: 'Intruder' }
      }]
    });
    const before = phone.relay._nickname;
    const applied = phone.relay._ingestDeviceDataShare(share, stranger.pubkey);
    assert.equal(applied, null);
    assert.equal(phone.relay._nickname, before);
  });

  it('does not publish over HTTPS when Fabric is down', () => {
    linkCluster(phone.relay, desktopIdent, phoneIdent);
    const out = phone.relay._replayAccountDataOverFabric();
    assert.equal(out, null);
    assert.ok(!phone.relay.fabricNetwork || !phone.relay.fabricNetwork.ready);
  });

  it('persists sibling LAN candidates from account.peers', () => {
    linkCluster(phone.relay, desktopIdent, phoneIdent);
    const share = deviceDataSync.buildShare({
      fromPubkey: desktopIdent.pubkey,
      packs: [{
        pack: deviceDataSync.PACK_PEERS,
        payload: {
          pubkey: desktopIdent.pubkey,
          candidates: ['192.168.9.9:7777']
        }
      }]
    });
    const applied = phone.relay._ingestDeviceDataShare(share, desktopIdent.pubkey);
    assert.ok(applied);
    const row = phone.relay.registerStore.get('clustersync', 'peer:' + desktopIdent.pubkey.toLowerCase());
    assert.ok(row);
    assert.ok(row.candidates.includes('192.168.9.9:7777'));
  });

  it('records last-share inventory on the sibling clustersync row', () => {
    linkCluster(phone.relay, desktopIdent, phoneIdent);
    const { Store } = require('../../types/Store');
    const desktopStore = new Store();
    const note = createNote(desktopStore, {
      subject: 'discord:inv',
      body: 'inventory chip',
      author: desktopIdent.pubkey
    });
    const share = deviceDataSync.buildShare({
      fromPubkey: desktopIdent.pubkey,
      packs: [
        {
          pack: deviceDataSync.PACK_STATS,
          payload: { notes: 1, logs: 6, missions: 40 }
        },
        {
          pack: deviceDataSync.PACK_NOTES,
          payload: { notes: [note] }
        }
      ]
    });
    const applied = phone.relay._ingestDeviceDataShare(share, desktopIdent.pubkey);
    assert.ok(applied);
    const row = phone.relay.registerStore.get('clustersync', 'peer:' + desktopIdent.pubkey.toLowerCase());
    assert.ok(row);
    assert.ok(row.inventory);
    assert.equal(row.inventory.notes, 1);
    assert.equal(row.inventory.logs, 6);
    assert.ok(row.inventory.applied.includes('notes'));
    const snap = phone.relay._clusterSyncSnapshot();
    assert.equal(snap.data.inventory.local.notes >= 1, true);
    const inbound = snap.data.inventory.inbound.find((r) => {
      return String(r.pubkey).toLowerCase() === desktopIdent.pubkey.toLowerCase();
    });
    assert.ok(inbound);
    assert.equal(inbound.logs, 6);
  });

  it('applies account.files placeholders without catalog bytes', () => {
    linkCluster(phone.relay, desktopIdent, phoneIdent);
    const fileId = crypto.createHash('sha256').update('cluster-file-body').digest('hex');
    const share = deviceDataSync.buildShare({
      fromPubkey: desktopIdent.pubkey,
      packs: [{
        pack: deviceDataSync.PACK_FILES,
        payload: {
          files: [{
            id: fileId,
            sha256: fileId,
            name: 'brief.bin',
            mime: 'application/octet-stream',
            size: 18,
            contentBase64: Buffer.from('cluster-file-body').toString('base64')
          }]
        }
      }]
    });
    assert.ok(!JSON.stringify(share).includes('cluster-file-body'));
    const applied = phone.relay._ingestDeviceDataShare(share, desktopIdent.pubkey);
    assert.ok(applied);
    const row = phone.relay.registerStore.get('documents', fileId);
    assert.ok(row);
    assert.equal(row.clusterSync, true);
    assert.equal(row.clusterPending, true);
    assert.ok(!row.contentBase64);
    assert.ok(phone.relay._expectsClusterFile(fileId));
  });

  it('replays a FabricMessageCollection of DeviceDataShare onto a cluster sibling', () => {
    const Key = require('@fabric/core/types/key');
    const clusterSync = require('../../functions/clusterSync');
    const key = new Key();
    desktopIdent = Object.assign({}, desktopIdent, { pubkey: key.pubkey });
    phoneIdent = createIdentity();
    phone.relay.setIdentity(phoneIdent);
    linkCluster(phone.relay, desktopIdent, phoneIdent);
    phone.relay._nickname = null;
    phone.relay._profile = null;

    const share = deviceDataSync.buildShare({
      fromPubkey: key.pubkey,
      packs: [{
        pack: deviceDataSync.PACK_PROFILE,
        payload: { pubkey: key.pubkey, nickname: 'CollectionPilot', bio: 'From hex' }
      }]
    });
    const collection = clusterSync.shareToCollection(share, { key });
    const applied = phone.relay._ingestClusterSyncCollection(collection, key.pubkey);
    assert.ok(applied);
    assert.equal(phone.relay._nickname, 'CollectionPilot');
  });

  it('applies desktop chat onto the phone Store', () => {
    linkCluster(phone.relay, desktopIdent, phoneIdent);
    const share = deviceDataSync.buildShare({
      fromPubkey: desktopIdent.pubkey,
      packs: [{
        pack: deviceDataSync.PACK_CHAT,
        payload: {
          messages: [{
            id: 'c'.repeat(32),
            channel: 'global',
            body: 'o7 from desktop',
            author: desktopIdent.pubkey,
            ts: '2026-08-15T20:00:00.000Z'
          }]
        }
      }]
    });
    const applied = phone.relay._ingestDeviceDataShare(share, desktopIdent.pubkey);
    assert.ok(applied);
    const listed = phone.relay.chatManager.list('global', { limit: 20 });
    assert.ok(listed.some((m) => m && m.body === 'o7 from desktop'));
    const packs = phone.relay._localDeviceDataPacks();
    const chat = packs.find((p) => p.pack === deviceDataSync.PACK_CHAT);
    assert.ok(chat);
    assert.ok(chat.payload.messages.some((m) => m.body === 'o7 from desktop'));
  });
});
