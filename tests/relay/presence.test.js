'use strict';

const test = require('node:test');
const assert = require('assert');

const presence = require('../../functions/presence');
const { parseLine } = require('../../functions/parser');

test('isOnline respects 10 minute window', () => {
  const now = Date.parse('2026-07-29T20:00:00.000Z');
  assert.equal(presence.isOnline('2026-07-29T19:51:00.000Z', now), true);
  assert.equal(presence.isOnline('2026-07-29T19:49:59.000Z', now), false);
  assert.equal(presence.isOnline(null, now), false);
});

test('sanitizePresenceShare defaults and normalizes visibility', () => {
  const out = presence.sanitizePresenceShare({
    sharePresence: true,
    presenceVisibility: 'PEERS',
    presenceGroupIds: ['a', 'a', 'b'],
    shipOverrideSlug: '  '
  });
  assert.equal(out.sharePresence, true);
  assert.equal(out.presenceVisibility, 'peers');
  assert.deepEqual(out.presenceGroupIds, ['a', 'b']);
  assert.equal(out.shipOverrideSlug, null);
});

test('buildDetectedShip maps class id to display name and slug', () => {
  const ship = presence.buildDetectedShip('DRAK_Clipper_734066837132', '734066837132', '2026-07-29T12:00:00.000Z');
  assert.equal(ship.classId, 'DRAK_Clipper_734066837132');
  assert.equal(ship.vehicleId, '734066837132');
  assert.ok(/clipper/i.test(ship.name || ''), 'expected Clipper display name');
  assert.ok(ship.slug && /clipper/i.test(ship.slug), 'expected catalog slug for Clipper');
});

test('buildPresenceDocument prefers ship override over detected ship', () => {
  const recent = new Date(Date.now() - 60000).toISOString();
  const doc = presence.buildPresenceDocument({
    lastEventAt: recent,
    detectedShip: { classId: 'DRAK_Clipper_1', name: 'Clipper', slug: 'clipper' },
    shipOverride: { slug: 'aurora-mr', name: 'Aurora MR' },
    visibility: 'groups',
    groupIds: ['grp-1'],
    statusText: '  on patrol  '
  });
  assert.equal(doc.type, presence.PRESENCE_TYPE);
  assert.equal(doc.online, true);
  assert.equal(doc.ship.source, 'override');
  assert.equal(doc.ship.slug, 'aurora-mr');
  assert.equal(doc.visibility, 'groups');
  assert.equal(doc.statusText, 'on patrol');
  // Catalog enrichment when slug resolves.
  if (doc.ship.type) assert.equal(typeof doc.ship.type, 'string');
});

test('cleared ship override suppresses Game.log autodetect', () => {
  const recent = new Date(Date.now() - 60000).toISOString();
  const cleared = presence.buildShipOverride(presence.SHIP_NONE_SLUG);
  assert.equal(cleared.cleared, true);
  assert.equal(presence.sanitizePresenceShare({ shipOverrideSlug: 'clear' }).shipOverrideSlug,
    presence.SHIP_NONE_SLUG);
  const doc = presence.buildPresenceDocument({
    lastEventAt: recent,
    detectedShip: { classId: 'DRAK_Clipper_1', name: 'Clipper', slug: 'clipper' },
    shipOverride: cleared
  });
  assert.equal(doc.ship, null);
});

test('buildShipOverride includes catalog type', () => {
  const ship = presence.buildShipOverride('orig-100i');
  assert.ok(ship);
  assert.equal(ship.slug, 'orig-100i');
  assert.equal(ship.type, 'Exploration');
});

test('resolveOnline respects availability override', () => {
  const now = Date.parse('2026-07-29T20:00:00.000Z');
  assert.equal(presence.resolveOnline('offline', '2026-07-29T19:55:00.000Z', now), false);
  assert.equal(presence.resolveOnline('online', null, now), true);
  assert.equal(presence.resolveOnline('auto', '2026-07-29T19:55:00.000Z', now), true);
});

test('mergeRemotePresence merges inbound mesh documents', () => {
  const merged = presence.mergeRemotePresence(null, {
    online: true,
    lastEventAt: '2026-07-29T20:00:00.000Z',
    ship: { slug: 'mantis', name: 'Mantis', source: 'detected' },
    ownerPubkey: '03abc'
  });
  assert.equal(merged.pubkey, '03abc');
  assert.equal(merged.online, true);
  assert.equal(merged.ship.slug, 'mantis');
  assert.ok(merged.lastSeen);
});

test('parses vehicle:control ClearDriver (verified rule)', () => {
  const line = "<2026-07-29T18:12:04.512Z> [Notice] <Vehicle Control Flow> CVehicleMovementBase::ClearDriver: Local client node [416] releasing control token for 'MRAI_Guardian_MX_Collector_Military_738946944451' [738946944451] [Team_Vehicle]";
  const ev = parseLine(line);
  assert.equal(ev.kind, 'vehicle:control');
  assert.equal(ev.verified, true);
  assert.equal(ev.action, 'clear');
  assert.equal(ev.vehicle, 'MRAI_Guardian_MX_Collector_Military_738946944451');
  assert.equal(ev.vehicleId, '738946944451');
  const detected = presence.buildDetectedShip(ev.vehicle, ev.vehicleId, ev.timestamp);
  assert.ok(/guardian/i.test(detected.name || ''), 'wiki/catalog name for Guardian MX');
  assert.ok(detected.slug && /guardian/i.test(detected.slug));
});

test('quantum:select vehicle updates detected ship shape', () => {
  const line = '<2026-07-23T23:55:53.091Z> [Notice] <Player Selected Quantum Target - Local> [ItemNavigation][CL][416] | NOT AUTH | DRAK_Clipper_734066837132[734066837132]|CSCItemNavigation::OnPlayerSelectedQuantumTarget|Player has selected point rs_ext_cru-leo1 as their destination, routing locally [Team_CGP4][QuantumTravel]';
  const ev = parseLine(line);
  assert.equal(ev.kind, 'quantum:select');
  const ship = presence.buildDetectedShip(ev.vehicle, null, ev.timestamp);
  assert.ok(/clipper/i.test(ship.name || ''));
});
