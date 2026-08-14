'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const LiveRelay = require('../../services/LiveRelay');
const { createIdentity } = require('../../functions/identity');

function tmpDir (prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

test('LiveRelay ingest MissionClaim requires the claimant signature', async () => {
  const alice = createIdentity();
  const eve = createIdentity();
  const dir = tmpDir('sc-claim-');
  const svc = new LiveRelay({
    port: 0,
    settingsDir: dir,
    peers: [],
    fabric: { enable: false },
    missions: { enable: true }
  });
  await svc.start();
  try {
    const mission = await svc.missionManager.createMission({
      title: 'Escort',
      createdBy: alice.pubkey
    });
    const claim = {
      id: 'claim-1',
      missionId: mission.id,
      claimantId: alice.pubkey,
      note: 'cargo in',
      claimedAt: new Date().toISOString()
    };

    const skip = svc._ingestMissionClaim(eve.pubkey, { claim, mission });
    assert.strictEqual(skip.skipped, 'signer-mismatch');
    assert.ok(!svc.missionManager.store.get('claims', claim.id));

    const ok = svc._ingestMissionClaim(alice.pubkey, { claim, mission });
    assert.strictEqual(ok.created, true);
    assert.strictEqual(svc.missionManager.store.get('claims', claim.id).note, 'cargo in');
  } finally {
    await svc.stop();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('LiveRelay ingest MissionClaimDecision rejects spoofed officers', async () => {
  const alice = createIdentity();
  const eve = createIdentity();
  const dir = tmpDir('sc-claim-dec-');
  const svc = new LiveRelay({
    port: 0,
    settingsDir: dir,
    peers: [],
    fabric: { enable: false },
    missions: { enable: true }
  });
  await svc.start();
  try {
    const mission = await svc.missionManager.createMission({
      title: 'Escort',
      createdBy: alice.pubkey
    });
    const claim = await svc.missionManager.submitClaim({
      missionId: mission.id,
      claimantId: alice.pubkey,
      note: 'done'
    });

    const spoof = svc._ingestMissionClaimDecision(eve.pubkey, {
      validation: {
        claimId: claim.id,
        missionId: mission.id,
        officerId: eve.pubkey,
        decision: 'reject',
        note: 'nope'
      }
    });
    assert.strictEqual(spoof.skipped, 'not-authority');
    assert.strictEqual(svc.missionManager.store.get('claims', claim.id).status, 'pending');

    const mismatch = svc._ingestMissionClaimDecision(eve.pubkey, {
      validation: {
        claimId: claim.id,
        missionId: mission.id,
        officerId: alice.pubkey,
        decision: 'reject'
      }
    });
    assert.strictEqual(mismatch.skipped, 'signer-mismatch');

    const nested = svc._ingestMissionClaimDecision(eve.pubkey, {
      claim: {
        id: 'forged-claim',
        missionId: mission.id,
        claimantId: alice.pubkey,
        note: 'forged'
      },
      validation: {
        claimId: 'forged-claim',
        missionId: mission.id,
        officerId: eve.pubkey,
        decision: 'reject'
      }
    });
    assert.ok(!svc.missionManager.store.get('claims', 'forged-claim'));
    assert.ok(nested.skipped);

    const rejected = svc._ingestMissionClaimDecision(alice.pubkey, {
      validation: {
        claimId: claim.id,
        missionId: mission.id,
        officerId: alice.pubkey,
        decision: 'reject',
        note: 'try again'
      }
    });
    assert.strictEqual(rejected.created, true);
    assert.strictEqual(svc.missionManager.store.get('claims', claim.id).status, 'rejected');
  } finally {
    await svc.stop();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
