'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert');

const MarketManager = require('../../services/MarketManager');
const { HTLC_MINIMUM_SATS } = require('@fabric/core/constants');

/** In-memory stand-in for `types/Store` get/put. */
function memoryStore () {
  const rows = new Map();
  return {
    get: (c, id) => rows.get(`${c}/${id}`) || null,
    put: (c, id, v) => { rows.set(`${c}/${id}`, JSON.parse(JSON.stringify(v))); },
    rows
  };
}

describe('MarketManager (chunk index + budget agent)', () => {
  it('keeps the agent off by default and reports it as disabled', () => {
    const mm = new MarketManager({ store: memoryStore() });
    assert.strictEqual(mm.agent, null);
    assert.deepStrictEqual(mm.agentStatus(), { type: 'MarketAgentStatus', available: false, reason: 'disabled' });
    assert.throws(() => mm.agentWant({ documentId: 'x' }), /not enabled/);
  });

  it('composes the core agent over the shared book and persists its state in the Store', () => {
    const store = memoryStore();
    const mm = new MarketManager({
      store,
      persistDebounceMs: 0,
      agent: { enable: true, budgetSats: 25, perPlanMaxSats: 10, tickMs: 0 },
      bitcoin: { enable: true, network: 'regtest', hub: 'http://127.0.0.1:1' }
    });
    const status = mm.agentStatus();
    assert.strictEqual(status.available, true);
    assert.strictEqual(status.budgetSats, 25);
    assert.strictEqual(mm.agent.book, mm.book, 'agent ranks from the manager book');

    const want = mm.agentWant({ documentId: 'doc-1', blobTotal: 3, maxSats: 9 });
    assert.strictEqual(want.status, 'wanted');
    assert.strictEqual(mm.agentConfigure({ budgetSats: 40, proximityWeight: 1 }).budgetSats, 40);
    mm.persist();
    const saved = store.get(MarketManager.COLLECTION, 'agent');
    assert.strictEqual(saved.type, 'MarketAgentState');
    assert.strictEqual(saved.budgetSats, 40);
    assert.ok(saved.wants['doc-1']);

    // A fresh manager over the same Store restores the agent state.
    const again = new MarketManager({
      store,
      agent: { enable: true, tickMs: 0 },
      bitcoin: { enable: true, network: 'regtest', hub: 'http://127.0.0.1:1' }
    });
    const restored = again.agentStatus();
    assert.strictEqual(restored.budgetSats, 40);
    assert.strictEqual(restored.wants[0].documentId, 'doc-1');
    assert.strictEqual(again.agentForget('doc-1'), true);
  });

  it('refuses the budget agent on mainnet (D-008)', () => {
    const mm = new MarketManager({
      store: memoryStore(),
      agent: { enable: true },
      bitcoin: { enable: true, network: 'mainnet', hub: 'http://127.0.0.1:1' }
    });
    mm.on('error', () => {});
    assert.strictEqual(mm.agentStatus().available, false);
    assert.strictEqual(mm.agent, null);
  });
});

describe('MarketManager provider side (Phase 3)', () => {
  const crypto = require('crypto');
  const Challenge = require('@fabric/core/types/challenge');
  const Document = require('@fabric/core/types/document');
  const Witness = require('@fabric/core/types/witness');

  it('answers challenges addressed to its key from the local tree and ingests fraud proofs', () => {
    const published = [];
    const publisherPriv = crypto.randomBytes(32);
    const providerPriv = crypto.randomBytes(32);
    const doc = Document.seal(crypto.randomBytes(5000), { chunkBytes: 2048, documentId: 'x' });
    const hashes = doc.record().blobs.map((b) => b.blobHashHex);
    // Availability commits the storage tree of blob hashes. The document root
    // also binds payment hashes and IVs, so it is a different value.
    const storageRoot = Challenge.createBlobMerkleTree(hashes).rootHex;
    const mm = new MarketManager({ store: memoryStore(), persistDebounceMs: 0 });
    mm.attach({
      providerPrivateKey: providerPriv,
      localTree: (root) => (root === storageRoot ? { blobHashes: hashes, bytesFor: (i) => doc.bytesFor(i) } : null),
      publish: (type, object) => published.push({ type, object })
    });
    const me = mm.providerPubkey();
    assert.strictEqual(me, Witness.xOnlyPubkeyHex(providerPriv));

    // The challenge names the provider's deposit outpoint so a wrongful penalty
    // (publisher spending it after a valid response) is provable from the tx.
    const Bond = require('@fabric/core/types/bond');
    const bitcoinjs = require(require.resolve('bitcoinjs-lib', { paths: [require.resolve('@fabric/core/types/channel')] }));
    const { signerFromPriv32 } = require('@fabric/core/types/htlc');
    const compressed = (p) => Buffer.from(signerFromPriv32(p).publicKey).toString('hex');

    const commitment = mm.commitAvailability({
      merkleRootHex: storageRoot,
      blobTotal: hashes.length,
      fromEpoch: 1,
      untilEpoch: 50,
      publisherPubkey: compressed(publisherPriv)
    });
    assert.strictEqual(commitment.type, 'AvailabilityCommitment');
    const deposit = Bond.buildDeposit({ network: 'regtest', providerPubkey: compressed(providerPriv), publisherPubkey: compressed(publisherPriv), withdrawAfter: 900, amountSats: 30000 });
    const fundingTx = new bitcoinjs.Transaction();
    fundingTx.addInput(crypto.randomBytes(32), 0);
    fundingTx.addOutput(bitcoinjs.address.toOutputScript(deposit.address, bitcoinjs.networks.regtest), BigInt(30000));
    const fundedTxHex = fundingTx.toHex();

    const challenger = new Challenge();
    const forMe = challenger.issue({
      merkleRootHex: storageRoot, blobHashes: hashes, epoch: 3, deadlineHeight: 1000,
      deposit: { txid: fundingTx.getId(), vout: 0 }, providerPubkey: me, publisherPrivateKey: publisherPriv
    });
    const response = mm.onAvailabilityChallenge(forMe);
    assert.ok(response);
    assert.strictEqual(challenger.validate(forMe, response, { bytes: doc.bytesFor(forMe.blobIndex) }).ok, true);

    const notMe = challenger.issue({ merkleRootHex: storageRoot, blobHashes: hashes, epoch: 3, providerPubkey: 'ab'.repeat(32), publisherPrivateKey: publisherPriv });
    assert.strictEqual(mm.onAvailabilityChallenge(notMe), null);
    const unknownTree = challenger.issue({ merkleRootHex: 'cd'.repeat(32), blobTotal: 2, epoch: 3, providerPubkey: me, publisherPrivateKey: publisherPriv });
    assert.strictEqual(mm.onAvailabilityChallenge(unknownTree), null);
    assert.deepStrictEqual(published.map((p) => p.type), ['AvailabilityCommitment', 'AvailabilityResponse']);

    // Wrongful-penalty counter-proof is always publishable from the honest pair
    // plus the penalty transaction the publisher actually broadcast.
    assert.throws(() => mm.publishWrongfulPenalty(forMe, response, { txid: 'ef'.repeat(32) }), /penalty/i, 'a bare txid proves nothing');
    const dest = bitcoinjs.payments.p2wpkh({ pubkey: Buffer.from(compressed(publisherPriv), 'hex'), network: bitcoinjs.networks.regtest }).address;
    const penalty = Bond.prepareDepositPenalty(deposit, { fundedTxHex, deadlineHeight: 1000, destinationAddress: dest, feeSats: 500 });
    const taken = Bond.finalizePreSignedPenalty(deposit, Bond.signPenaltyAsProvider(deposit, penalty, providerPriv), publisherPriv, { tipHeight: 1000, penaltyAddress: dest });
    const prevouts = [{ scriptHex: Buffer.from(fundingTx.outs[0].script).toString('hex'), valueSats: '30000' }];
    const confirmed = { txConfirmed: (txid) => txid === taken.txid };
    const anchor = Challenge.receipt({ challenge: forMe, response, epoch: forMe.epoch, privateKey: publisherPriv });
    const penaltyTx = { txHex: taken.txHex, txid: taken.txid, anchor };
    assert.throws(() => mm.publishWrongfulPenalty(forMe, response, penaltyTx, confirmed), /prevouts required/);
    assert.throws(() => mm.publishWrongfulPenalty(forMe, response, Object.assign({ prevouts }, penaltyTx)), /broadcast evidence/, 'needs a chain view');
    const counter = mm.publishWrongfulPenalty(forMe, response, Object.assign({ prevouts }, penaltyTx), confirmed);
    assert.strictEqual(counter.kind, 'wrongful-penalty');
    assert.strictEqual(published[2].type, 'FraudProof');
    assert.strictEqual(mm.ingestFraudProof(counter, confirmed).ok, true);
    assert.strictEqual(mm.ingestFraudProof({ type: 'FraudProof', kind: 'wrong-leaf', artifacts: {} }).ok, false);
  });
});

describe('MarketManager payment channels (Phase 4)', () => {
  const crypto = require('crypto');
  const Channel = require('@fabric/core/types/channel');
  const bitcoin = require(require.resolve('bitcoinjs-lib', { paths: [require.resolve('@fabric/core/types/channel')] }));
  const { signerFromPriv32 } = require('@fabric/core/types/htlc');
  const NET = bitcoin.networks.regtest;

  it('is off by default; when enabled it opens, mirrors, persists and restores channels', () => {
    const off = new MarketManager({ store: memoryStore() });
    assert.strictEqual(off.channelsStatus().available, false);

    const privA = crypto.randomBytes(32); const privB = crypto.randomBytes(32);
    const pub = (p) => Buffer.from(signerFromPriv32(p).publicKey).toString('hex');
    const addr = (p) => bitcoin.payments.p2wpkh({ pubkey: Buffer.from(pub(p), 'hex'), network: NET }).address;
    const wire = { a: [], b: [] };
    const storeA = memoryStore();
    const A = new MarketManager({ store: storeA, persistDebounceMs: 0, channels: { enable: true }, bitcoin: { network: 'regtest' } });
    A.attach({ providerPrivateKey: privA, publish: (type, body) => wire.a.push(body) });
    const B = new MarketManager({ store: memoryStore(), persistDebounceMs: 0, channels: { enable: true }, bitcoin: { network: 'regtest' } });
    B.attach({ providerPrivateKey: privB, publish: (type, body) => wire.b.push(body) });

    const funding = Channel.buildFunding({ network: 'regtest', localPubkey: pub(privA), remotePubkey: pub(privB), expireAfter: 7000 });
    const tx = new bitcoin.Transaction();
    tx.addInput(crypto.randomBytes(32), 0);
    tx.addOutput(bitcoin.address.toOutputScript(funding.address, NET), BigInt(25000));
    const opened = A.channelOpen({ remotePubkey: pub(privB), fundedTxHex: tx.toHex(), capacitySats: 25000, expireAfter: 7000, localAddress: addr(privA), remoteAddress: addr(privB) });
    assert.strictEqual(wire.a.length, 1);
    assert.throws(() => B.ingestChannelMessage(wire.a[0], { sellerId: 'a' }), /chain tip unknown/);
    A.onBitcoinBlock({ height: 500 });
    B.onBitcoinBlock({ height: 500 });
    const pump = () => {
      let moved = true;
      while (moved) {
        moved = false;
        while (wire.a.length) { moved = true; B.ingestChannelMessage(wire.a.shift(), { sellerId: 'a' }); }
        while (wire.b.length) { moved = true; A.ingestChannelMessage(wire.b.shift(), { sellerId: 'b' }); }
      }
    };
    pump();
    assert.strictEqual(A.channelsStatus().channels[0].fullySigned, true);
    assert.strictEqual(A.channelsStatus().channels[0].status, 'open');
    const funder = A.channels.get(opened.channelId);
    const opening = 25000 - funder.state.feeSats - 2 * Channel.DEFAULTS.anchorSats;
    assert.ok(funder.state.feeSats >= Channel.DEFAULTS.minCommitFeeSats);
    assert.strictEqual(B.channelsStatus().channels[0].balances.remoteSats, opening);

    const sA = A.channels.get(opened.channelId);
    const sB = B.channels.get(opened.channelId);
    // Seller-fulfils: B's Fabric Peer sells a sealed blob; A pays for it over the
    // channel; B's Book fulfils the committed HTLC with K_i from the registry and
    // A learns the key from the ChannelHtlcFulfill (no out-of-band preimage).
    const Document = require('@fabric/core/types/document');
    const Peer = require('@fabric/core/types/peer');
    const sellerPeer = new Peer({ listen: false, sealPricedDocuments: true });
    const sealed = Document.seal(crypto.randomBytes(3000), { chunkBytes: 2048 });
    assert.ok(sellerPeer.publishSealedDocument(sealed, { rateSats: HTLC_MINIMUM_SATS }).ok);
    B.attach({ peer: sellerPeer });
    const paymentHashHex = sealed.paymentHashFor(0);
    const settled = [];
    A.on('channelHtlcSettled', (ev) => settled.push(ev));
    A.channels.publish(sA.offerHtlc({ amountSats: 1500, paymentHashHex, expireAfter: 6000 }), sA);
    let staleA = null;
    for (let guard = 0; guard < 20 && !staleA; guard++) {
      if (wire.a.length) B.ingestChannelMessage(wire.a.shift(), { sellerId: 'a' });
      else if (wire.b.length) A.ingestChannelMessage(wire.b.shift(), { sellerId: 'b' });
      if (sA.state.htlcs.length === 1 && !sA.busy) staleA = sA.finalize();
    }
    assert.ok(staleA, 'captured the commitment with the HTLC pending');
    pump();
    assert.strictEqual(sB.state.htlcs.length, 0, 'seller fulfilled its committed HTLC');
    assert.strictEqual(sB.balances.localSats, 1500);
    assert.strictEqual(sA.busy, false);
    assert.strictEqual(settled.length, 1);
    assert.strictEqual(settled[0].preimageHex, sealed.keyFor(0));

    // A broadcasts the revoked state: B detects the breach and gossips a FraudProof
    // carrying an SPV inclusion artifact when the host supplies header + txids.
    const { merkleRootFromTxids, headerMeetsTarget, parseHeader } = require('@fabric/core/functions/bitcoinTxInclusion');
    const staleTxid = bitcoin.Transaction.fromHex(staleA.txHex).getId();
    const txids = [crypto.randomBytes(32).toString('hex'), staleTxid];
    const header = Buffer.alloc(80);
    Buffer.from(merkleRootFromTxids(txids), 'hex').reverse().copy(header, 36);
    header.writeUInt32LE(0x207fffff, 72);
    for (let nonce = 0; !headerMeetsTarget(header.toString('hex')); nonce++) header.writeUInt32LE(nonce, 76);
    const blockHash = parseHeader(header.toString('hex')).blockHash;
    const breaches = [];
    B.on('channelBreach', (o) => breaches.push(o));
    const r = B.onBitcoinBlock({ height: 501, txHexes: [staleA.txHex], blockHeaderHex: header.toString('hex'), txids, destinationAddress: addr(privB) });
    assert.strictEqual(r.observations[0].kind, 'stale');
    assert.ok(breaches[0].justice && breaches[0].justice.inputs.length === 2, 'toLocal + HTLC swept');
    const proof = wire.b.pop();
    assert.strictEqual(proof.type, 'FraudProof');
    const Witness = require('@fabric/core/types/witness');
    assert.match(Witness.FraudProof.fromBody(proof).verify({}).reason, /chain view required/, 'a header anyone can build proves nothing');
    const verdict = Witness.FraudProof.fromBody(proof).verify({
      headerKnown: (hash) => hash === blockHash,
      confirmations: (hash) => (hash === blockHash ? 6 : 0),
      txCount: () => txids.length
    });
    assert.strictEqual(verdict.ok, true, verdict.reason);
    assert.strictEqual(verdict.evidence, 'inclusion');

    A.persist();
    const A2 = new MarketManager({ store: storeA, channels: { enable: true }, bitcoin: { network: 'regtest' } });
    A2.attach({ providerPrivateKey: privA });
    assert.strictEqual(A2.channelsStatus().channels[0].channelId, opened.channelId);

    const main = new MarketManager({ store: memoryStore(), channels: { enable: true }, bitcoin: { network: 'mainnet' } });
    main.attach({ providerPrivateKey: privA });
    main.on('error', () => {});
    assert.strictEqual(main.channelsStatus().available, false);
  });
});
