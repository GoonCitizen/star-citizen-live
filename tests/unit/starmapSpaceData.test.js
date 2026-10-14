'use strict';

const test = require('node:test');
const assert = require('assert');

const starmapSpaceData = require('../../functions/starmapSpaceData');

test('starmap.space cache has Daymar OC radius and POIs', () => {
  const oc = starmapSpaceData.getObjectContainer('Daymar');
  assert.ok(oc, 'Daymar object container');
  assert.equal(starmapSpaceData.bodyRadiusMeters('Daymar'), 295000);
  const pois = starmapSpaceData.listPoisForBody('Daymar');
  assert.ok(pois.length >= 50, 'expected many Daymar community POIs');
  assert.ok(pois.every((p) => Number.isFinite(p.latitude) && Number.isFinite(p.longitude)));
  assert.ok(pois.some((p) => p.quantum && /Kudre/i.test(p.name)));
});

test('localXyzToLatLon matches starmap Latitude/Longitude convention', () => {
  const pois = starmapSpaceData.listPoisForBody('Daymar');
  const sample = pois.find((p) => p.x != null && p.y != null && p.z != null);
  assert.ok(sample);
  const ll = starmapSpaceData.localXyzToLatLon(sample.x, sample.y, sample.z);
  assert.ok(ll);
  assert.ok(Math.abs(ll.latitude - sample.latitude) < 0.05);
  const dlon = Math.abs(ll.longitude - sample.longitude);
  assert.ok(Math.min(dlon, Math.abs(dlon - 360), Math.abs(dlon + 360)) < 0.05);
});

test('Microtech name normalize resolves OC', () => {
  assert.ok(starmapSpaceData.getObjectContainer('microTech'));
  assert.ok(starmapSpaceData.listPoisForBody('microTech').length >= 50);
});
