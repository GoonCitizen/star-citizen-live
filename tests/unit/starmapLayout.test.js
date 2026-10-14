'use strict';

const test = require('node:test');
const assert = require('assert');

const starmapLayout = require('../../functions/starmapLayout');

test('layoutSystem plots Stanton bodies', () => {
  const layout = starmapLayout.layoutSystem('STANTON', { includeHotspots: true });
  assert.equal(layout.system.code, 'STANTON');
  assert.ok(layout.bodies.length > 3, 'expected planets/moons');
  assert.ok(layout.bodies.every((b) => Number.isFinite(b.nx) && Number.isFinite(b.ny)));
  const daymar = layout.bodies.find((b) => /daymar/i.test(b.name || ''));
  assert.ok(daymar);
  assert.equal(daymar.surfaceStyle, 'arid');
  assert.match(String(daymar.surfaceTile), /tiles\/bodies\/daymar\.png/);
  const mt = layout.bodies.find((b) => /microtech/i.test(b.name || ''));
  assert.ok(mt);
  assert.equal(mt.surfaceStyle, 'ice');
  assert.match(String(mt.surfaceTile), /tiles\/bodies\/microtech\.png/);
  const crusader = layout.bodies.find((b) => /crusader/i.test(b.name || ''));
  assert.ok(crusader);
  assert.equal(crusader.surfaceStyle, 'gas');
});

test('layoutSystem plots QT destRows without dropping hotspot layer', () => {
  const withHotspots = starmapLayout.layoutSystem('STANTON', {
    includeHotspots: true,
    destinations: [{ n: 'rs_ext_cru-leo1', c: 4 }, { n: 'Daymar', c: 2 }]
  });
  const noHotspots = starmapLayout.layoutSystem('STANTON', {
    includeHotspots: false,
    destinations: [{ n: 'rs_ext_cru-leo1', c: 4 }]
  });
  assert.ok(withHotspots.destinations.length >= 1);
  assert.ok(withHotspots.destinations.some((d) => /Ambitious Dream|CRU/i.test(d.label || d.name || '')));
  assert.ok(withHotspots.hotspots.length >= noHotspots.hotspots.length);
  assert.equal(noHotspots.hotspots.length, 0);
  assert.ok(withHotspots.locations.some((p) => /Outpost|LandingZone|Manmade/i.test(p.type || '') || p.slug),
    'expected outposts/stations on the map layer');
});

test('layoutGalaxy plots systems and jump edges', () => {
  const galaxy = starmapLayout.layoutGalaxy();
  assert.ok(galaxy.systems.length >= 2);
  assert.ok(galaxy.systems.every((s) => Number.isFinite(s.nx) && Number.isFinite(s.ny)));
  assert.ok(galaxy.systems.some((s) => s.code === 'STANTON'));
  assert.ok(galaxy.edges.length >= 1);
  assert.ok(galaxy.edges.every((e) => Number.isFinite(e.x1) && Number.isFinite(e.x2)));
});

test('layoutBody places POIs on Daymar surface', () => {
  const layout = starmapLayout.layoutBody('STANTON', 'Daymar');
  assert.ok(layout.body);
  assert.match(String(layout.body.name), /Daymar/i);
  assert.ok(layout.surfaceStyle);
  assert.ok(layout.surfaceTile);
  assert.match(String(layout.surfaceTile), /tiles\/bodies\/daymar\.png/);
  assert.equal(layout.terrainSlug, 'daymar');
  assert.equal(layout.projection, 'equirectangular');
  assert.ok(Array.isArray(layout.pois));
  assert.ok(layout.pois.length >= 50, 'expected community + catalog POIs on Daymar');
  assert.ok(layout.pois.every((p) => Number.isFinite(p.nx) && Number.isFinite(p.ny)));
  assert.equal(layout.body.radiusMeters, 295000);
  assert.match(String(layout.coordsCredit || ''), /starmap\.space/i);
  assert.ok(layout.pois.some((p) => p.coordsSource === 'starmap.space' && Number.isFinite(p.latitude)));
});

test('layoutBody viewLongitude rotates surface projection', () => {
  const a = starmapLayout.layoutBody('STANTON', 'Daymar');
  const b = starmapLayout.layoutBody('STANTON', 'Daymar', { viewLongitude: 90 });
  const pa = a.pois.find((p) => p.quantum && /Kudre/i.test(p.name));
  const pb = b.pois.find((p) => p.quantum && /Kudre/i.test(p.name));
  assert.ok(pa && pb);
  assert.ok(Math.abs(pa.nx - pb.nx) > 0.01 || Math.abs(pa.ny - pb.ny) > 0.01);
});

test('layoutBody resolves ArcCorp landing zones', () => {
  const layout = starmapLayout.layoutBody('STANTON', 'ArcCorp');
  assert.ok(layout.body);
  assert.ok(layout.pois.some((p) => /area.?18/i.test(p.name || p.slug || '')));
});
