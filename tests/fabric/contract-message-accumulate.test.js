'use strict';

/**
 * ARC accumulate + 2PC wiring smoke (GoonCitizen Store façade).
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const accumulate = require('../../functions/contractMessageAccumulate');
const commit = require('../../functions/contractMessageCommit');
const { Store } = require('../../types/Store');

describe('contractMessageAccumulate (GC Store)', () => {
  it('re-exports core accumulate helpers', () => {
    assert.equal(typeof accumulate.ingestMessageBuffer, 'function');
    assert.equal(typeof accumulate.createMemoryStore, 'function');
    assert.equal(typeof commit.createPending, 'function');
    assert.equal(typeof commit.markReceived, 'function');
  });

  it('persists through GoonCitizen Store get/put', () => {
    const store = new Store({ path: null });
    const mem = accumulate.createMemoryStore();
    // Seed a synthetic doc the way ingest would — Store API shape only.
    const id = 'a'.repeat(64);
    store.put(accumulate.COLLECTION, id, {
      id,
      version: 1,
      clock: 0,
      content: {},
      entries: []
    });
    const got = store.get(accumulate.COLLECTION, id);
    assert.ok(got);
    assert.equal(got.id, id);
    assert.equal(typeof mem.get, 'function');
  });

  it('createPending + markReceived round-trip on Store', () => {
    const store = new Store({ path: null });
    const pubkey = '02' + 'ab'.repeat(32);
    const hash = 'cd'.repeat(32);
    const record = commit.createPending({
      id: hash,
      contractId: 'ab'.repeat(32),
      readers: [pubkey]
    });
    commit.markReceived(record, pubkey);
    store.put('contractmessagecommits', hash, record);
    const loaded = store.get('contractmessagecommits', hash);
    const flags = commit.phaseFlags(loaded, pubkey);
    assert.equal(flags.received, true);
    assert.equal(flags.receipt, false);
  });
});
