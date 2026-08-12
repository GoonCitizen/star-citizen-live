'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const MissionManager = require('../../services/MissionManager');
const PayoutManager = require('../../services/PayoutManager');

function fresh () { return new MissionManager(); }

test('full lifecycle: create -> apply -> accept -> claim -> validate -> completed', async () => {
  const mm = fresh();
  const m = await mm.createMission({ title: 'Defend the convoy', type: 'fleet-action', reward: 5000, createdBy: 'officer1' });
  assert.strictEqual(m.status, 'open');

  const app = await mm.applyToMission({ missionId: m.id, applicantId: 'memberA', message: 'on it' });
  assert.strictEqual(app.status, 'pending');

  await mm.decideApplication({ applicationId: app.id, officerId: 'officer1', decision: 'accept' });
  assert.strictEqual(mm.getMission(m.id).status, 'assigned');
  assert.ok(mm.getMission(m.id).participantIds.includes('memberA'));
  assert.strictEqual(mm.getMission(m.id).assigneeId, 'memberA');

  const claim = await mm.submitClaim({ missionId: m.id, claimantId: 'memberA', note: 'done', evidence: [{ kind: 'session', refId: 's1' }] });
  assert.strictEqual(claim.status, 'pending');

  const v = await mm.validateClaim({ claimId: claim.id, officerId: 'officer1', decision: 'approve' });
  assert.strictEqual(v.decision, 'approve');
  assert.strictEqual(mm.getMission(m.id).status, 'completed');
  assert.strictEqual(mm.validations.length, 1);
  assert.ok(mm.verifyAudit(), 'audit chain intact');
});

test('many participants can join; only one claim is paid', async () => {
  const mm = fresh();
  const m = await mm.createMission({ title: 'Bounty', createdBy: 'o' });
  await mm.joinMission({ missionId: m.id, applicantId: 'A' });
  await mm.joinMission({ missionId: m.id, applicantId: 'B' });
  const mission = mm.getMission(m.id);
  assert.deepStrictEqual(mission.participantIds.sort(), ['A', 'B']);
  assert.strictEqual(mission.status, 'assigned');

  const c1 = await mm.submitClaim({ missionId: m.id, claimantId: 'A', note: 'first' });
  const c2 = await mm.submitClaim({
    missionId: m.id,
    claimantId: 'B',
    completionGroupId: 'fleet-1'
  });
  assert.strictEqual(c2.completionGroupId, 'fleet-1');

  await mm.validateClaim({ claimId: c1.id, officerId: 'o', decision: 'approve' });
  assert.strictEqual(mm.getMission(m.id).status, 'completed');
  assert.strictEqual(mm.store.get('claims', c1.id).status, 'validated');
  assert.strictEqual(mm.store.get('claims', c2.id).status, 'superseded');
});

test('broadcast-style joinMission is idempotent', async () => {
  const mm = fresh();
  const m = await mm.createMission({ title: 'Join me', createdBy: 'o' });
  const a1 = await mm.joinMission({ missionId: m.id, applicantId: 'pilot', message: 'via broadcast' });
  const a2 = await mm.joinMission({ missionId: m.id, applicantId: 'pilot', message: 'again' });
  assert.strictEqual(a1.id, a2.id);
  assert.strictEqual(a2.status, 'accepted');
  assert.strictEqual(mm.getMission(m.id).participantIds.length, 1);
});

test('completionGroupId requires membership when isGroupMember is set', async () => {
  const mm = new MissionManager({
    isGroupMember: (groupId, pubkey) => groupId === 'g1' && pubkey === 'A'
  });
  const m = await mm.createMission({ title: 'G', createdBy: 'o' });
  await mm.joinMission({ missionId: m.id, applicantId: 'A' });
  await assert.rejects(
    () => mm.submitClaim({ missionId: m.id, claimantId: 'A', completionGroupId: 'g2' }),
    /not a member/
  );
  const ok = await mm.submitClaim({ missionId: m.id, claimantId: 'A', completionGroupId: 'g1' });
  assert.strictEqual(ok.completionGroupId, 'g1');
});

test('acceptanceMessage includes completionGroupId', () => {
  const mm = fresh();
  const msg = JSON.parse(mm.acceptanceMessage(
    { id: 'm1' },
    { id: 'c1', claimantId: 'p1', completionGroupId: 'g1' }
  ));
  assert.strictEqual(msg.completionGroupId, 'g1');
  assert.strictEqual(msg.action, 'mission.accept');
});

test('rejecting a claim leaves the mission assigned for a re-claim', async () => {
  const mm = fresh();
  const m = await mm.createMission({ title: 'Bounty', createdBy: 'o' });
  const app = await mm.applyToMission({ missionId: m.id, applicantId: 'A' });
  await mm.decideApplication({ applicationId: app.id, officerId: 'o', decision: 'accept' });
  const claim = await mm.submitClaim({ missionId: m.id, claimantId: 'A' });
  await mm.validateClaim({ claimId: claim.id, officerId: 'o', decision: 'reject', note: 'no proof' });
  assert.strictEqual(mm.getMission(m.id).status, 'assigned');
  const claim2 = await mm.submitClaim({ missionId: m.id, claimantId: 'A' });
  assert.strictEqual(claim2.status, 'pending');
});

test('rejects bad transitions', async () => {
  const mm = fresh();
  const m = await mm.createMission({ title: 'X', createdBy: 'o' });
  await assert.rejects(() => mm.submitClaim({ missionId: m.id, claimantId: 'A' }), /participant|not assigned/i);
  const app = await mm.applyToMission({ missionId: m.id, applicantId: 'A' });
  await mm.decideApplication({ applicationId: app.id, officerId: 'o', decision: 'accept' });
  // Second applicant can still apply while assigned
  const appB = await mm.applyToMission({ missionId: m.id, applicantId: 'B' });
  assert.strictEqual(appB.status, 'pending');
  await assert.rejects(() => mm.submitClaim({ missionId: m.id, claimantId: 'B' }), /participant/);
  const claim = await mm.submitClaim({ missionId: m.id, claimantId: 'A' });
  await mm.validateClaim({ claimId: claim.id, officerId: 'o', decision: 'approve' });
  await assert.rejects(() => mm.validateClaim({ claimId: claim.id, officerId: 'o', decision: 'approve' }), /already/);
});

test('officer allowlist is enforced when set', async () => {
  const mm = new MissionManager({ officers: ['boss'] });
  await assert.rejects(() => mm.createMission({ title: 'X', createdBy: 'rando' }), /not an officer/);
  const m = await mm.createMission({ title: 'X', createdBy: 'boss' });
  const app = await mm.applyToMission({ missionId: m.id, applicantId: 'A' });
  await assert.rejects(() => mm.decideApplication({ applicationId: app.id, officerId: 'rando', decision: 'accept' }), /not an officer/);
  assert.ok(await mm.decideApplication({ applicationId: app.id, officerId: 'boss', decision: 'accept' }));
});

test('requireOfficers denies all officers when allowlist is empty', async () => {
  const mm = new MissionManager({ requireOfficers: true, officers: [] });
  assert.strictEqual(mm.isOfficer('anyone'), false);
  await assert.rejects(() => mm.createMission({ title: 'X', createdBy: 'anyone' }), /not an officer/);
});

test('bootstrap (empty officers, requireOfficers false) still allows create', async () => {
  const mm = new MissionManager({ officers: [] });
  assert.strictEqual(mm.isOfficer('anyone'), true);
  const m = await mm.createMission({ title: 'Bootstrap', createdBy: 'anyone' });
  assert.strictEqual(m.status, 'open');
});

test('audit chain detects tampering', async () => {
  const mm = fresh();
  await mm.createMission({ title: 'A', createdBy: 'o' });
  await mm.createMission({ title: 'B', createdBy: 'o' });
  assert.ok(mm.verifyAudit());
  const entry = mm.audit[0];
  mm.store.get('audit', entry.id).summary = 'HACKED';
  assert.strictEqual(mm.verifyAudit(), false);
});

test('PayoutManager sets group payeeAddress on unlock', async () => {
  const mm = fresh();
  const pm = new PayoutManager({ ledger: true, network: 'regtest' });
  pm.attach(mm, {
    resolveGroupWallet: (groupId) => ({ address: `bcrt1q-group-${groupId}`, groupId })
  });
  const m = await mm.createMission({
    title: 'Paid',
    createdBy: 'o',
    reward: 1000,
    escrow: {
      status: 'funded',
      amountSats: 1000,
      address: 'bcrt1qescrow',
      keys: ['02' + 'ab'.repeat(32)],
      threshold: 1,
      network: 'regtest',
      mode: 'ledger'
    }
  });
  // Force escrow onto mission (createMission may not accept escrow the same way)
  const mission = mm.getMission(m.id);
  mission.escrow = {
    status: 'funded',
    amountSats: 1000,
    address: 'bcrt1qescrow',
    keys: ['02' + 'ab'.repeat(32)],
    threshold: 1,
    network: 'regtest',
    mode: 'ledger'
  };
  mm.store.put('missions', mission.id, mission);
  await mm.joinMission({ missionId: mission.id, applicantId: 'A' });
  const claim = await mm.submitClaim({
    missionId: mission.id,
    claimantId: 'A',
    completionGroupId: 'fleet'
  });
  await mm.validateClaim({ claimId: claim.id, officerId: 'o', decision: 'approve' });
  const esc = mm.getMission(mission.id).escrow;
  assert.strictEqual(esc.status, 'payable');
  assert.strictEqual(esc.payeeKind, 'group');
  assert.strictEqual(esc.payee, 'fleet');
  assert.strictEqual(esc.payeeAddress, 'bcrt1q-group-fleet');
});
