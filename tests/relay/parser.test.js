'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const { parseLine, shipName, isNPC, parseSessionInfo, missionType, missionFaction } = require('../../functions/parser');

// --- VERIFIED patterns (from a real Game.log hangar session) ---

test('parses base structure: timestamp + channel + tag', () => {
  const r = parseLine("<2026-06-09T06:23:07.643Z> [Notice] <Legacy login response> [CIG-net] User Login Success - Handle[Kersa] - Time[182954069]");
  assert.strictEqual(r.timestamp, '2026-06-09T06:23:07.643Z');
  assert.strictEqual(r.channel, 'Notice');
  assert.strictEqual(r.tag, 'Legacy login response');
});

test('detects player login and extracts handle', () => {
  const r = parseLine("<2026-06-09T06:23:07.643Z> [Notice] <Legacy login response> [CIG-net] User Login Success - Handle[Kersa] - Time[182954069] [Team_GameServices][Login]");
  assert.strictEqual(r.kind, 'player:login');
  assert.strictEqual(r.handle, 'Kersa');
});

test('detects level load', () => {
  const r = parseLine("<2026-06-09T06:23:09.771Z> ============================ Loading level megamap ============================");
  assert.strictEqual(r.kind, 'session:level');
  assert.strictEqual(r.level, 'megamap');
});

test('detects session start (fresh log header)', () => {
  const r = parseLine("<2026-06-12T20:04:54.975Z> Log started on Fri Jun 12 20:04:54 2026");
  assert.strictEqual(r.kind, 'session:start');
  assert.strictEqual(r.startedOn, 'Fri Jun 12 20:04:54 2026');
});

test('detects game mode', () => {
  const r = parseLine("<2026-06-09T06:23:10.401Z> [Notice] <SeedingProcessor::SeedGameRulesAndMode Success> shardId[local_shard], GameMode[SC_Frontend], MegaMap[MegaMap.Frontend]");
  assert.strictEqual(r.kind, 'session:gamemode');
  assert.strictEqual(r.gameMode, 'SC_Frontend');
});

test('plain header line classified as log:raw', () => {
  const r = parseLine('<2026-06-12T20:04:54.975Z> BackupNameAttachment=" Build(11952564) 12 Jun 26 (12 04 50)"  -- used by backup system');
  assert.strictEqual(r.kind, 'log:raw');
});

// --- UNVERIFIED patterns (documented SC 4.x format; pending real combat log) ---

test('parses a player kill (Actor Death) — VERIFIED on real member data', () => {
  const line = "<2026-06-09T07:00:00.000Z> [Notice] <Actor Death> CActor::Kill: 'VictimGuy' [200111] in zone 'OOC_Stanton' killed by 'KillerGuy' [200222] using 'KLWE_LaserRepeater' [Class KLWE_LaserRepeater_S3] with damage type 'Energy' from direction x: 0.5, y: -0.2, z: 0.1";
  const r = parseLine(line);
  assert.strictEqual(r.kind, 'kill');
  assert.strictEqual(r.victim, 'VictimGuy');
  assert.strictEqual(r.killer, 'KillerGuy');
  assert.strictEqual(r.weapon, 'KLWE_LaserRepeater');
  assert.strictEqual(r.damageType, 'Energy');
  assert.strictEqual(r.dirZ, '0.1');
  assert.strictEqual(r.verified, true);   // VERIFIED 2026-06-14 against 417 real kills
});

test('parses a ship kill (Actor Death, damage type VehicleDestruction) — format corroborated by all-slain', () => {
  const line = "<2026-04-16T00:00:00.000Z> [Notice] <Actor Death> CActor::Kill: 'PU_Human-NineTails-Gunner-Male-Light_01_1234567890123' [1234567890123] in zone 'ANVL_Valkyrie_PU_AI_NT_QIG_1234567890123' killed by 'Player-123_Name' [123456789012] using 'BEHR_LaserCannon_S5_1234567890123' [Class unknown] with damage type 'VehicleDestruction' from direction x: 0.000000, y: 0.000000, z: 0.000000 [Team_ActorTech][Actor]";
  const r = parseLine(line);
  assert.strictEqual(r.kind, 'kill');
  assert.strictEqual(r.killer, 'Player-123_Name');
  assert.strictEqual(r.damageType, 'VehicleDestruction');
  assert.strictEqual(r.verified, true);
});

test('parses vehicle destruction — VERIFIED on real member data', () => {
  const line = "<2026-06-09T07:01:00.000Z> [Notice] <Vehicle Destruction> CVehicle::OnAdvanceDestroyLevel: Vehicle 'ANVL_Hornet_F7C' [300333] in zone 'OOC_Stanton_1a' [pos x: 1.0, y: 2.0, z: 3.0 vel x: 0.0, y: 0.0, z: 0.0] driven by 'PilotGuy' [400444] advanced from destroy level 0 to 2 caused by 'KillerGuy' [200222] with 'Ballistic'";
  const r = parseLine(line);
  assert.strictEqual(r.kind, 'vehicle:destroy');
  assert.strictEqual(r.vehicle, 'ANVL_Hornet_F7C');
  assert.strictEqual(r.toLevel, '2');
  assert.strictEqual(r.attacker, 'KillerGuy');
  assert.strictEqual(r.damageType, 'Ballistic');
  assert.strictEqual(r.verified, true);
});

// --- VERIFIED mission patterns (from a real combat-mission session, 2026-06-12) ---

test('detects mission contract name', () => {
  const r = parseLine("<2026-06-12T20:16:06.843Z> [Notice] <GenerateLocationProperty> Generated Locations - variablename: SubLocationType_BP, locations: (Freelancer wreck site [4221372531] [MISC_Freelancer_Space_Stanton1]) contract: FoxwellEnforcement_Stanton_DefendShipNamed_E [Team_MissionFeatures][Missions]");
  assert.strictEqual(r.kind, 'mission:contract');
  assert.strictEqual(r.contract, 'FoxwellEnforcement_Stanton_DefendShipNamed_E');
});

test('detects mission objective update and its text', () => {
  const r = parseLine("<2026-06-12T20:20:11.249Z> [Notice] <CMissionLogEntry::UpdateActiveObjective> Objective updated id=3340e494-888d-96be-0192-0c08d4841aa3, flags=ShowInLog|RespectInheritedVisibility|, hidden=0, hiddenInUI=0, markerHidden=0, uiDisplay[Priority=1][Text=Defeat Hostile Ship] [Team_MissionFeatures][Missions]");
  assert.strictEqual(r.kind, 'mission:objective');
  assert.strictEqual(r.objectiveId, '3340e494-888d-96be-0192-0c08d4841aa3');
  assert.strictEqual(r.text, 'Defeat Hostile Ship');
});

test('detects mission notification with mission/objective ids', () => {
  const r = parseLine("<2026-06-12T20:20:11.252Z> [Notice] <SHUDEvent_OnNotification> Added notification \"New Objective: Defeat Hostile Ships: \" [25] to queue. New queue size: 1, MissionId: [4491dc34-bcf3-4f56-a0b8-228e3e3f40e9], ObjectiveId: [3340e494-888d-96be-0192-0c08d4841aa3] [Team_CoreGameplayFeatures][Missions][Comms]");
  assert.strictEqual(r.kind, 'mission:notification');
  assert.strictEqual(r.text, 'New Objective: Defeat Hostile Ships: ');
  assert.strictEqual(r.missionId, '4491dc34-bcf3-4f56-a0b8-228e3e3f40e9');
  assert.strictEqual(r.objectiveId, '3340e494-888d-96be-0192-0c08d4841aa3');
});

test('zero-MissionId notification is a general HUD notice, not a mission', () => {
  const r = parseLine('<2026-06-13T07:12:41.081Z> [Notice] <SHUDEvent_OnNotification> Added notification "Entering Armistice Zone - Combat Prohibited: " [8] to queue. New queue size: 3, MissionId: [00000000-0000-0000-0000-000000000000], ObjectiveId: [] [Team_CoreGameplayFeatures][Missions][Comms]');
  assert.strictEqual(r.kind, 'hud:notification');
  assert.strictEqual(r.text, 'Entering Armistice Zone - Combat Prohibited: ');
  assert.strictEqual(r.missionId, undefined);   // not tied to a mission
});

test('detects mission marker (missionId -> generator name)', () => {
  const r = parseLine('<2026-06-13T07:00:00.000Z> [Notice] <CLocalMissionPhaseMarker::CreateMarker> Creating objective marker: missionId [0204222e-95c7-4211-a2ad-a18e1056de65], generator name [FoxwellEnforcement_Generator], more [Team_MissionFeatures][Missions]');
  assert.strictEqual(r.kind, 'mission:marker');
  assert.strictEqual(r.missionId, '0204222e-95c7-4211-a2ad-a18e1056de65');
  assert.strictEqual(r.generator, 'FoxwellEnforcement_Generator');
});

test('detects objective state upsert events', () => {
  const line = '<2026-07-20T03:56:44.384Z> [Notice] <ObjectiveUpserted> Received ObjectiveUpserted push message for: mission_id a81a8e50-ebf2-4dd5-9543-7fbb072d560e - objective_id 8a4c3ec2-b4f3-79db-de03-24b25141d2ad - state MISSION_OBJECTIVE_STATE_INPROGRESS - created 1 - flags=Hidden|HiddenInUI|ShowInLog| [Team_GameServices][Missions]';
  const r = parseLine(line);
  assert.strictEqual(r.kind, 'mission:objective:state');
  assert.strictEqual(r.missionId, 'a81a8e50-ebf2-4dd5-9543-7fbb072d560e');
  assert.strictEqual(r.objectiveId, '8a4c3ec2-b4f3-79db-de03-24b25141d2ad');
  assert.strictEqual(r.state, 'MISSION_OBJECTIVE_STATE_INPROGRESS');
});

test('classifies mission types from real generator codenames', () => {
  assert.strictEqual(missionType('BountyHuntersGuild_KIllShip'), 'Bounty');
  assert.strictEqual(missionType('FoxwellEnforcement_Patrol'), 'Mercenary/Defense');
  assert.strictEqual(missionType('Covalex_Hauling'), 'Hauling');
  assert.strictEqual(missionType('Rayari_RecoverItem'), 'Recovery');
  assert.strictEqual(missionType('Shubin_ResourceGathering_ShipMining'), 'Mining');
  assert.strictEqual(missionType('SomeUnknown_Generator'), 'Other');
  // added activity patterns (real codenames previously falling to Other)
  assert.strictEqual(missionType('InterSec_StationAssault'), 'Bounty');
  assert.strictEqual(missionType('CitizensForProsperity_ShipWaveAttack'), 'Bounty');
  assert.strictEqual(missionType('HockrowAgency_MissingPerson'), 'Recovery');
  assert.strictEqual(missionType('FTL_Courier'), 'Hauling');
});

test('classifies issuer-only generators via the faction fallback (sourced, ~4.8.0)', () => {
  // no activity verb in the codename -> fall back to the contract issuer
  assert.strictEqual(missionType('CleanAir'), 'Event');
  assert.strictEqual(missionType('Adagio_Generator'), 'Recovery');
  assert.strictEqual(missionType('Vaughn_Generator'), 'Bounty');
  assert.strictEqual(missionType('InterSec_Generator'), 'Mercenary/Defense');
  assert.strictEqual(missionType('Shubin_Generator'), 'Mining');
  assert.strictEqual(missionType('UnitedWayfarersClub'), 'Support');
  // genuinely unknown issuers stay Other (no guessing)
  assert.strictEqual(missionType('Unaffiliated_Generator'), 'Other');
  assert.strictEqual(missionType('GoblinG_Generator'), 'Other');
});

test('missionFaction extracts the contractor from the generator prefix', () => {
  assert.strictEqual(missionFaction('HockrowAgency_MissingPerson'), 'Hockrow Agency');
  assert.strictEqual(missionFaction('CitizensForProsperity_ShipWaveAttack'), 'Citizens For Prosperity');
  assert.strictEqual(missionFaction('CleanAir'), 'Clean Air');
  assert.strictEqual(missionFaction('Covalex_Hauling'), 'Covalex');
  assert.strictEqual(missionFaction(undefined), 'Unknown');
  assert.strictEqual(missionFaction(null), 'Unknown');
});

test('detects player incapacitation (down) — VERIFIED in 4.7.0 logs', () => {
  const line = `<2026-03-26T04:18:32.475Z> [Notice] <SHUDEvent_OnNotification> Added notification "Incapacitated: While incapacitated, ask others in your party to revive you before the 'Time to Death' timer expires." [156] to queue. New queue size: 1, MissionId: [00000000-0000-0000-0000-000000000000], ObjectiveId: [] [Team_CoreGameplayFeatures][Missions][Comms]`;
  const r = parseLine(line);
  assert.strictEqual(r.kind, 'player:incap');
  assert.ok(r.text.startsWith('Incapacitated:'));
});

test('detects update notifications for HUD stream updates', () => {
  const line = '<2026-07-20T03:56:50.397Z> [Notice] <UpdateNotificationItem> Notification "New Objective: Search for bounty\'s current location." [29], Action: Next [Team_CoreGameplayFeatures][Missions][Comms]';
  const r = parseLine(line);
  assert.strictEqual(r.kind, 'hud:notification:update');
  assert.ok(r.text.startsWith('New Objective: Search for bounty'));
});

test('detects inventory events from live 4.9.0 lines', () => {
  const a = parseLine('<2026-07-20T03:28:39.594Z> [Notice] <AttachmentReceived> Player[ChairmanPoW] Attachment[body_01_noMagicPocket_200000000218, body_01_noMagicPocket, 200000000218] Status[persistent] Port[Body_ItemPort] Elapsed[65.056007] [Team_CoreGameplayFeatures][Inventory]');
  assert.strictEqual(a.kind, 'inventory:attachment');
  assert.strictEqual(a.player, 'ChairmanPoW');
  assert.strictEqual(a.port, 'Body_ItemPort');

  const q = parseLine('<2026-07-20T03:33:41.306Z> [Notice] <Query Inventory> Request[0] Elapsed[0.127477] for AsyncQueryInventoryData. [Team_CoreGameplayFeatures][Inventory]');
  assert.strictEqual(q.kind, 'inventory:query:elapsed');
  assert.strictEqual(q.requestId, '0');

  const c = parseLine('<2026-07-20T03:33:58.760Z> [Notice] <Inventory Request Completed> Request[1] Player[ChairmanPoW] Result[succeed] Elapsed[17.586262] PendingMoves[4] [Team_CoreGameplayFeatures][Inventory]');
  assert.strictEqual(c.kind, 'inventory:request:completed');
  assert.strictEqual(c.result, 'succeed');

  const p = parseLine('<2026-07-20T03:33:58.764Z> [Notice] <InventoryManagementRequest> Processing Request[2] Type[QueryInventory] for \'ChairmanPoW\' [204741503152] Source Inventory[INVALID] Target Inventory[INVALID] CanLockQueue[No] DependentRequest[4294967295] [Team_CoreGameplayFeatures][Inventory]');
  assert.strictEqual(p.kind, 'inventory:request:processing');
  assert.strictEqual(p.requestId, '2');

  const qe = parseLine('<2026-07-20T03:33:58.849Z> [Notice] <Query Inventory> Elapsed[0.085431] for IInventoryAPI::AsyncQueryInventory. [Team_CoreGameplayFeatures][Inventory]');
  assert.strictEqual(qe.kind, 'inventory:query:api-elapsed');
  assert.strictEqual(qe.elapsed, '0.085431');

  const tr = parseLine('<2026-07-20T03:53:04.300Z> [Notice] <Request Terminate Access To Inventory> Player[ChairmanPoW] terminating access to [718275320038:Container:0] [Team_CoreGameplayFeatures][Inventory]');
  assert.strictEqual(tr.kind, 'inventory:access:terminate');
  assert.strictEqual(tr.inventory, '718275320038:Container:0');
});

test('detects vehicle list request/result events', () => {
  const req = parseLine('<2026-07-20T03:38:57.734Z> [Notice] <OnRequestFetchVehicles> Querying hangar inventory for player [204741503152] at location [3170699229] [Team_GameServices][ASOP][Entitlement][Insurance]');
  assert.strictEqual(req.kind, 'vehicle:list:request');
  assert.strictEqual(req.scope, 'hangar');

  const res = parseLine('<2026-07-20T03:55:54.993Z> [Notice] <VehicleListQuery> Fetching vehicle list for player 204741503152 completed. Retrieved 2 entitlements out of 2 vehicules. [Team_GameServices][ASOP][Entitlement][Insurance]');
  assert.strictEqual(res.kind, 'vehicle:list:result');
  assert.strictEqual(res.entitlements, '2');
});

test('detects social/comms/grpc channel events', () => {
  const social = parseLine('<2026-07-20T03:28:08.788Z> [Notice] <Update group cache> Success [Team_GameServices][Social]');
  assert.strictEqual(social.kind, 'social:group-cache');
  assert.strictEqual(social.phase, 'success');

  const comms = parseLine('<2026-07-20T03:57:32.668Z> [Notice] <Connection Flow> CSCCommsComponent::DoEstablishCommunicationCommon: Update bubble created for communication connection \'840707700\' on channel \'0\' for ChairmanPoW [204741503152] to track their communication partner AImodule_ATC_NewBabbageATC01_718424511860 [718424511860] [Team_CoreGameplayFeatures][Comms]');
  assert.strictEqual(comms.kind, 'comms:connection');
  assert.strictEqual(comms.action, 'created');

  const grpc = parseLine('<2026-07-20T03:27:51.658Z> [Notice] <CreateChannel> Opening channel for \'sc.external.services.configuration.v1.ConfigService\' to endpoint pub-sc-alpha-490-12232306.test1.cloudimperiumgames.com:443 (transport security: 1) [Team_OnlineTech][gRPC]');
  assert.strictEqual(grpc.kind, 'grpc:channel:create');
  assert.strictEqual(grpc.transportSecurity, '1');
});

// --- VERIFIED current-build death + mission-lifecycle (real 4.7-4.8 logs, 2026-06) ---
// SC stopped logging kills after 4.3.0; these are the current-build signals.

test('detects local-player death via corpse body marker — VERIFIED on real 4.7-4.8 logs', () => {
  // First line of the corpse-recovery burst; always the body, one per death.
  const line = "<2026-06-02T19:30:56.875Z> [Notice] <Adding non kept item [CSCActorCorpseUtils::PopulateItemPortForItemRecoveryEntitlement]> Item 'body_01_noMagicPocket_200128671231 - Class(body_01_noMagicPocket) - Context(Streamable Runtime-spawned) - Socpak()', Recorded data is: Port Name 'Body_ItemPort', Class GUID: 'dbaa8a7d-755f-4104-8b24-7b58fd1e76f6', KeptId: '200128671231' [Team_CoreGameplayFeatures][Unknown]";
  const r = parseLine(line);
  assert.strictEqual(r.kind, 'player:death');
  assert.strictEqual(r.bodyId, '200128671231');
});

test('a corpse GEAR line is NOT a death (only the body marker counts)', () => {
  // Same tag, but a helmet/armour item - must fall through, so we never double-count.
  const line = "<2026-06-16T04:49:59.187Z> [Notice] <Adding non kept item [CSCActorCorpseUtils::PopulateItemPortForItemRecoveryEntitlement]> Item 'kap_combat_heavy_helmet_02_03_01_510415156137 - Class(kap_combat_heavy_helmet_02_03_01) - Context(Streamable Runtime-spawned) - Socpak()', Recorded data is: Port Name 'Armor_Helmet', Class GUID: '1ee43c13-990f-4a3f-b4ed-d5727af01cac' [Team_CoreGameplayFeatures][Unknown]";
  const r = parseLine(line);
  assert.notStrictEqual(r.kind, 'player:death');
});

test('detects mission accepted/started (ContractId + MissionId) — VERIFIED 4.8.0', () => {
  const line = "<2026-06-17T07:49:04.019Z> [Notice] <CSCPlayerMissionLog::MissionStartCommsNotification> MissionStart comms notification will not be sent - This mission has no MissionStart comms setup. ContractId: [c095ce31-4305-445f-806c-06d1b9001686]. MissionId: e50113b0-d438-4996-9755-1c3fc9532e85 [Team_MissionFeatures][Missions][Comms]";
  const r = parseLine(line);
  assert.strictEqual(r.kind, 'mission:start');
  assert.strictEqual(r.contractId, 'c095ce31-4305-445f-806c-06d1b9001686');
  assert.strictEqual(r.missionId, 'e50113b0-d438-4996-9755-1c3fc9532e85');
});

test('detects mission end with CompletionType=Complete — VERIFIED 4.8.0', () => {
  const line = "<2026-06-17T08:05:40.457Z> [Notice] <EndMission> Ending mission for player. MissionId[58dc656e-e1a2-454f-92fd-c032b9e5c1d6] Player[Kersa] PlayerId[204821711285] CompletionType[Complete] Reason[Mission Ended] [Team_MissionFeatures][Missions]";
  const r = parseLine(line);
  assert.strictEqual(r.kind, 'mission:end');
  assert.strictEqual(r.missionId, '58dc656e-e1a2-454f-92fd-c032b9e5c1d6');
  assert.strictEqual(r.player, 'Kersa');
  assert.strictEqual(r.completionType, 'Complete');
  assert.strictEqual(r.reason, 'Mission Ended');
});

test('detects mission end with CompletionType=Abandon — VERIFIED 4.8.0', () => {
  const line = "<2026-06-17T07:49:04.969Z> [Notice] <EndMission> Ending mission for player. MissionId[e50113b0-d438-4996-9755-1c3fc9532e85] Player[Kersa] PlayerId[204821711285] CompletionType[Abandon] Reason[Player left] [Team_MissionFeatures][Missions]";
  const r = parseLine(line);
  assert.strictEqual(r.kind, 'mission:end');
  assert.strictEqual(r.completionType, 'Abandon');
  assert.strictEqual(r.reason, 'Player left');
});

// --- VERIFIED helpers folded in from the community reference (validated on real log) ---

test('shipName extracts and prettifies real ship IDs', () => {
  assert.strictEqual(shipName('RSI_Aurora_Mk2_480167582679'), 'Aurora Mk2');
  assert.strictEqual(shipName('AEGS_Avenger_Titan_487288078845'), 'Avenger Titan');
  assert.strictEqual(shipName('ARGO_MPUV_1T_490286587822'), 'MPUV 1T');
  assert.strictEqual(shipName('not-a-ship'), null);
});

test('isNPC uses reliable indicators (and excludes cosmetic PU_ items)', () => {
  assert.strictEqual(isNPC('PU_Pilots_Outlaw_Gunner_01'), true);
  assert.strictEqual(isNPC('AI_CRIM_Pilot'), true);
  assert.strictEqual(isNPC('Kersa'), false);                       // a real handle
  assert.strictEqual(isNPC('PU_Protos_Head_200000000225'), false); // cosmetic item, not an NPC
});

test('parseSessionInfo reads build + hardware from header lines', () => {
  assert.deepStrictEqual(parseSessionInfo('Branch: sc-alpha-4.8.0-hotfix'), { key: 'branch', value: 'sc-alpha-4.8.0-hotfix' });
  assert.deepStrictEqual(parseSessionInfo('Changelist: 11952564'), { key: 'changelist', value: '11952564' });
  assert.deepStrictEqual(parseSessionInfo('31793MB physical memory installed, 9382MB available'), { key: 'ramInstalledMB', value: '31793' });
  assert.strictEqual(parseSessionInfo('just a normal log line'), null);
});
