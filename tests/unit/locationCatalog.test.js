'use strict';

const test = require('node:test');
const assert = require('assert');

const locationCatalog = require('../../functions/locationCatalog');

test('rs_ext_cru-leo1 resolves to CRU-L1 Ambitious Dream Station, not the asteroid', () => {
  const hit = locationCatalog.resolveLocation('rs_ext_cru-leo1');
  assert.ok(hit, 'expected catalog hit');
  assert.match(hit.name, /Ambitious Dream Station/i);
  assert.match(String(hit.type || ''), /Manmade/i);
  assert.notEqual(hit.type, 'Asteroid');
});

test('Daymar resolves as a moon in Stanton', () => {
  const hit = locationCatalog.resolveLocation('Daymar');
  assert.ok(hit);
  assert.match(hit.name, /Daymar/i);
  assert.match(String(hit.system || ''), /Stanton/i);
});

test('aliasesFromLogToken expands rs_ext_hur-leo1', () => {
  const aliases = locationCatalog.aliasesFromLogToken('rs_ext_hur-leo1');
  assert.ok(aliases.includes('hur-l1'));
  assert.ok(aliases.some((a) => /hur_l1/i.test(a)));
});

test('searchLocations finds Area18', () => {
  const hits = locationCatalog.searchLocations('area18', { limit: 8 });
  assert.ok(hits.length);
  assert.ok(hits.some((h) => /area.?18/i.test(h.name) || /area18/i.test(h.slug)));
});

test('catalog includes in-game outposts from the unpacked starmap', () => {
  const all = locationCatalog.listLocations();
  assert.ok(all.length >= 1500, `expected full dump, got ${all.length}`);
  assert.ok(!all.some((l) => /UNINITIALIZED/i.test(l.name)), 'junk names should be dropped');
  const adair = locationCatalog.resolveLocation("Adair's Retreat");
  assert.ok(adair, "expected Adair's Retreat");
  assert.match(String(adair.type || ''), /Outpost/i);
  const shubin = locationCatalog.searchLocations('Shubin Mining Facility SCD-1', { limit: 5 });
  assert.ok(shubin.some((h) => /SCD-1/i.test(h.name)));
  const afterlife = locationCatalog.resolveLocation('Afterlife');
  assert.ok(afterlife);
});
