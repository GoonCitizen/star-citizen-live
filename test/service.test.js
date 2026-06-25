'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const StarCitizenService = require('../app/server');

test('service constructs with mission stub and starts STOPPED', () => {
  const s = new StarCitizenService({ discord: { enable: false } });
  assert.strictEqual(s.status, 'STOPPED');
  assert.ok(s.missionManager, 'mission manager present');
});

test('handleLogChange routes a kill into the kills collection and emits', () => {
  const s = new StarCitizenService({ discord: { enable: false } });
  let emitted = null;
  s.on('kill', (k) => { emitted = k; });
  s.handleLogChange("<2026-06-09T07:00:00.000Z> [Notice] <Actor Death> CActor::Kill: 'V' [1] in zone 'Z' killed by 'K' [2] using 'W' [Class WC] with damage type 'Energy' from direction x: 0, y: 0, z: 0");
  assert.strictEqual(s.kills.length, 1);
  assert.strictEqual(emitted.killer, 'K');
});

test('replays a sample combat log: detects kills, classifies kill vs death + NPC', async () => {
  const path = require('node:path');
  const s = new StarCitizenService({ discord: { enable: false } });
  await s.replayLog(path.join(__dirname, 'fixtures', 'sample-combat.log'));
  assert.strictEqual(s.kills.length, 3, 'three kill lines parsed');
  assert.deepStrictEqual(s.kills.map((k) => k.involves).sort(), ['death', 'kill', 'kill']);
  const death = s.kills.find((k) => k.involves === 'death');
  assert.strictEqual(death.victim, 'TestPilot');           // the running player died
  const pve = s.kills.find((k) => k.involves === 'kill' && k.damageType === 'Bullet');
  assert.strictEqual(pve.killer, 'TestPilot');
  assert.strictEqual(pve.victimNpc, true);                 // PU_Human… is an NPC
});

test('handleLogChange routes a login into the players collection', () => {
  const s = new StarCitizenService({ discord: { enable: false } });
  s.handleLogChange("<2026-06-09T06:23:07.643Z> [Notice] <Legacy login response> [CIG-net] User Login Success - Handle[Kersa] - Time[1]");
  assert.strictEqual(s.players.length, 1);
  assert.strictEqual(s.players[0].name, 'Kersa');
});

test('players dedupe by handle; logins count every event', () => {
  const s = new StarCitizenService({ discord: { enable: false } });
  let joins = 0;
  s.on('player:join', () => { joins++; });
  const login = (t) => s.handleLogChange(`<${t}> [Notice] <Legacy login response> [CIG-net] User Login Success - Handle[Kersa] - Time[1] [Login]`);
  login('2026-06-13T06:43:45.000Z');
  login('2026-06-13T07:05:00.000Z');   // same handle, second login
  assert.strictEqual(s.players.length, 1, 'one distinct player');
  assert.strictEqual(s.players[0].logins, 2, 'two logins recorded');
  assert.strictEqual(s.logins.length, 2, 'two login events');
  assert.strictEqual(joins, 1, 'player:join fires once per distinct handle');

  // a different handle is a new distinct player
  s.handleLogChange('<2026-06-13T07:10:00.000Z> [Notice] <Legacy login response> [CIG-net] User Login Success - Handle[Raven] - Time[1] [Login]');
  assert.strictEqual(s.players.length, 2);
  assert.strictEqual(joins, 2);
});

test('handleLogChange routes a mission objective into missionlog and emits', () => {
  const s = new StarCitizenService({ discord: { enable: false } });
  let emitted = null;
  s.on('mission:objective', (m) => { emitted = m; });
  s.handleLogChange("<2026-06-12T20:20:11.249Z> [Notice] <CMissionLogEntry::UpdateActiveObjective> Objective updated id=3340e494-888d-96be-0192-0c08d4841aa3, flags=ShowInLog|, hidden=0, uiDisplay[Priority=1][Text=Defeat Hostile Ship] [Team_MissionFeatures][Missions]");
  assert.strictEqual(s.missionlog.length, 1);
  assert.strictEqual(emitted.text, 'Defeat Hostile Ship');
});

test('mission events group by MissionId with objectives joined via ObjectiveId', () => {
  const s = new StarCitizenService({ discord: { enable: false } });
  // a mission notification introduces objective O under mission M
  s.handleLogChange('<2026-06-13T07:20:00.000Z> [Notice] <SHUDEvent_OnNotification> Added notification "New Objective: Defeat Hostile Ships: " [25] to queue. New queue size: 1, MissionId: [4491dc34-bcf3-4f56-a0b8-228e3e3f40e9], ObjectiveId: [3340e494-888d-96be-0192-0c08d4841aa3] [Team_CoreGameplayFeatures][Missions][Comms]');
  // an objective update for the same ObjectiveId carries the latest text
  s.handleLogChange('<2026-06-13T07:20:05.000Z> [Notice] <CMissionLogEntry::UpdateActiveObjective> Objective updated id=3340e494-888d-96be-0192-0c08d4841aa3, flags=ShowInLog|, uiDisplay[Priority=1][Text=Defeat Hostile Ship] [Team_MissionFeatures][Missions]');

  assert.strictEqual(s.missionGroups.length, 1, 'one grouped mission');
  const m = s.missionGroups[0];
  assert.strictEqual(m.id, '4491dc34-bcf3-4f56-a0b8-228e3e3f40e9');
  assert.strictEqual(m.objectives.length, 1, 'objective joined into the mission');
  assert.strictEqual(m.objectives[0].text, 'Defeat Hostile Ship', 'latest objective text wins');
});

test('mission marker attaches generator + type to the grouped mission', () => {
  const s = new StarCitizenService({ discord: { enable: false } });
  // notification creates the group; marker (same MissionId) attaches the generator
  s.handleLogChange('<2026-06-13T07:20:00.000Z> [Notice] <SHUDEvent_OnNotification> Added notification "New Objective: Defeat Hostile Ships: " [25] to queue. New queue size: 1, MissionId: [4491dc34-bcf3-4f56-a0b8-228e3e3f40e9], ObjectiveId: [3340e494-888d-96be-0192-0c08d4841aa3] [Team_CoreGameplayFeatures][Missions][Comms]');
  s.handleLogChange('<2026-06-13T07:20:01.000Z> [Notice] <CLocalMissionPhaseMarker::CreateMarker> Creating objective marker: missionId [4491dc34-bcf3-4f56-a0b8-228e3e3f40e9], generator name [BountyHuntersGuild_KIllShip] [Team_MissionFeatures][Missions]');
  const m = s.missionGroups.find((x) => x.id === '4491dc34-bcf3-4f56-a0b8-228e3e3f40e9');
  assert.strictEqual(m.generator, 'BountyHuntersGuild_KIllShip');
  assert.strictEqual(m.type, 'Bounty');
});

test('combat objectives are tracked as combat progress (proxy for kills)', () => {
  const s = new StarCitizenService({ discord: { enable: false } });
  let progressed = 0;
  s.on('combat:progress', () => { progressed++; });
  // a combat objective update
  s.handleLogChange('<2026-06-13T07:20:05.000Z> [Notice] <CMissionLogEntry::UpdateActiveObjective> Objective updated id=3340e494-888d-96be-0192-0c08d4841aa3, flags=ShowInLog|, uiDisplay[Priority=1][Text=Defeat Hostile Ship] [Team_MissionFeatures][Missions]');
  // a non-combat objective should NOT count
  s.handleLogChange('<2026-06-13T07:21:00.000Z> [Notice] <CMissionLogEntry::UpdateActiveObjective> Objective updated id=aaaa1111-0000-0000-0000-000000000000, flags=ShowInLog|, uiDisplay[Priority=1][Text=Deliver cargo to Teasa Spaceport] [Team_MissionFeatures][Missions]');
  assert.strictEqual(s.combatlog.length, 1, 'only the combat objective counts');
  assert.strictEqual(progressed, 1);
  assert.strictEqual(s.combatlog[0].text, 'Defeat Hostile Ship');
  assert.strictEqual(s.state.objectives['3340e494-888d-96be-0192-0c08d4841aa3'].combat, true);
});

test('player incapacitation routes to incaps, attributed to the session player', () => {
  const s = new StarCitizenService({ discord: { enable: false } });
  let downed = null;
  s.on('player:incap', (i) => { downed = i; });
  s.handleLogChange('<2026-03-26T04:00:00.000Z> [Notice] <Legacy login response> [CIG-net] User Login Success - Handle[DeadMan1227] - Time[1] [Login]');
  s.handleLogChange(`<2026-03-26T04:18:32.475Z> [Notice] <SHUDEvent_OnNotification> Added notification "Incapacitated: revive you before the 'Time to Death' timer expires." [156] to queue. New queue size: 1, MissionId: [00000000-0000-0000-0000-000000000000], ObjectiveId: [] [Team_CoreGameplayFeatures][Missions][Comms]`);
  assert.strictEqual(s.incaps.length, 1);
  assert.strictEqual(s.incaps[0].player, 'DeadMan1227');
  assert.strictEqual(downed.player, 'DeadMan1227');
});

test('player death routes to deaths, attributed to the session player (gear lines ignored)', () => {
  const s = new StarCitizenService({ discord: { enable: false } });
  let died = null;
  s.on('player:death', (d) => { died = d; });
  s.handleLogChange('<2026-06-17T07:00:00.000Z> [Notice] <Legacy login response> [CIG-net] User Login Success - Handle[Kersa] - Time[1] [Login]');
  // the body marker = one death
  s.handleLogChange("<2026-06-17T07:49:59.187Z> [Notice] <Adding non kept item [CSCActorCorpseUtils::PopulateItemPortForItemRecoveryEntitlement]> Item 'body_01_noMagicPocket_200128671231 - Class(body_01_noMagicPocket) - Context(Streamable Runtime-spawned) - Socpak()', Recorded data is: Port Name 'Body_ItemPort', KeptId: '200128671231' [Team_CoreGameplayFeatures][Unknown]");
  // a gear line from the same corpse burst must NOT add a second death
  s.handleLogChange("<2026-06-17T07:49:59.188Z> [Notice] <Adding non kept item [CSCActorCorpseUtils::PopulateItemPortForItemRecoveryEntitlement]> Item 'kap_combat_heavy_helmet_02_03_01_510415156137 - Class(kap_combat_heavy_helmet_02_03_01) - Context(Streamable Runtime-spawned) - Socpak()', Recorded data is: Port Name 'Armor_Helmet' [Team_CoreGameplayFeatures][Unknown]");
  assert.strictEqual(s.deaths.length, 1, 'one death per corpse burst (only the body marker counts)');
  assert.strictEqual(s.deaths[0].player, 'Kersa');
  assert.strictEqual(died.player, 'Kersa');
});

test('replays a real-format session: death + mission lifecycle outcomes', async () => {
  const path = require('node:path');
  const s = new StarCitizenService({ discord: { enable: false } });
  await s.replayLog(path.join(__dirname, 'fixtures', 'sample-missions.log'));

  // two deaths (two body markers; the gear lines in between are not deaths)
  assert.strictEqual(s.deaths.length, 2, 'two deaths detected');
  assert.ok(s.deaths.every((d) => d.player === 'Kersa'), 'deaths attributed to the session player');

  // mission lifecycle: 3 accepted, with Complete / Abandon / Fail outcomes
  const stats = s.missionStats();
  assert.deepStrictEqual(stats, { accepted: 3, completed: 1, abandoned: 1, failed: 1, deactivated: 0, active: 0 });

  // each grouped mission carries its outcome + status
  const complete = s.missionGroups.find((m) => m.id === 'aaaa1111-d438-4996-9755-1c3fc9532e85');
  assert.strictEqual(complete.outcome, 'Complete');
  assert.strictEqual(complete.status, 'Complete');
  assert.strictEqual(complete.contractId, 'c095ce31-4305-445f-806c-06d1b9001686');
  assert.ok(complete.startedAt && complete.endedAt, 'start + end timestamps captured');
  const failed = s.missionGroups.find((m) => m.id === 'cccc3333-0319-4a6a-8b2b-ece75082c848');
  assert.strictEqual(failed.outcome, 'Fail');
  assert.strictEqual(failed.reason, 'Mission timer expired');
});

test('HUD notification routes to notifications, not missionlog', () => {
  const s = new StarCitizenService({ discord: { enable: false } });
  s.handleLogChange('<2026-06-13T07:12:41.081Z> [Notice] <SHUDEvent_OnNotification> Added notification "Entering Armistice Zone - Combat Prohibited: " [8] to queue. New queue size: 3, MissionId: [00000000-0000-0000-0000-000000000000], ObjectiveId: [] [Team_CoreGameplayFeatures][Missions][Comms]');
  assert.strictEqual(s.notifications.length, 1);
  assert.strictEqual(s.missionlog.length, 0);
  assert.strictEqual(s.notifications[0].text, 'Entering Armistice Zone - Combat Prohibited: ');
});

test('handleLogChange stamps session build/hardware from header lines', () => {
  const s = new StarCitizenService({ discord: { enable: false } });
  s.handleLogChange('<2026-06-12T20:04:54.975Z> Log started on Fri Jun 12 20:04:54 2026');
  s.handleLogChange('<2026-06-12T20:04:55.614Z> Branch: sc-alpha-4.8.0-hotfix');
  s.handleLogChange('<2026-06-12T20:04:55.614Z> Changelist: 11952564');
  assert.strictEqual(s.session.branch, 'sc-alpha-4.8.0-hotfix');
  assert.strictEqual(s.session.changelist, '11952564');
});

test('handleLogChange tracks each game session and resets on a new launch', () => {
  const s = new StarCitizenService({ discord: { enable: false } });
  let started = 0;
  s.on('session:start', () => { started++; });
  s.handleLogChange('<2026-06-12T20:04:54.975Z> Log started on Fri Jun 12 20:04:54 2026');
  s.handleLogChange('<2026-06-12T20:04:55.614Z> Branch: sc-alpha-4.8.0-hotfix');
  assert.strictEqual(s.sessions.length, 1);
  assert.strictEqual(s.session.branch, 'sc-alpha-4.8.0-hotfix');
  // a second launch (game restart) starts a fresh session and resets build info
  s.handleLogChange('<2026-06-13T06:18:00.000Z> Log started on Sat Jun 13 06:18:00 2026');
  assert.strictEqual(s.sessions.length, 2);
  assert.strictEqual(started, 2);
  assert.strictEqual(s.session.startedOn, 'Sat Jun 13 06:18:00 2026');
  assert.strictEqual(s.session.branch, undefined);  // reset for the new session
});
