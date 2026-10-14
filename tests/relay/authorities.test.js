'use strict';

const test = require('node:test');
const assert = require('node:assert');

const MissionManager = require('../../services/MissionManager');
const { createIdentity, keyFromIdentity } = require('../../functions/identity');

function sign (identity, message) {
  return keyFromIdentity(identity).signSchnorr(Buffer.from(message)).toString('hex');
}

test('mission defaults authorities to the pubkey creator (1-of-1)', async () => {
  const creator = createIdentity();
  const mm = new MissionManager({});
  const m = await mm.createMission({ title: 'Salvage run', createdBy: creator.pubkey });
  assert.deepStrictEqual(m.authorities, { keys: [creator.pubkey], threshold: 1 });

  const legacy = await mm.createMission({ title: 'Old style', createdBy: 'DiscordName' });
  assert.strictEqual(legacy.authorities, null, 'string actors get no authority set');
});

test('acceptance requires k-of-n authority signatures and unlocks payout event', async () => {
  const creator = createIdentity();
  const auth2 = createIdentity();
  const auth3 = createIdentity();
  const pilot = createIdentity();
  const mm = new MissionManager({});

  const mission = await mm.createMission({
    title: 'Escort',
    createdBy: creator.pubkey,
    authorities: { keys: [creator.pubkey, auth2.pubkey, auth3.pubkey], threshold: 2 },
    escrow: { network: 'regtest', amountSats: 100000 }
  });
  assert.strictEqual(mission.authorities.threshold, 2);

  const app = await mm.applyToMission({ missionId: mission.id, applicantId: pilot.pubkey });
  await mm.decideApplication({ applicationId: app.id, officerId: creator.pubkey, decision: 'accept' });
  const claim = await mm.submitClaim({ missionId: mission.id, claimantId: pilot.pubkey });

  const message = mm.acceptanceMessage(mm.getMission(mission.id), claim);

  // 1 signature < threshold: rejected with FORBIDDEN.
  await assert.rejects(
    mm.validateClaim({ claimId: claim.id, decision: 'approve', signatures: { [creator.pubkey]: sign(creator, message) } }),
    (e) => e.code === 'FORBIDDEN'
  );

  // Non-authority signatures don't count.
  const outsider = createIdentity();
  await assert.rejects(
    mm.validateClaim({ claimId: claim.id, decision: 'approve', signatures: { [creator.pubkey]: sign(creator, message), [outsider.pubkey]: sign(outsider, message) } }),
    (e) => e.code === 'FORBIDDEN'
  );

  // 2-of-3 passes; payout:unlocked fires because the mission carries escrow.
  let payout = null;
  mm.on('payout:unlocked', (p) => { payout = p; });
  const validation = await mm.validateClaim({
    claimId: claim.id,
    decision: 'approve',
    officerId: creator.pubkey,
    signatures: { [creator.pubkey]: sign(creator, message), [auth2.pubkey]: sign(auth2, message) }
  });
  assert.ok(validation.authorization, 'validation records the signed authorization');
  assert.strictEqual(mm.getMission(mission.id).status, 'completed');
  assert.ok(payout, 'payout:unlocked emitted');
  assert.strictEqual(payout.mission.id, mission.id);

  // Audit chain verifies, including the embedded authorization signatures.
  assert.strictEqual(mm.verifyAudit(), true);

  // Tampering with the recorded authorization breaks verification.
  const entries = mm.audit;
  const signed = entries.find((e) => e.authorization);
  assert.ok(signed, 'an audit entry carries the authorization');
  const keys = Object.keys(signed.authorization.signatures);
  signed.authorization.signatures[keys[0]] = '00'.repeat(64);
  mm.store.put('audit', signed.id, signed);
  assert.strictEqual(mm.verifyAudit(), false, 'tampered authorization fails verifyAudit');
});

test('group authority can reject without being on the officer allowlist', async () => {
  const creator = createIdentity();
  const authority = createIdentity();
  const mm = new MissionManager({ officers: [creator.pubkey] });
  const m = await mm.createMission({
    title: 'Escort',
    createdBy: creator.pubkey,
    authorities: { keys: [creator.pubkey, authority.pubkey], threshold: 1 }
  });
  await mm.joinMission({ missionId: m.id, applicantId: 'pilot-9' });
  const claim = await mm.submitClaim({ missionId: m.id, claimantId: 'pilot-9' });
  await mm.validateClaim({
    claimId: claim.id,
    officerId: authority.pubkey,
    decision: 'reject',
    note: 'no proof'
  });
  assert.strictEqual(mm.store.get('claims', claim.id).status, 'rejected');
});

test('missions without authorities keep the officer-allowlist path', async () => {
  const mm = new MissionManager({ officers: ['officer-1'] });
  const m = await mm.createMission({ title: 'Plain', createdBy: 'officer-1' });
  const app = await mm.applyToMission({ missionId: m.id, applicantId: 'pilot-9' });
  await mm.decideApplication({ applicationId: app.id, officerId: 'officer-1', decision: 'accept' });
  const claim = await mm.submitClaim({ missionId: m.id, claimantId: 'pilot-9' });

  await assert.rejects(
    mm.validateClaim({ claimId: claim.id, officerId: 'random', decision: 'approve' }),
    (e) => e.code === 'FORBIDDEN'
  );
  await mm.validateClaim({ claimId: claim.id, officerId: 'officer-1', decision: 'approve' });
  assert.strictEqual(mm.getMission(m.id).status, 'completed');
  assert.strictEqual(mm.verifyAudit(), true);
});
