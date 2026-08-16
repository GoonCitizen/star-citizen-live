'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert');

const Key = require('@fabric/core/types/key');
const Message = require('@fabric/core/types/message');
const coreCol = require('@fabric/core/functions/fabricMessageCollection');
const localCol = require('../../functions/fabricMessageCollection');
const groupDataSync = require('../../functions/groupDataSync');
const {
  createFabricMessageLog,
  summarizeBuffer,
  collectionFromLog,
  replayLogCollection
} = require('../../functions/fabricMessageLog');

describe('fabricMessageCollection', () => {
  it('re-exports the core helper', () => {
    assert.strictEqual(localCol.createCollection, coreCol.createCollection);
    assert.strictEqual(localCol.COLLECTION_TYPE, 'FabricMessageCollection');
  });

  it('round-trips Discord GroupDataShare packs as AMP hex and restores them', () => {
    const key = new Key();
    const share = groupDataSync.buildShare({
      groupId: 'grp-ops',
      sourceAppId: 'gooncitizen',
      observedAt: '2026-08-15T00:00:00.000Z',
      packs: [{
        pack: groupDataSync.PACK_DISCORD_CATALOG,
        payload: {
          guilds: [{
            id: 'g1',
            name: 'Fleet Ops',
            memberCount: 2,
            channels: [{ id: 'c1', name: 'general', type: 0, position: 0 }],
            members: [{ id: 'u1', username: 'alice', displayName: 'Alice', bot: false }]
          }]
        }
      }]
    });
    assert.ok(share);
    const contractId = 'ab'.repeat(32);
    const msg = Message.fromVector(['CONTRACT_MESSAGE', JSON.stringify({
      contract: contractId,
      type: share.type,
      object: share
    })]).signWithKey(key);

    const collection = localCol.createCollection();
    assert.strictEqual(localCol.ingest(collection, msg).accepted, true);
    const restored = localCol.fromJSON(localCol.toJSON(collection));
    const packs = [];
    const result = localCol.replay(restored, (ctx) => {
      assert.strictEqual(ctx.inner.type, 'GroupDataShare');
      const sanitized = groupDataSync.sanitizeShare(ctx.inner.object);
      packs.push(sanitized);
    });
    assert.strictEqual(result.applied, 1);
    assert.strictEqual(packs[0].packs[0].pack, groupDataSync.PACK_CHAT_CATALOG);
    assert.strictEqual(packs[0].packs[0].payload.guilds[0].id, 'g1');
  });

  it('replays group journal fabricMessage.hex into a second collection', () => {
    const key = new Key();
    const contractId = 'cd'.repeat(32);
    const change = Message.fromVector(['CONTRACT_MESSAGE', JSON.stringify({
      contract: contractId,
      type: 'GroupChange',
      object: { action: 'member.add', member: key.pubkey }
    })]).signWithKey(key);
    const stored = localCol.ingest(localCol.createCollection(), change);
    const entries = [{
      id: 'gchg-replay',
      type: 'GroupChange',
      fabricMessage: {
        hash: stored.record.hash,
        hex: stored.record.hex,
        type: 'GroupChange'
      }
    }];
    const fromJournal = localCol.recordsFromJournalEntries(entries);
    const peer = localCol.createCollection();
    assert.strictEqual(localCol.ingestMany(peer, fromJournal).accepted, 1);
    assert.strictEqual(peer.messages[0].hash, stored.record.hash);
  });

  it('exports the in-memory peer log as a collection and replays it', () => {
    const key = new Key();
    const chat = Message.fromVector(['P2P_CHAT_MESSAGE', 'o7 mesh']).signWithKey(key);
    const log = createFabricMessageLog({ capacity: 8 });
    const summary = summarizeBuffer(chat.toBuffer(), { direction: 'in', peer: 'hub.fabric.pub:7777' });
    assert.ok(summary.hex);
    log.append(summary);
    const doc = collectionFromLog(log);
    assert.strictEqual(doc.type, 'FabricMessageCollection');
    assert.strictEqual(doc.count, 1);
    const texts = [];
    replayLogCollection(doc, (ctx) => {
      texts.push(ctx.message.body);
    });
    assert.deepStrictEqual(texts, ['o7 mesh']);
  });
});
