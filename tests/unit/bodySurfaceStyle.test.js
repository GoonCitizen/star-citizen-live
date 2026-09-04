'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert');

const bodySurfaceStyle = require('../../functions/bodySurfaceStyle');

describe('bodySurfaceStyle', () => {
  it('picks styles from body names', () => {
    assert.equal(bodySurfaceStyle.surfaceStyleForBody({ type: 'STAR', name: 'Stanton' }), 'star');
    assert.equal(bodySurfaceStyle.surfaceStyleForBody({ type: 'PLANET', name: 'microTech' }), 'ice');
    assert.equal(bodySurfaceStyle.surfaceStyleForBody({ type: 'PLANET', name: 'Crusader' }), 'gas');
    assert.equal(bodySurfaceStyle.surfaceStyleForBody({ type: 'PLANET', name: 'Hurston' }), 'rocky');
    assert.equal(bodySurfaceStyle.surfaceStyleForBody({ type: 'SATELLITE', name: 'Daymar' }), 'arid');
    assert.equal(bodySurfaceStyle.surfaceStyleForBody({ type: 'SATELLITE', name: 'Magda' }), 'rocky');
    assert.equal(bodySurfaceStyle.surfaceStyleForBody({ type: 'SATELLITE', name: 'Lyria' }), 'industrial');
    assert.ok(bodySurfaceStyle.isOrbitalBody({ type: 'PLANET' }));
    assert.equal(bodySurfaceStyle.isOrbitalBody({ type: 'JUMPPOINT' }), false);
  });
});
