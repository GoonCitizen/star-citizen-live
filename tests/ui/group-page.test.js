'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert');

require('../helpers/installReactStub');
const { textOf, findType, findByClass } = require('../helpers/reactTree');
const GroupPage = require('../../components/GroupPage');
const GroupComposition = require('../../components/GroupComposition');
const StarMap = require('../../components/StarMap');
const Chat = require('../../components/Chat');
const { JoinVoiceButton } = require('../../components/ActiveVoicePanel');

const ME = '02' + 'ab'.repeat(32);
const OTHER = '03' + 'cd'.repeat(32);

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
      creator: ME,
      contractId: 'ab'.repeat(32),
      members: [],
      validators: [ME, OTHER],
      signerCount: 2,
      memberCount: 3,
      threshold: 2,
      createdAt: '2026-08-01T00:00:00.000Z',
      path: '/groups/salvage-wing'
    };
    const tree = page.render();
    const text = textOf(tree);
    assert.ok(findByClass(tree, 'gcs').length, 'expected contract summary');
    assert.ok(findByClass(tree, 'gpage-rail').length, 'expected members rail');
    assert.match(text, /Salvage Wing/);
    assert.match(text, /public/);
    assert.match(text, /Share/);
    assert.match(text, /Join this group/);
    assert.match(text, /Apply to join/);
    assert.match(text, /Group chat is for members/);
    assert.match(text, /Publisher/);
    assert.match(text, /Created/);
    assert.match(text, /Signers/);
    assert.match(text, /2-of-2/);
    assert.match(text, /3 members/);
    assert.doesNotMatch(text, /Current validators/);
    assert.doesNotMatch(text, /Create fleet/);
    assert.strictEqual(findType(tree, JoinVoiceButton).length, 0);
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
      creator: ME,
      contractId: 'cd'.repeat(32),
      members: [ME],
      validators: [ME],
      memberCount: 1,
      signerCount: 1,
      threshold: 1,
      createdAt: '2026-08-01T00:00:00.000Z',
      path: '/groups/group-1'
    };
    const tree = page.render();
    const text = textOf(tree);
    assert.ok(findByClass(tree, 'gpage-rail').length, 'expected members rail');
    assert.ok(findType(tree, Chat).some((n) => n.props && n.props.peopleOnly),
      'expected Chat people rail');
    assert.match(text, /you are a creator/);
    assert.match(text, /Manage in dashboard/);
    const join = findType(tree, JoinVoiceButton);
    assert.ok(join.length >= 1);
    assert.strictEqual(join[0].props.groupId, 'group-1');
    assert.match(textOf(new JoinVoiceButton(join[0].props).render()), /Join voice/);
    assert.match(text, /Group settings/);
    assert.match(text, /Custom URL/);
    assert.match(text, /Create fleet/);
    assert.match(text, /New fleet name/);
    assert.match(text, /Publisher/);
    assert.match(text, /Created/);
    assert.match(text, /Signers/);
    assert.match(text, /Send invite/);
    assert.doesNotMatch(text, /Current validators/);
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
  });

  it('summarizes online players per system next to Hotspots', () => {
    const CARA = '02' + 'ef'.repeat(32);
    const page = new GroupPage({ pathKey: 'group-1' });
    page.state.loading = false;
    page.state.pubkey = ME;
    page.state.group = {
      id: 'group-1',
      name: 'Salvage Wing',
      visibility: 'public',
      role: 'creator',
      creator: ME,
      members: [ME, CARA],
      memberCount: 2,
      threshold: 1
    };
    page.state.presenceRoster = {
      [ME]: {
        online: true,
        nickname: 'Neorion',
        ship: { name: 'Gladius', type: 'Fighter' },
        location: { name: 'Area18', system: 'Stanton' }
      },
      [CARA]: {
        online: true,
        nickname: 'Cara',
        location: { name: 'Ruin Station', system: 'Pyro' }
      }
    };
    const comps = findType(page.render(), GroupComposition);
    assert.ok(comps.length, 'expected GroupComposition');
    const inner = new GroupComposition(Object.assign({}, comps[0].props, { showMap: true })).render();
    const maps = findType(inner, StarMap);
    assert.ok(maps.length, 'expected StarMap on composition');
    const mapText = textOf(new StarMap(maps[0].props).render());
    assert.match(mapText, /Hotspots/);
    assert.match(mapText, /1 Stanton · 1 Pyro/);
  });

  it('member hover card offers Message, Profile, and Invite', () => {
    const chat = new Chat({
      groupId: 'group-1',
      peopleOnly: true,
      identityPubkey: ME
    });
    chat.state.loading = false;
    chat.state.members = [
      { pubkey: ME, handle: 'Neorion', online: true, role: 'creator' },
      { pubkey: OTHER, handle: 'Cara', online: false, role: 'signer' }
    ];
    chat.state.hoverPubkey = OTHER;
    const tree = chat.render();
    assert.ok(findByClass(tree, 'chat-people-only').length);
    assert.ok(findByClass(tree, 'chat-mem-card').length, 'expected hover card');
    const text = textOf(tree);
    assert.match(text, /Cara/);
    assert.match(text, /Message/);
    assert.match(text, /Profile/);
    assert.match(text, /Invite to group/);
  });
});
