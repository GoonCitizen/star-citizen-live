'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert');

require('../helpers/installReactStub');
const { textOf, findType } = require('../helpers/reactTree');
const LocationPage = require('../../components/LocationPage');
const StarMap = require('../../components/StarMap');

describe('LocationPage', () => {
  it('reads /locations/:slug from the location', () => {
    const prev = window.location;
    window.location = Object.assign({}, prev, { pathname: '/locations/area18' });
    try {
      assert.strictEqual(LocationPage.slugFromLocation(), 'area18');
    } finally {
      window.location = prev;
    }
  });

  it('does not treat /locations/map as a location page', () => {
    const prev = window.location;
    window.location = Object.assign({}, prev, { pathname: '/locations/map' });
    try {
      assert.equal(LocationPage.slugFromLocation(), null);
    } finally {
      window.location = prev;
    }
  });

  it('shows loading, then catalog + recent player reports', () => {
    const page = new LocationPage({ slug: 'area18' });
    assert.match(textOf(page.render()), /Loading location/);
    page.state.loading = false;
    page.state.detail = {
      location: {
        slug: 'area18',
        name: 'Area18',
        system: 'Stanton',
        type: 'LandingZone',
        parent: 'ArcCorp',
        quantum: true
      },
      reports: {
        playerCount: 1,
        visitCount: 2,
        recent: [{
          actor: '02' + 'ab'.repeat(32),
          nickname: 'Neorion',
          role: 'location',
          at: '2026-08-15T12:00:00.000Z',
          href: '/profiles/x'
        }]
      },
      online: []
    };
    const text = textOf(page.render());
    assert.match(text, /Area18/);
    assert.match(text, /Recent players/);
    assert.match(text, /Neorion/);
    assert.match(text, /Online now/);
    assert.ok(findType(page.render(), StarMap).length >= 1);
  });
});
