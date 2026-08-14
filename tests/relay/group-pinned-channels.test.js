'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const LiveRelay = require('../../services/LiveRelay');
const {
  normalizePinnedChannelKey,
  sanitizePinnedChannels,
  pinnedChannelsFromGroups,
  MAX_PINNED_CHANNELS
} = require('../../functions/groupPinnedChannels');
const { createIdentity } = require('../../functions/identity');

function tmpDir () {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'sc-pins-'));
}

test('normalizePinnedChannelKey accepts discord and group keys', () => {
  assert.strictEqual(normalizePinnedChannelKey('discord:123456789012345678'), 'discord:123456789012345678');
  assert.strictEqual(normalizePinnedChannelKey('123456789012345678'), 'discord:123456789012345678');
  assert.strictEqual(normalizePinnedChannelKey('group:abcdef0123456789'), 'group:abcdef0123456789');
  assert.strictEqual(normalizePinnedChannelKey('global'), null);
  assert.strictEqual(normalizePinnedChannelKey('dm:abc'), null);
  assert.strictEqual(normalizePinnedChannelKey(''), null);
});

test('sanitizePinnedChannels dedupes, caps, and drops junk', () => {
  const many = Array.from({ length: 30 }, (_, i) =>
    'discord:9' + String(i).padStart(17, '0'));
  const pins = sanitizePinnedChannels([
    'discord:111111111111111111',
    '111111111111111111',
    'group:abcdefghijklmnop',
    'nope',
    { key: 'discord:222222222222222222' },
    ...many
  ]);
  assert.ok(pins.includes('discord:111111111111111111'));
  assert.ok(pins.includes('group:abcdefghijklmnop'));
  assert.ok(pins.includes('discord:222222222222222222'));
  assert.ok(!pins.includes('nope'));
  assert.strictEqual(pins.length, MAX_PINNED_CHANNELS);
  assert.strictEqual(new Set(pins).size, pins.length);
});

test('pinnedChannelsFromGroups labels Discord via catalog', () => {
  const rows = pinnedChannelsFromGroups([
    {
      id: 'abcdef0123456789',
      name: 'Wing',
      pinnedChannels: ['discord:999999999999999999', 'group:abcdef0123456789']
    }
  ], {
    discordChannels: [{
      key: 'discord:999999999999999999',
      label: '#ops',
      guildId: '1',
      guildName: 'Org'
    }]
  });
  assert.strictEqual(rows.length, 2);
  assert.strictEqual(rows[0].label, '#ops');
  assert.strictEqual(rows[0].groupName, 'Wing');
  assert.strictEqual(rows[0].pinned, true);
  assert.strictEqual(rows[1].key, 'group:abcdef0123456789');
});

test('creator can update pinnedChannels via GroupManager', async () => {
  const alice = createIdentity();
  const bob = createIdentity();
  const dir = tmpDir();
  const svc = new LiveRelay({
    port: 0,
    settingsDir: dir,
    missions: { enable: true, officers: [alice.pubkey] },
    peers: [],
    fabric: { enable: false }
  });
  await svc.start();
  svc.setIdentity(alice);

  try {
    const created = await svc.groupManager.createGroup({
      name: 'Pin Wing',
      members: [bob.pubkey],
      threshold: 1
    }, alice.pubkey);
    assert.deepStrictEqual(created.pinnedChannels || [], []);

    const updated = await svc.groupManager.updateGroup(created.id, {
      pinnedChannels: ['discord:555555555555555555', 'group:' + created.id, 'junk']
    }, alice.pubkey);
    assert.deepStrictEqual(updated.pinnedChannels, [
      'discord:555555555555555555',
      'group:' + created.id
    ]);

    let denied = null;
    try {
      await svc.groupManager.updateGroup(created.id, {
        pinnedChannels: []
      }, bob.pubkey);
    } catch (e) {
      denied = e;
    }
    assert.ok(denied);
    assert.match(String(denied.message || denied), /creator/i);

    const ingested = svc.groupManager.ingestGroupChange({
      id: 'chg-pins-1',
      groupId: created.id,
      contractId: created.contractId,
      action: 'update',
      actor: alice.pubkey,
      patch: { pinnedChannels: ['discord:666666666666666666'] },
      ts: new Date().toISOString()
    }, alice.pubkey);
    assert.strictEqual(ingested.applied, true);
    assert.deepStrictEqual(ingested.group.pinnedChannels, ['discord:666666666666666666']);
  } finally {
    await svc.stop();
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) { /* ignore */ }
  }
});

test('members can patch pinnedMessages; other settings stay creator-only', async () => {
  const alice = createIdentity();
  const bob = createIdentity();
  const dir = tmpDir();
  const svc = new LiveRelay({
    port: 0,
    settingsDir: dir,
    missions: { enable: true, officers: [alice.pubkey] },
    peers: [],
    fabric: { enable: false }
  });
  await svc.start();
  svc.setIdentity(alice);

  try {
    const created = await svc.groupManager.createGroup({
      name: 'Pin Wing',
      members: [bob.pubkey],
      threshold: 1
    }, alice.pubkey);
    const updated = await svc.groupManager.updateGroup(created.id, {
      pinnedMessages: ['deadbeefcafebabe', 'junk']
    }, bob.pubkey);
    assert.deepStrictEqual(updated.pinnedMessages, ['deadbeefcafebabe']);

    let denied = null;
    try {
      await svc.groupManager.updateGroup(created.id, { name: 'Hijack' }, bob.pubkey);
    } catch (e) {
      denied = e;
    }
    assert.ok(denied);
    assert.match(String(denied.message || denied), /creator/i);
  } finally {
    await svc.stop();
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) { /* ignore */ }
  }
});
