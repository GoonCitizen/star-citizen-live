'use strict';

const test = require('node:test');
const assert = require('assert');

const starmapLayout = require('../../functions/starmapLayout');

test('layoutSystem plots Stanton bodies', () => {
  const layout = starmapLayout.layoutSystem('STANTON', { includeHotspots: true });
  assert.equal(layout.system.code, 'STANTON');
  assert.ok(layout.bodies.length > 3, 'expected planets/moons');
  assert.ok(layout.bodies.every((b) => Number.isFinite(b.nx) && Number.isFinite(b.ny)));
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
