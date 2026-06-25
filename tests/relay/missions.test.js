'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const MissionManager = require('../services/MissionManager');

function freshOfficerless () { return new MissionManager(); }                 // bootstrap (permissive)

test('full lifecycle: create -> apply -> accept -> claim -> validate -> completed', async () => {
  const mm = freshOfficerless();
  const m = await mm.createMission({ title: 'Defend the convoy', type: 'fleet-action', reward: 5000, createdBy: 'officer1' });
  assert.strictEqual(m.status, 'open');

  const app = await mm.applyToMission({ missionId: m.id, applicantId: 'memberA', message: 'on it' });
  assert.strictEqual(app.status, 'pending');

  await mm.decideApplication({ applicationId: app.id, officerId: 'officer1', decision: 'accept' });
  assert.strictEqual(mm.getMission(m.id).status, 'assigned');
  assert.strictEqual(mm.getMission(m.id).assigneeId, 'memberA');

  const claim = await mm.submitClaim({ missionId: m.id, claimantId: 'memberA', note: 'done', evidence: [{ kind: 'session', refId: 's1' }] });
  assert.strictEqual(claim.status, 'pending');

  const v = await mm.validateClaim({ claimId: claim.id, officerId: 'officer1', decision: 'approve' });
  assert.strictEqual(v.decision, 'approve');
  assert.strictEqual(mm.getMission(m.id).status, 'completed');
  assert.strictEqual(mm.validations.length, 1);
  assert.ok(mm.verifyAudit(), 'audit chain intact');
});

test('rejecting a claim leaves the mission assigned for a re-claim', async () => {
  const mm = freshOfficerless();
  const m = await mm.createMission({ title: 'Bounty', createdBy: 'o' });
  const app = await mm.applyToMission({ missionId: m.id, applicantId: 'A' });
  await mm.decideApplication({ applicationId: app.id, officerId: 'o', decision: 'accept' });
  const claim = await mm.submitClaim({ missionId: m.id, claimantId: 'A' });
  await mm.validateClaim({ claimId: claim.id, officerId: 'o', decision: 'reject', note: 'no proof' });
  assert.strictEqual(mm.getMission(m.id).status, 'assigned');
  // assignee can submit a fresh claim
  const claim2 = await mm.submitClaim({ missionId: m.id, claimantId: 'A' });
  assert.strictEqual(claim2.status, 'pending');
});

test('rejects bad transitions', async () => {
  const mm = freshOfficerless();
  const m = await mm.createMission({ title: 'X', createdBy: 'o' });
  // claim before assignment
  await assert.rejects(() => mm.submitClaim({ missionId: m.id, claimantId: 'A' }), /not assigned/);
  const app = await mm.applyToMission({ missionId: m.id, applicantId: 'A' });
  await mm.decideApplication({ applicationId: app.id, officerId: 'o', decision: 'accept' });
  // applying to an assigned mission
  await assert.rejects(() => mm.applyToMission({ missionId: m.id, applicantId: 'B' }), /not open/);
  // non-assignee claiming
  await assert.rejects(() => mm.submitClaim({ missionId: m.id, claimantId: 'B' }), /only the assignee/);
  // double-validate
  const claim = await mm.submitClaim({ missionId: m.id, claimantId: 'A' });
  await mm.validateClaim({ claimId: claim.id, officerId: 'o', decision: 'approve' });
  await assert.rejects(() => mm.validateClaim({ claimId: claim.id, officerId: 'o', decision: 'approve' }), /already/);
});

test('officer allowlist is enforced when set', async () => {
  const mm = new MissionManager({ officers: ['boss'] });
  await assert.rejects(() => mm.createMission({ title: 'X', createdBy: 'rando' }), /not an officer/);
  const m = await mm.createMission({ title: 'X', createdBy: 'boss' });
  const app = await mm.applyToMission({ missionId: m.id, applicantId: 'A' });   // members need no role
  await assert.rejects(() => mm.decideApplication({ applicationId: app.id, officerId: 'rando', decision: 'accept' }), /not an officer/);
  assert.ok(await mm.decideApplication({ applicationId: app.id, officerId: 'boss', decision: 'accept' }));
});

test('audit chain detects tampering', async () => {
  const mm = freshOfficerless();
  await mm.createMission({ title: 'A', createdBy: 'o' });
  await mm.createMission({ title: 'B', createdBy: 'o' });
  assert.ok(mm.verifyAudit());
  // tamper with a stored audit entry's summary
  const entry = mm.audit[0];
  mm.store.get('audit', entry.id).summary = 'HACKED';
  assert.strictEqual(mm.verifyAudit(), false);
});
