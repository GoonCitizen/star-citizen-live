'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert');

require('../helpers/installReactStub');
const { textOf, findType } = require('../helpers/reactTree');
const MapPage = require('../../components/MapPage');
const StarMap = require('../../components/StarMap');
const Dashboard = require('../../components/Dashboard');

describe('Map tab', () => {
  it('introduces the wiki map and local reports', () => {
    const page = new MapPage({});
    page.state.locations = [{ slug: 'area18', name: 'Area18', system: 'Stanton', type: 'LandingZone' }];
    page.state.reports = [];
    const text = textOf(page.render());
    assert.match(text, /Browse the Stanton/);
    assert.match(text, /Find a location/);
    assert.match(text, /Recent on this node/);
    assert.match(text, /Area18/);
    assert.ok(findType(page.render(), StarMap).length >= 1);
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
