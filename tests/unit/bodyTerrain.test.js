'use strict';

const test = require('node:test');
const assert = require('assert');

const bodyTerrain = require('../../functions/bodyTerrain');

test('resolves known bodies to unique terrain slugs', () => {
  assert.equal(bodyTerrain.resolveBodyTerrain({ name: 'Daymar' }).slug, 'daymar');
  assert.equal(bodyTerrain.resolveBodyTerrain({ name: 'microTech' }).slug, 'microtech');
  assert.equal(bodyTerrain.surfaceTileForBody({ name: 'Hurston' }), 'tiles/bodies/hurston.png');
  assert.equal(bodyTerrain.surfaceStyleForBody({ name: 'Crusader' }), 'gas');
  assert.equal(bodyTerrain.surfaceStyleForBody({ name: 'ArcCorp' }), 'industrial');
});

test('lists distinct body slugs for tile generation', () => {
  const slugs = bodyTerrain.listKnownBodySlugs();
  assert.ok(slugs.includes('daymar'));
  assert.ok(slugs.includes('microtech'));
  assert.ok(slugs.includes('hurston'));
  assert.equal(new Set(slugs).size, slugs.length);
});
