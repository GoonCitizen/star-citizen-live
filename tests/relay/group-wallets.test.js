'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const path = require('path');
const Federation = require('@fabric/core/types/federation');
const { pubkeyXOnly } = require('@fabric/core/functions/pubkey');
const { fixtureIdentity, fixtureKey, fixtureCosignerKey } = require('./fixtures/identities');
const Group = require('../../types/Group');
const GroupWallets = require('../../services/GroupWallets');
const { createGroupCosigner } = require('../../functions/groupCosigner');

// Same bitcoinjs-lib the core federation helpers use (bigint output values).
const { Transaction, address, networks } = require(require.resolve('bitcoinjs-lib', {
  paths: [path.dirname(require.resolve('@fabric/core/types/federation'))]
}));

const alice = fixtureIdentity('alice');
const bob = fixtureIdentity('bob');
const carol = fixtureIdentity('carol');
const DEST = address.toBech32(crypto.randomBytes(20), 0, 'bcrt');
const CONTRACT = 'c-wing';
const cos = (name, network = 'regtest') => fixtureCosignerKey(name, network).pubkey;

/** `cosigners` map for a group: each name's `cosigner.set` record per network. */
function cosignersFor (names, networks = ['regtest']) {
  const out = {};
  for (const name of names) {
    const identityKey = fixtureKey(name);
    const entry = {};
    for (const network of networks) {
      entry[network] = createGroupCosigner({ identityKey, cosignerKey: fixtureCosignerKey(name, network), group: CONTRACT, network });
    }
    out[pubkeyXOnly(identityKey.pubkey)] = entry;
  }
  return out;
}

function memoryStore () {
  const data = new Map();
  const col = (c) => { if (!data.has(c)) data.set(c, new Map()); return data.get(c); };
  const copy = (v) => (v == null ? null : JSON.parse(JSON.stringify(v)));
  return {
    get: (c, id) => copy(col(c).get(id)),
    put: (c, id, v) => { col(c).set(id, copy(v)); },
    all: (c) => [...col(c).values()].map(copy)
  };
}

/** One shared fake chain: vault coins by address, raw transactions by txid. */
function fakeChain () {
  const txs = new Map();
  const coins = new Map();
  const broadcasts = [];
  return {
    broadcasts,
    fund (vaultAddress, sats) {
      const tx = new Transaction();
      tx.version = 2;
      tx.addInput(crypto.randomBytes(32), 0);
      tx.addOutput(address.toOutputScript(vaultAddress, networks.regtest), BigInt(sats));
      const txid = tx.getId();
      txs.set(txid, tx.toHex());
      if (!coins.has(vaultAddress)) coins.set(vaultAddress, []);
      coins.get(vaultAddress).push({ txid, vout: 0, amountSats: sats, height: 101 });
      return txid;
    },
    adapter: {
      scan: async (addr) => ({ utxos: coins.get(addr) || [] }),
      rawTransaction: async (txid) => {
        if (!txs.has(txid)) throw new Error(`no tx ${txid}`);
        return txs.get(txid);
      },
      broadcast: async (hex) => {
        const txid = Transaction.fromHex(hex).getId();
        if (broadcasts.some((b) => b.txid === txid)) throw new Error('txn-already-in-mempool');
        broadcasts.push({ txid, hex });
        txs.set(txid, hex);
        return txid;
      }
    }
  };
}

/** Nodes that deliver each other's federation messages, signed by the sender key. */
function mesh (names, groupsFor, chain) {
  const queue = [];
  const nodes = {};
  for (const name of names) {
    const key = fixtureCosignerKey(name);
    nodes[name] = new GroupWallets({
      store: memoryStore(),
      network: 'regtest',
      signingKey: () => key,
      publish: (body) => queue.push({ from: name, body: JSON.parse(JSON.stringify(body)) }),
      chain: chain.adapter,
      groups: () => groupsFor(name)
    });
  }
  return {
    nodes,
    queue,
    async pump () {
      while (queue.length) {
        const { from, body } = queue.shift();
        for (const [name, node] of Object.entries(nodes)) {
          if (name !== from) await node.receive(body, cos(from));
        }
      }
    }
  };
}

function wingGroup (overrides = {}) {
  return new Group(Object.assign({
    id: 'g-wing',
    name: 'Wing',
    contractId: CONTRACT,
    creator: alice.pubkey,
    members: [alice.pubkey, bob.pubkey, carol.pubkey],
    validators: [alice.pubkey, bob.pubkey],
    cosigners: cosignersFor(['alice', 'bob', 'carol']),
    threshold: 2
  }, overrides));
}

describe('group wallets (named federation)', () => {
  it('reader is member but not signer', () => {
    const g = wingGroup();
    g.validate();
    assert.equal(g.isSigner(alice.pubkey), true);
    assert.equal(g.isReader(carol.pubkey), true);
    assert.equal(g.isSigner(carol.pubkey), false);
  });

  it('vault is the core federation of the signers\' cosigner keys; readers do not move it, signers do', () => {
    const wallets = new GroupWallets({ store: memoryStore() });
    const g = wingGroup();
    const w = wallets.wallet(g, alice.pubkey);
    const descriptor = Federation.buildDescriptor({ validators: [cos('bob'), cos('alice')], threshold: 2, network: 'regtest', publisher: cos('alice') });
    assert.ok(!descriptor.validators.includes(alice.pubkey), 'identity keys are never validators');
    assert.equal(w.mode, 'federation');
    assert.equal(w.federationId, Federation.descriptorId(descriptor));
    assert.equal(w.address, Federation.vaultForDescriptor(descriptor).address);
    assert.equal(w.viewerIsSigner, true);
    assert.equal(w.viewerKey, pubkeyXOnly(cos('alice')));
    assert.deepEqual(w.missingCosigners, []);
    assert.equal(wallets.wallet(g, carol.pubkey).viewerIsSigner, false);

    const withReader = wingGroup({ members: [alice.pubkey, bob.pubkey, carol.pubkey, fixtureIdentity('hub').pubkey] });
    assert.equal(wallets.wallet(withReader).address, w.address);

    const withSigner = wingGroup({ validators: [alice.pubkey, bob.pubkey, carol.pubkey] });
    const moved = wallets.wallet(withSigner);
    assert.notEqual(moved.address, w.address);
    assert.deepEqual(moved.previous.map((p) => p.address), [w.address], 'earlier vault is kept');
  });

  it('shows no vault until every signer has published a cosigner key for the network', async () => {
    const wallets = new GroupWallets({ store: memoryStore() });
    const g = wingGroup({ cosigners: cosignersFor(['alice']) });
    const w = wallets.wallet(g, alice.pubkey);
    assert.equal(w.address, null);
    assert.deepEqual(w.missingCosigners, [bob.pubkey]);
    assert.equal(w.viewerIsSigner, false);
    await assert.rejects(
      wallets.request(g, alice.pubkey, { destinationAddress: DEST, amountSats: 1000, feeSats: 500 }),
      /publish a wallet key/
    );
    const signet = new GroupWallets({ store: memoryStore(), network: 'signet' });
    assert.deepEqual(signet.wallet(wingGroup(), alice.pubkey).missingCosigners, [alice.pubkey, bob.pubkey],
      'a key for regtest does not count on signet');
  });

  it('2-of-2: one signer requests, the other signs over the mesh, and the spend broadcasts', async () => {
    const chain = fakeChain();
    const g = wingGroup();
    const net = mesh(['alice', 'bob'], () => [g.toJSON()], chain);
    const vault = net.nodes.alice.federation(g).address;
    chain.fund(vault, 100000);

    const seen = [];
    net.nodes.bob.on('withdrawal', (w) => seen.push(w));
    const requested = await net.nodes.alice.request(g, alice.pubkey, { destinationAddress: DEST, amountSats: 60000, feeSats: 500 });
    assert.equal(requested.status, 'pending');
    assert.deepEqual(requested.signers, [pubkeyXOnly(cos('alice'))], 'requester signs right away');
    assert.equal(requested.changeSats, 39500);

    await net.pump();
    assert.equal(seen.length, 1, 'bob learns of the request without opening the wallet');
    const atBob = net.nodes.bob.withdrawals(g.id)[0];
    assert.equal(atBob.id, requested.id);
    assert.deepEqual(atBob.signers, [pubkeyXOnly(cos('alice'))]);

    const signed = await net.nodes.bob.approve(g, requested.id, bob.pubkey);
    assert.equal(signed.status, 'broadcast');
    assert.equal(chain.broadcasts.length, 1);
    const tx = Transaction.fromHex(chain.broadcasts[0].hex);
    assert.equal(tx.outs.length, 2);

    await net.pump();
    const atAlice = net.nodes.alice.withdrawals(g.id)[0];
    assert.equal(atAlice.status, 'broadcast', 'alice finalizes from bob\'s signature (already-known counts)');
    assert.equal(atAlice.broadcastTxid, chain.broadcasts[0].txid);
    assert.equal(chain.broadcasts.length, 1);
  });

  it('refuses requests from readers and signatures from outside the federation', async () => {
    const chain = fakeChain();
    const g = wingGroup();
    const net = mesh(['alice', 'bob'], () => [g.toJSON()], chain);
    chain.fund(net.nodes.alice.federation(g).address, 100000);

    await assert.rejects(
      net.nodes.alice.request(g, carol.pubkey, { destinationAddress: DEST, amountSats: 1000, feeSats: 500 }),
      (e) => e.code === 'FORBIDDEN'
    );

    const requested = await net.nodes.alice.request(g, alice.pubkey, { destinationAddress: DEST, amountSats: 1000, feeSats: 500 });
    net.queue.length = 0;
    const fid = requested.federationId;
    const zeros = (pubkey) => [{ pubkey: pubkeyXOnly(pubkey), leafHash: '00'.repeat(32), signature: '00'.repeat(64) }];
    await assert.rejects(
      net.nodes.alice.receive(Federation.signatureMessage(fid, requested.id, zeros(cos('carol'))), cos('carol')),
      'a non-signer frame is refused'
    );
    await assert.rejects(
      net.nodes.alice.receive(Federation.signatureMessage(fid, requested.id, zeros(bob.pubkey)), bob.pubkey),
      'a frame from a signer\'s identity key is refused'
    );
    await assert.rejects(
      net.nodes.alice.receive(Federation.signatureMessage(fid, requested.id, zeros(cos('alice'))), cos('bob')),
      /does not belong/,
      'bob cannot pass off a signature under alice\'s key'
    );
    await assert.rejects(
      net.nodes.alice.receive(Federation.signatureMessage(fid, requested.id, zeros(cos('bob'))), cos('bob')),
      'an invalid signature from a signer is refused'
    );
    assert.equal(net.nodes.alice.withdrawals(g.id)[0].status, 'pending');
  });

  it('an earlier vault stays spendable after the signers change', async () => {
    const chain = fakeChain();
    let g = wingGroup();
    const net = mesh(['alice', 'bob'], () => [g.toJSON()], chain);
    const old = net.nodes.alice.federation(g);
    net.nodes.bob.federation(g);
    chain.fund(old.address, 50000);

    g = wingGroup({ validators: [alice.pubkey, bob.pubkey, carol.pubkey] });
    const w = net.nodes.alice.wallet(g, alice.pubkey);
    assert.notEqual(w.federationId, old.id);
    assert.equal(w.previous[0].federationId, old.id);

    const requested = await net.nodes.alice.request(g, alice.pubkey, { federationId: old.id, destinationAddress: DEST, amountSats: 20000, feeSats: 500 });
    await net.pump();
    const signed = await net.nodes.bob.approve(g, requested.id, bob.pubkey);
    assert.equal(signed.status, 'broadcast');
    assert.equal(signed.federationId, old.id);
  });

  it('refuses mainnet unless allowed', async () => {
    const wallets = new GroupWallets({ store: memoryStore(), network: 'mainnet', signingKey: () => fixtureCosignerKey('alice', 'mainnet') });
    await assert.rejects(
      wallets.request(wingGroup({ cosigners: cosignersFor(['alice', 'bob'], ['mainnet']) }), alice.pubkey, { destinationAddress: DEST, amountSats: 1000, feeSats: 500, fundedTxHex: '00' }),
      /mainnet/
    );
  });
});
