'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const http = require('http');
const StarCitizenService = require('../app/server');

let PORT;   // assigned after the server binds an ephemeral port (avoids clashes)
const BASE = '/services/star-citizen';

function call (method, path, bodyObj) {
  return new Promise((resolve, reject) => {
    const data = bodyObj ? JSON.stringify(bodyObj) : null;
    const r = http.request({ host: '127.0.0.1', port: PORT, method, path, headers: data ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } : {} }, (res) => {
      let b = ''; res.on('data', (c) => { b += c; }); res.on('end', () => resolve({ status: res.statusCode, json: b ? JSON.parse(b) : null }));
    });
    r.on('error', reject); if (data) r.write(data); r.end();
  });
}

test('mission register REST flow (create→apply→accept→claim→validate) with 403 guards', async () => {
  const s = new StarCitizenService({ port: 0, logfile: null, discord: { enable: false }, missions: { enable: true, officers: ['boss'] } });
  await s.start();
  PORT = s.server.address().port;
  try {
    // create requires an officer
    let r = await call('POST', `${BASE}/missions`, { title: 'Op', createdBy: 'rando' });
    assert.strictEqual(r.status, 403, 'non-officer create is forbidden');
    r = await call('POST', `${BASE}/missions`, { title: 'Escort Op', type: 'fleet-action', reward: 0, outOfGame: true, createdBy: 'boss' });
    assert.strictEqual(r.status, 200);
    const mid = r.json.data.id;
    assert.strictEqual(r.json.data.status, 'open');

    // member applies
    r = await call('POST', `${BASE}/missions/${mid}/apply`, { applicantId: 'PilotJane', message: 'in' });
    assert.strictEqual(r.status, 200);
    const appId = r.json.data.id;

    // officer list of applications
    r = await call('GET', `${BASE}/missions/${mid}/applications`);
    assert.strictEqual(r.json.data.length, 1);

    // non-officer cannot decide
    r = await call('POST', `${BASE}/applications/${appId}/decision`, { decision: 'accept', officerId: 'rando' });
    assert.strictEqual(r.status, 403);
    // officer accepts
    r = await call('POST', `${BASE}/applications/${appId}/decision`, { decision: 'accept', officerId: 'boss' });
    assert.strictEqual(r.status, 200);

    // wrong member cannot claim
    r = await call('POST', `${BASE}/missions/${mid}/claim`, { claimantId: 'SomeoneElse' });
    assert.strictEqual(r.status, 400);
    // assignee claims
    r = await call('POST', `${BASE}/missions/${mid}/claim`, { claimantId: 'PilotJane', note: 'done' });
    assert.strictEqual(r.status, 200);
    const claimId = r.json.data.id;

    // officer validates → completed
    r = await call('POST', `${BASE}/claims/${claimId}/validate`, { decision: 'approve', officerId: 'boss' });
    assert.strictEqual(r.status, 200);
    r = await call('GET', `${BASE}/missions/${mid}`);
    assert.strictEqual(r.json.data.status, 'completed');

    // audit endpoint reflects the chain
    r = await call('GET', `${BASE}/audit`);
    assert.ok(r.json.data.length >= 5, 'audit has the lifecycle entries');

    // unknown mission → 404
    r = await call('POST', `${BASE}/missions/nope/apply`, { applicantId: 'X' });
    assert.strictEqual(r.status, 404);
  } finally {
    await s.stop();
  }
});

test('monitor + deaths endpoints expose death + mission-lifecycle data', async () => {
  const s = new StarCitizenService({ port: 0, logfile: null, discord: { enable: false } });
  await s.start();
  PORT = s.server.address().port;
  try {
    s.handleLogChange('<2026-06-17T07:00:00.000Z> [Notice] <Legacy login response> [CIG-net] User Login Success - Handle[Kersa] - Time[1] [Login]');
    s.handleLogChange("<2026-06-17T07:49:59.187Z> [Notice] <Adding non kept item [CSCActorCorpseUtils::PopulateItemPortForItemRecoveryEntitlement]> Item 'body_01_noMagicPocket_200128671231 - Class(body_01_noMagicPocket)', Recorded data is: Port Name 'Body_ItemPort' [Team_CoreGameplayFeatures][Unknown]");
    s.handleLogChange('<2026-06-17T07:10:00.019Z> [Notice] <CSCPlayerMissionLog::MissionStartCommsNotification> MissionStart comms notification will not be sent - This mission has no MissionStart comms setup. ContractId: [c095ce31-4305-445f-806c-06d1b9001686]. MissionId: aaaa1111-d438-4996-9755-1c3fc9532e85 [Team_MissionFeatures][Missions][Comms]');
    s.handleLogChange('<2026-06-17T07:30:40.457Z> [Notice] <EndMission> Ending mission for player. MissionId[aaaa1111-d438-4996-9755-1c3fc9532e85] Player[Kersa] PlayerId[204821711285] CompletionType[Complete] Reason[Mission Ended] [Team_MissionFeatures][Missions]');

    let r = await call('GET', `${BASE}/deaths`);
    assert.strictEqual(r.status, 200);
    assert.strictEqual(r.json.data.length, 1);
    assert.strictEqual(r.json.data[0].player, 'Kersa');

    r = await call('GET', `${BASE}/monitor`);
    assert.strictEqual(r.json.counts.deaths, 1);
    assert.deepStrictEqual(r.json.missionStats, { accepted: 1, completed: 1, abandoned: 0, failed: 0, deactivated: 0, active: 0 });
    assert.strictEqual(r.json.missions[0].outcome, 'Complete');

    // deaths is read-only (no POST)
    r = await call('POST', `${BASE}/deaths`, { foo: 1 });
    assert.notStrictEqual(r.status, 200);
  } finally {
    await s.stop();
  }
});

test('analytics endpoint aggregates missions, deaths and a heatmap for the Analyze tab', async () => {
  const s = new StarCitizenService({ port: 0, logfile: null, discord: { enable: false } });
  await s.start();
  PORT = s.server.address().port;
  try {
    const iso = (minsAgo) => new Date(Date.now() - minsAgo * 60000).toISOString();
    s.handleLogChange(`<${iso(60)}> [Notice] <Legacy login response> [CIG-net] User Login Success - Handle[Kersa] - Time[1] [Login]`);
    s.handleLogChange(`<${iso(50)}> [Notice] <CSCPlayerMissionLog::MissionStartCommsNotification> MissionStart comms notification will not be sent - This mission has no MissionStart comms setup. ContractId: [c095ce31-4305-445f-806c-06d1b9001686]. MissionId: aaaa1111-d438-4996-9755-1c3fc9532e85 [Team_MissionFeatures][Missions][Comms]`);
    s.handleLogChange(`<${iso(40)}> [Notice] <EndMission> Ending mission for player. MissionId[aaaa1111-d438-4996-9755-1c3fc9532e85] Player[Kersa] PlayerId[204821711285] CompletionType[Complete] Reason[Mission Ended] [Team_MissionFeatures][Missions]`);
    s.handleLogChange(`<${iso(30)}> [Notice] <Adding non kept item [CSCActorCorpseUtils::PopulateItemPortForItemRecoveryEntitlement]> Item 'body_01_noMagicPocket_1 - Class(body_01_noMagicPocket)', Recorded data is: Port Name 'Body_ItemPort' [Team_CoreGameplayFeatures][Unknown]`);

    const r = await call('GET', `${BASE}/analytics`);
    assert.strictEqual(r.status, 200);
    assert.ok(Array.isArray(r.json.availableMonths) && r.json.availableMonths.length >= 1, 'months listed');
    const mine = r.json.missions.filter((m) => m.player === 'Kersa');
    assert.ok(mine.length >= 1, 'my mission present');
    assert.ok(mine.some((m) => m.outcome === 'Complete'), 'my completed mission present');
    assert.ok(mine.every((m) => typeof m.ts === 'string'), 'missions carry a timestamp');
    assert.ok(r.json.deaths.some((d) => d.player === 'Kersa'), 'my death present');
    assert.ok(Array.isArray(r.json.heatcells) && r.json.heatcells.length >= 1, 'heatcells present');
    assert.ok(r.json.heatcells[0].d >= 0 && r.json.heatcells[0].h >= 0 && r.json.heatcells[0].n >= 1, 'heatcell shape');
    assert.ok(r.json.players.includes('Kersa'));
  } finally {
    await s.stop();
  }
});
