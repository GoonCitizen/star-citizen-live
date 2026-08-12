'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const chatDelivery = require('../../functions/chatDelivery');
const commit = require('../../functions/contractMessageCommit');

function memStore () {
  const bags = Object.create(null);
  return {
    get (col, id) {
      const bag = bags[col] || Object.create(null);
      return bag[id] || null;
    },
    put (col, id, row) {
      if (!bags[col]) bags[col] = Object.create(null);
      bags[col][id] = row;
      return row;
    },
    all (col) {
      const bag = bags[col] || Object.create(null);
      return Object.keys(bag).map((k) => bag[k]);
    }
  };
}

describe('chatDelivery 2PC helpers', () => {
  it('attachWireHash links ChatMessage to AMP hash', () => {
    const store = memStore();
    store.put('chatmessages', 'c1', { id: 'c1', channel: 'group:g1', body: 'hi' });
    const row = chatDelivery.attachWireHash(store, 'c1', 'aa'.repeat(32), 'contract1');
    assert.equal(row.wireHash, 'aa'.repeat(32));
    assert.equal(row.contractId, 'contract1');
  });

  it('enrichChatMessages surfaces aggregate flags only when all readers complete', () => {
    const store = memStore();
    const a = '11'.repeat(32);
    const b = '22'.repeat(32);
    const hash = 'bb'.repeat(32);
    store.put('chatmessages', 'm1', {
      id: 'm1',
      channel: 'group:g1',
      body: 'o7',
      wireHash: hash
    });
    const record = commit.createPending({
      id: hash,
      contractId: 'c1',
      wireHash: hash,
      readers: [a, b]
    });
    commit.markReceived(record, a);
    store.put('contractmessagecommits', hash, record);

    let rows = chatDelivery.enrichChatMessages(store, [store.get('chatmessages', 'm1')], a);
    assert.equal(rows[0].delivery.aggregate.received, false);
    assert.equal(rows[0].delivery.local.received, true);
    assert.equal(rows[0].delivery.receivedCount, 1);

    commit.markReceived(record, b);
    store.put('contractmessagecommits', hash, record);
    rows = chatDelivery.enrichChatMessages(store, [store.get('chatmessages', 'm1')], a);
    assert.equal(rows[0].delivery.aggregate.received, true);
    assert.equal(rows[0].delivery.aggregate.receipt, false);
  });

  it('enrichWithDelivery works without requiring a group channel', () => {
    const store = memStore();
    const hash = 'ff'.repeat(32);
    const a = '11'.repeat(32);
    const record = commit.createPending({
      id: hash,
      contractId: 'c9',
      wireHash: hash,
      readers: [a]
    });
    record.sourceType = 'GroupChange';
    store.put('contractmessagecommits', hash, record);
    const rows = chatDelivery.enrichWithDelivery(store, [{ id: 'x', wireHash: hash }], a, {
      requireGroupChannel: false
    });
    assert.ok(rows[0].delivery);
    assert.equal(rows[0].delivery.sourceType, 'GroupChange');
    assert.equal(rows[0].delivery.readers, 1);
  });

  it('markLocalReceipt and applyRemoteDeliveryAck complete phase 2', () => {
    const Key = require('@fabric/core/types/key');
    const store = memStore();
    const aKey = new Key();
    const bKey = new Key();
    const a = require('../../functions/groupChatSeal').pubkeyXOnly(aKey.pubkey);
    const b = require('../../functions/groupChatSeal').pubkeyXOnly(bKey.pubkey);
    const hash = 'cc'.repeat(32);
    const out = chatDelivery.markLocalReceipt(store, {
      wireHash: hash,
      contractId: 'c1',
      readers: [a, b],
      viewerPubkey: a,
      signerKey: aKey
    });
    assert.equal(out.flags.receipt, true);
    assert.equal(out.aggregate.receipt, false);
    assert.ok(/^[0-9a-f]{128}$/i.test(out.receiptSig));

    const receiptSigB = chatDelivery.signReceiptSig(bKey, hash);
    chatDelivery.applyRemoteDeliveryAck(store, {
      messageId: hash,
      type: 'MessageReceipt',
      receiptAt: new Date().toISOString(),
      receiptSig: receiptSigB
    }, b, { contractId: 'c1', readers: [a, b] });

    const record = store.get('contractmessagecommits', hash);
    const flags = commit.aggregatePhaseFlags(record);
    assert.equal(flags.received, true);
    assert.equal(flags.receipt, true);
  });

  it('skips delivery enrichment for global chat', () => {
    const store = memStore();
    const rows = chatDelivery.enrichChatMessages(store, [{
      id: 'g1',
      channel: 'global',
      body: 'hi',
      wireHash: 'dd'.repeat(32)
    }], '11'.repeat(32));
    assert.equal(rows[0].delivery, undefined);
  });

  it('resolveDeliveryTarget prefers commit + chat row hints', () => {
    const store = memStore();
    const hash = 'ee'.repeat(32);
    const a = '11'.repeat(32);
    const record = commit.createPending({
      id: hash,
      contractId: 'ctr-1',
      wireHash: hash,
      readers: [a]
    });
    record.sourceType = 'GroupChat';
    store.put('contractmessagecommits', hash, record);
    store.put('chatmessages', 'm9', {
      id: 'm9',
      channel: 'group:g9',
      wireHash: hash,
      contractId: 'ctr-1'
    });
    const target = chatDelivery.resolveDeliveryTarget({ store }, hash, {});
    assert.equal(target.wireHash, hash);
    assert.equal(target.contractId, 'ctr-1');
    assert.equal(target.chatMessageId, 'm9');
    assert.equal(target.sourceType, 'GroupChat');
    assert.deepEqual(target.readers, [a]);
  });
});
