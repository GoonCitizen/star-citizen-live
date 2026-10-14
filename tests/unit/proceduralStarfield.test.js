'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert');

const proceduralStarfield = require('../../functions/proceduralStarfield');

describe('proceduralStarfield', () => {
  it('builds a data URL with tint seed', () => {
    const url = proceduralStarfield.buildStarfieldDataUrl({
      seed: 'STANTON',
      tint: '#1a2a4a',
      nebula: '#1a3050',
      width: 64,
      height: 64,
      stars: 20
    });
    assert.match(url, /^data:image\/svg\+xml/);
    assert.ok(url.includes('1a2a4a') || url.includes('%231a2a4a') || decodeURIComponent(url).includes('#1a2a4a'));
  });

  it('coloursForSystem reads manifest', () => {
    const colours = proceduralStarfield.coloursForSystem('PYRO', {
      defaults: { tint: '#0b0e14', starfield: 'tiles/starfield-01.png', nebula: 'tiles/nebula-blue-01.png' },
      systems: {
        PYRO: { tint: '#3a1020', nebula: 'tiles/nebula-purple-01.png' }
      }
    });
    assert.equal(colours.tint, '#3a1020');
    assert.equal(colours.nebulaPath, 'tiles/nebula-purple-01.png');
  });
});
