'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert');

require('../helpers/installReactStub');
const { textOf, findType } = require('../helpers/reactTree');
const MapPage = require('../../components/MapPage');
const UniverseMap = require('../../components/UniverseMap');
const StarMap = require('../../components/StarMap');
const GalaxyMap = require('../../components/GalaxyMap');
const BodyMap = require('../../components/BodyMap');
const UniverseExplorer = require('../../components/UniverseExplorer');
const Dashboard = require('../../components/Dashboard');

describe('Map tab', () => {
  it('hosts one continuous universe map', () => {
    const page = new MapPage({});
    page.state.locations = [{ slug: 'area18', name: 'Area18', system: 'Stanton', type: 'LandingZone' }];
    page.state.reports = [];
    const text = textOf(page.render());
    assert.match(text, /continuous browser from the universe/i);
    assert.match(text, /Universe map/);
    assert.match(text, /Find a location/);
    assert.match(text, /Area18/);
    assert.match(text, /not RSI art/i);
    assert.ok(findType(page.render(), UniverseMap).length >= 1);
  });

  it('UniverseMap drills galaxy → system → body in one chrome', () => {
    const map = new UniverseMap({});
    let text = textOf(map.render());
    assert.match(text, /Universe/);
    assert.match(text, /Zoom out/);
    assert.match(text, /\b2D\b/);
    assert.match(text, /\b3D\b/);
    assert.ok(findType(map.render(), GalaxyMap).length >= 1);

    map.state.scale = 'system';
    map.state.system = 'STANTON';
    assert.ok(findType(map.render(), StarMap).length >= 1);
    text = textOf(map.render());
    assert.match(text, /STANTON/);

    map.state.scale = 'body';
    map.state.body = 'Daymar';
    map.state.bodyName = 'Daymar';
    assert.ok(findType(map.render(), BodyMap).length >= 1);
    text = textOf(map.render());
    assert.match(text, /Daymar/);

    map.state.renderMode = '3d';
    map.state.scale = 'system';
    assert.ok(findType(map.render(), UniverseExplorer).length >= 1);
  });

  it('search hits focus the same map on a body', () => {
    const page = new MapPage({});
    page.onSearchHit({
      slug: 'daymar',
      name: 'Daymar',
      type: 'Moon',
      system: 'Stanton'
    });
    assert.equal(page.state.mapFocus.scale, 'body');
    assert.equal(page.state.mapFocus.system, 'STANTON');
    assert.match(String(page.state.mapFocus.body), /Daymar/i);
  });

  it('is a header tab and a home Features card', () => {
    const dash = new Dashboard({});
    dash.state.tab = 'home';
    dash.state.online = true;
    dash.state.status = 'ok';
    const home = textOf(dash.render());
    assert.match(home, /\bMap\b/);
    assert.match(home, /wiki star map/i);

    dash.state.tab = 'map';
    assert.ok(findType(dash.render(), MapPage).length >= 1);
  });
});

describe('StarMap backgrounds', () => {
  it('renders procedural background layers when layout is present', () => {
    const map = new StarMap({ system: 'STANTON' });
    map.state.layout = {
      system: { code: 'STANTON', name: 'Stanton' },
      systems: [{ code: 'STANTON', name: 'Stanton' }],
      bodies: [{ code: 'STAR', name: 'Stanton', type: 'STAR', nx: 0.5, ny: 0.5, r: 10, surfaceStyle: 'star', surfaceTile: 'tiles/surface-star.png' }],
      locations: [],
      hotspots: []
    };
    map.state.proceduralUrl = 'data:image/svg+xml,test';
    const tree = map.renderSvg();
    assert.equal(tree.type, 'svg');
    const kids = tree.children || (tree.props && tree.props.children) || [];
    const flat = (Array.isArray(kids) ? kids : [kids]).flat(Infinity).filter(Boolean);
    assert.ok(flat.some((c) => c && c.type === 'rect'));
    assert.ok(flat.some((c) => c && c.type === 'image'));
  });

  it('paints orbital bodies as textured groups and zooms on select', () => {
    let selected = null;
    const map = new StarMap({
      system: 'STANTON',
      onSelect: (pt) => { selected = pt; }
    });
    map.state.layout = {
      system: { code: 'STANTON', name: 'Stanton' },
      systems: [{ code: 'STANTON', name: 'Stanton' }],
      bodies: [{
        code: 'DAYMAR',
        name: 'Daymar',
        type: 'SATELLITE',
        nx: 0.6,
        ny: 0.4,
        r: 4,
        surfaceStyle: 'arid',
        surfaceTile: 'tiles/bodies/daymar.png'
      }],
      locations: [],
      hotspots: []
    };
    map.state.surfaceOk = { 'tiles/bodies/daymar.png': true };
    const tree = map.renderSvg();
    const kids = (tree.children || (tree.props && tree.props.children) || []);
    const flat = (Array.isArray(kids) ? kids : [kids]).flat(Infinity).filter(Boolean);
    const bodyGroup = flat.find((c) => {
      if (!c || c.type !== 'g') return false;
      const k = c.key || (c.props && c.props.key);
      return k && String(k).startsWith('b-');
    });
    assert.ok(bodyGroup, 'expected body <g>');
    const gKids = (bodyGroup.children || (bodyGroup.props && bodyGroup.props.children) || []);
    const gFlat = (Array.isArray(gKids) ? gKids : [gKids]).flat(Infinity).filter(Boolean);
    assert.ok(gFlat.some((c) => c && c.type === 'image'), 'expected surface texture image');

    // Synchronous fallback path when rAF is absent
    const hadRaf = global.requestAnimationFrame;
    delete global.requestAnimationFrame;
    map.zoomToBodyThenSelect(map.state.layout.bodies[0]);
    assert.ok(selected);
    assert.match(String(selected.name), /Daymar/i);
    assert.equal(selected.kind, 'body');
    if (hadRaf) global.requestAnimationFrame = hadRaf;
  });
});
