'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { fixtureIdentity } = require('./fixtures/identities');
const Group = require('../../types/Group');
const { groupTaprootWallet, groupSpendLadder } = require('../../functions/groupSpendLadder');
const {
  selectActiveTiers,
  toAddress,
  policyAfterDecay
} = require('@fabric/core/functions/contractTaproot');

const alice = fixtureIdentity('alice');
const bob = fixtureIdentity('bob');
const carol = fixtureIdentity('carol');

describe('group roles + taproot spend ladder', () => {
  it('reader is member but not signer; tip verify ignores readers', () => {
    const g = new Group({
      id: 'g1',
      name: 'Wing',
      creator: alice.pubkey,
      members: [alice.pubkey, bob.pubkey, carol.pubkey],
      validators: [alice.pubkey, bob.pubkey],
      threshold: 2
    });
    g.validate();
    assert.equal(g.isSigner(alice.pubkey), true);
    assert.equal(g.isReader(carol.pubkey), true);
    assert.equal(g.isSigner(carol.pubkey), false);
    assert.equal(g.validators.length, 2);
  });

  it('adding a reader does not change Taproot address; adding a signer does', () => {
    const base = {
      id: 'g2',
      name: 'Fleet',
      creator: alice.pubkey,
      members: [alice.pubkey, bob.pubkey],
      validators: [alice.pubkey, bob.pubkey],
      threshold: 2
    };
    const w1 = groupTaprootWallet(base, { network: 'regtest' });
    assert.equal(w1.mode, 'taproot');
    assert.equal(w1.treasury.role, 'alliance-treasury');
    assert.equal(w1.treasury.custody, 'org-node');
    const a1 = w1.address;
    const withReader = Object.assign({}, base, {
      members: [alice.pubkey, bob.pubkey, carol.pubkey],
      validators: [alice.pubkey, bob.pubkey]
    });
    const a2 = groupTaprootWallet(withReader, { network: 'regtest' }).address;
    assert.equal(a1, a2);
    const withSigner = Object.assign({}, base, {
      members: [alice.pubkey, bob.pubkey, carol.pubkey],
      validators: [alice.pubkey, bob.pubkey, carol.pubkey],
      threshold: 2
    });
    const a3 = groupTaprootWallet(withSigner, { network: 'regtest' }).address;
    assert.notEqual(a1, a3);
  });

  it('until expires tier0 from active set; child policy address differs', () => {
    const g = {
      creator: alice.pubkey,
      validators: [alice.pubkey, bob.pubkey, carol.pubkey],
      members: [alice.pubkey, bob.pubkey, carol.pubkey],
      threshold: 2,
      spendLadder: {
        network: 'regtest',
        publisher: alice.pubkey,
        decay: { mode: 'both', migrateKeys: [alice.pubkey, bob.pubkey], migrateThreshold: 1 },
        tiers: [
          {
            id: 't0',
            threshold: 2,
            keys: [alice.pubkey, bob.pubkey, carol.pubkey],
            after: null,
            until: { type: 'csv', blocks: 50 }
          },
          {
            id: 't1',
            threshold: 1,
            keys: [alice.pubkey],
            after: { type: 'csv', blocks: 50 },
            until: null
          }
        ]
      }
    };
    const policy = groupSpendLadder(g);
    const early = selectActiveTiers(policy, { utxoAgeBlocks: 0 });
    assert.equal(early[0].id, 't0');
    const late = selectActiveTiers(policy, { utxoAgeBlocks: 60 });
    assert.equal(late[0].id, 't1');
    const child = policyAfterDecay(policy, { type: 'csv', blocks: 50 });
    assert.notEqual(toAddress(child), toAddress(policy));
  });
});
