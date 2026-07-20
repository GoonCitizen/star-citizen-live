'use strict';

const test = require('node:test');
const assert = require('node:assert');

const MissionManager = require('../../services/MissionManager');
const PayoutManager = require('../../services/PayoutManager');
const { createIdentity, keyFromIdentity } = require('../../functions/identity');

function sign (identity, message) {
  return keyFromIdentity(identity).signSchnorr(Buffer.from(message)).toString('hex');
}

/** Fake bitcoind: enough of createmultisig/scantxoutset/createpsbt/sendrawtransaction. */
function fakeRpc (state = {}) {
  state.calls = [];
  state.utxos = state.utxos || [];
  const rpc = async (method, params) => {
    state.calls.push({ method, params });
    switch (method) {
      case 'createmultisig':
        return { address: `bcrt1q-fake-${params[0]}of${params[1].length}`, redeemScript: 'deadbeef' };
      case 'scantxoutset':
        return { unspents: state.utxos, total_amount: state.utxos.reduce((s, u) => s + u.amount, 0) };
      case 'createpsbt':
        return 'cHNidP8-fake-psbt';
      case 'sendrawtransaction':
        return 'f'.repeat(64);
      default:
        throw new Error(`unexpected rpc: ${method}`);
    }
  };
  rpc.state = state;
  return rpc;
}

test('mainnet escrow is refused without explicit override', () => {
  assert.throws(() => new PayoutManager({ network: 'mainnet', rpc: fakeRpc() }), /mainnet escrow is disabled/);
  assert.ok(new PayoutManager({ network: 'mainnet', allowMainnet: true, rpc: fakeRpc() }));
});

test('ledger mode records the obligation without an address', async () => {
  const creator = createIdentity();
  const pm = new PayoutManager({ network: 'regtest' }); // no rpc
  assert.strictEqual(pm.mode, 'ledger');
  const mm = new MissionManager({});
  const m = await mm.createMission({ title: 'IOU', createdBy: creator.pubkey, reward: 42000 });
  const escrow = await pm.createEscrow(m);
  assert.strictEqual(escrow.address, null);
  assert.strictEqual(escrow.amountSats, 42000);
  assert.strictEqual(escrow.status, 'unfunded');
  await assert.rejects(pm.buildPayout(escrow, 'bcrt1qsomewhere'), /ledger mode/);
});

test('full regtest flow: escrow -> fund -> accept -> PSBT -> broadcast', async () => {
  const creator = createIdentity();
  const cosigner = createIdentity();
  const pilot = createIdentity();

  const rpc = fakeRpc();
  const pm = new PayoutManager({ network: 'regtest', rpc, feeSats: 1000 });
  const mm = new MissionManager({});
  pm.attach(mm);

  // 1. Mission with 2-of-2 authorities and an escrow.
  const mission = await mm.createMission({
    title: 'Bounty: Kareah',
    createdBy: creator.pubkey,
    reward: 100000,
    authorities: { keys: [creator.pubkey, cosigner.pubkey], threshold: 2 }
  });
  mission.escrow = await pm.createEscrow(mission);
  mm.store.put('missions', mission.id, mission);
  assert.strictEqual(mission.escrow.status, 'unfunded');
  assert.match(mission.escrow.address, /^bcrt1q/);
  assert.deepStrictEqual(rpc.state.calls[0], { method: 'createmultisig', params: [2, [creator.pubkey, cosigner.pubkey].sort(), 'bech32'] });

  // 2. Payout before funding/acceptance fails.
  await assert.rejects(pm.buildPayout(mission.escrow, 'bcrt1qpilot'), /not payable/);

  // Funding lands on the escrow address.
  rpc.state.utxos = [{ txid: 'a'.repeat(64), vout: 0, amount: 0.001 }]; // 100k sats
  const funding = await pm.checkFunding(mission.escrow);
  assert.strictEqual(funding.funded, true);
  assert.strictEqual(mission.escrow.status, 'funded');

  // 3. Lifecycle to accepted claim (k-of-n Schnorr acceptance).
  const app = await mm.applyToMission({ missionId: mission.id, applicantId: pilot.pubkey });
  await mm.decideApplication({ applicationId: app.id, officerId: creator.pubkey, decision: 'accept' });
  const claim = await mm.submitClaim({ missionId: mission.id, claimantId: pilot.pubkey });
  const message = mm.acceptanceMessage(mm.getMission(mission.id), claim);
  await mm.validateClaim({
    claimId: claim.id,
    decision: 'approve',
    signatures: { [creator.pubkey]: sign(creator, message), [cosigner.pubkey]: sign(cosigner, message) }
  });

  const stored = mm.getMission(mission.id);
  assert.strictEqual(stored.status, 'completed');
  assert.strictEqual(stored.escrow.status, 'payable', 'acceptance flips escrow to payable');
  assert.strictEqual(stored.escrow.payee, pilot.pubkey);

  // 4. Build the payout PSBT (authorities sign it client-side).
  const built = await pm.buildPayout(stored.escrow, 'bcrt1qpilotaddress');
  assert.strictEqual(built.psbt, 'cHNidP8-fake-psbt');
  assert.strictEqual(built.payoutSats, 100000 - 1000);

  // 5. Broadcast the signed transaction.
  let paid = null;
  pm.on('payout:paid', (p) => { paid = p; });
  const result = await pm.broadcastPayout(stored.escrow, '02000000fake');
  assert.match(result.txid, /^f{64}$/);
  assert.strictEqual(stored.escrow.status, 'paid');
  assert.ok(paid);

  // Audit chain (with the embedded acceptance authorization) still verifies.
  assert.strictEqual(mm.verifyAudit(), true);
});

test('escrow requires authority pubkeys', async () => {
  const pm = new PayoutManager({ network: 'regtest', rpc: fakeRpc() });
  await assert.rejects(pm.createEscrow({ id: 'x', reward: 1, authorities: null }), /no authorities/);
  await assert.rejects(pm.createEscrow({ id: 'x', reward: 1, authorities: { keys: ['nope'], threshold: 1 } }), /not a compressed/);
});
