'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert');
const {
  snapshotFromGameLog,
  snapshotFromHistoryRow,
  statusForGameLog,
  titleForGameLog,
  isTrackableMissionId
} = require('../../functions/gameLogMissionRegister');
const MissionManager = require('../../services/MissionManager');

describe('gameLogMissionRegister', () => {
  it('maps Complete / Abandon outcomes to register status', () => {
    assert.strictEqual(statusForGameLog({ outcome: 'Complete' }), 'completed');
    assert.strictEqual(statusForGameLog({ outcome: 'Abandon' }), 'cancelled');
    assert.strictEqual(statusForGameLog({ started: true }), 'in_progress');
  });

  it('builds titles from generator and notification text', () => {
    assert.match(titleForGameLog({ generator: 'FoxwellEnforcement_Generator' }), /Foxwell/);
    assert.strictEqual(
      titleForGameLog({ text: 'Eliminate the marked target' }),
      'Eliminate the marked target'
    );
  });

  it('skips the zero mission id', () => {
    assert.strictEqual(isTrackableMissionId('00000000-0000-0000-0000-000000000000'), false);
    const snap = snapshotFromGameLog({
      missionId: '00000000-0000-0000-0000-000000000000',
      generator: 'X'
    });
    assert.strictEqual(snap, null);
  });

  it('snapshots history rows with gamelog: fallback ids', () => {
    const snap = snapshotFromHistoryRow({
      id: 'abc123',
      missionId: null,
      type: 'Bounty',
      faction: 'Vaughn',
      outcome: 'Complete',
      player: 'Neorion',
      ts: '2026-01-01T00:00:00Z'
    });
    assert.ok(snap);
    assert.strictEqual(snap.id, 'gamelog:abc123');
    assert.strictEqual(snap.source, 'gamelog');
    assert.strictEqual(snap.status, 'completed');
  });
});

describe('MissionManager.upsertFromGameLog', () => {
  it('collects start then end into one register row', () => {
    const mm = new MissionManager();
    const id = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
    const a = mm.upsertFromGameLog(snapshotFromGameLog({
      missionId: id,
      generator: 'Vaughn_BountyHunter',
      startedAt: '2026-01-01T10:00:00Z',
      player: 'Neorion'
    }));
    assert.strictEqual(a.created, true);
    assert.strictEqual(a.mission.status, 'in_progress');
    assert.strictEqual(a.mission.source, 'gamelog');
    assert.strictEqual(a.mission.reward, 0);

    const b = mm.upsertFromGameLog(snapshotFromGameLog({
      missionId: id,
      generator: 'Vaughn_BountyHunter',
      outcome: 'Complete',
      startedAt: '2026-01-01T10:00:00Z',
      endedAt: '2026-01-01T10:30:00Z',
      player: 'Neorion',
      text: 'Bounty cleared'
    }));
    assert.strictEqual(b.created, false);
    assert.strictEqual(b.mission.status, 'completed');
    assert.strictEqual(b.mission.outcome, 'Complete');
    assert.ok(b.mission.title.includes('Bounty') || b.mission.title === 'Bounty cleared');
    assert.strictEqual(mm.missions.filter((m) => m.source === 'gamelog').length, 1);
  });

  it('does not clobber a posted mission with the same id', async () => {
    const mm = new MissionManager();
    const posted = await mm.createMission({
      id: 'posted-1',
      title: 'Officer post',
      createdBy: 'officer',
      reward: 1000
    });
    assert.strictEqual(posted.source, undefined);
    const r = mm.upsertFromGameLog({
      id: 'posted-1',
      title: 'From log',
      status: 'completed',
      source: 'gamelog',
      scMissionId: 'sc-uuid-other'
    });
    assert.strictEqual(mm.getMission('posted-1').title, 'Officer post');
    assert.strictEqual(mm.getMission('posted-1').reward, 1000);
    assert.ok(mm.getMission('posted-1').source !== 'gamelog');
    // May attach scMissionId linkage without becoming a log row.
    assert.strictEqual(r.created, false);
    assert.notStrictEqual(mm.getMission('posted-1').status, 'completed');
  });
});
