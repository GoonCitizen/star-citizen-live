'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert');

require('../helpers/installReactStub');
const { textOf, findType } = require('../helpers/reactTree');
const GroupPage = require('../../components/GroupPage');
const GroupComposition = require('../../components/GroupComposition');

const ME = '02' + 'ab'.repeat(32);

describe('GroupPage dedicated share/join page', () => {
  it('reads /groups/:id from the location', () => {
    const prev = window.location;
    window.location = Object.assign({}, prev, { pathname: '/groups/salvage-wing' });
    try {
      assert.strictEqual(GroupPage.pathKeyFromLocation(), 'salvage-wing');
    } finally {
      window.location = prev;
    }
  });

  it('shows loading and a back link on error', () => {
    const page = new GroupPage({ pathKey: 'group-1' });
    assert.match(textOf(page.render()), /Loading group/);
    page.state.loading = false;
    page.state.group = null;
    page.state.error = 'Group not found';
    const err = textOf(page.render());
    assert.match(err, /Back to groups/);
    assert.match(err, /Group not found/);
  });

  it('lets a visitor apply to a public group', () => {
    const page = new GroupPage({ pathKey: 'group-1' });
    page.state.loading = false;
    page.state.pubkey = ME;
    page.state.group = {
      id: 'group-1',
      name: 'Salvage Wing',
      visibility: 'public',
      role: 'visitor',
      canApply: true,
      members: [],
      memberCount: 3,
      threshold: 2
    };
    const text = textOf(page.render());
    assert.match(text, /Salvage Wing/);
    assert.match(text, /public/);
    assert.match(text, /Share/);
    assert.match(text, /Join this group/);
    assert.match(text, /Apply to join/);
    assert.match(text, /Group chat is for members/);
    assert.doesNotMatch(text, /Create fleet/);
  });

  it('shows creator settings and dashboard manage on the dedicated page', () => {
    const page = new GroupPage({ pathKey: 'group-1' });
    page.state.loading = false;
    page.state.pubkey = ME;
    page.state.group = {
      id: 'group-1',
      name: 'Salvage Wing',
      visibility: 'public',
      role: 'creator',
      members: [ME],
      memberCount: 1,
      threshold: 1
    };
    const text = textOf(page.render());
    assert.match(text, /you are a creator/);
    assert.match(text, /Manage in dashboard/);
    assert.match(text, /Group settings/);
    assert.match(text, /Custom URL/);
    assert.match(text, /Create fleet/);
    assert.match(text, /New fleet name/);
    assert.doesNotMatch(text, /Join this group/);
  });

  it('shows owner composition of online ships and locations', () => {
    const page = new GroupPage({ pathKey: 'group-1' });
    page.state.loading = false;
    page.state.pubkey = ME;
    page.state.group = {
      id: 'group-1',
      name: 'Salvage Wing',
      visibility: 'public',
      role: 'creator',
      creator: ME,
      members: [ME],
      memberCount: 1,
      threshold: 1
    };
    page.state.presenceRoster = {
      [ME]: {
        online: true,
        nickname: 'Neorion',
        ship: { name: 'Gladius', type: 'Fighter' },
        location: { name: 'Area18', system: 'Stanton' }
      }
    };
    const tree = page.render();
    const comps = findType(tree, GroupComposition);
    assert.ok(comps.length, 'expected GroupComposition for the creator');
    const inner = new GroupComposition(comps[0].props).render();
    const text = textOf(tree) + ' ' + textOf(inner);
    assert.match(text, /Online composition/);
    assert.match(text, /Gladius/);
    assert.match(text, /Area18/);
    assert.match(textOf(tree), /online · Gladius · Area18/);
  });
});
