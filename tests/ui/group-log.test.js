'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert');

require('../helpers/installReactStub');
const { textOf, findByClass } = require('../helpers/reactTree');
const Groups = require('../../components/Groups');

const ME = '02' + 'ab'.repeat(32);

describe('Groups log Data / Fabric', () => {
  it('exposes Data and Fabric controls on journal rows', () => {
    const page = new Groups({ identityPubkey: ME });
    page.state.loading = false;
    page.state.pubkey = ME;
    page.state.groups = [{
      id: 'group-1',
      name: 'Salvage Wing',
      creator: ME,
      members: [ME],
      threshold: 1,
      visibility: 'public'
    }];
    page.state.selectedId = 'group-1';
    page.state.detailTab = 'log';
    page.state.groupJournal = [{
      id: 'gchg-1',
      type: 'GroupChange',
      acceptedAt: '2026-08-13T12:00:00.000Z',
      message: { action: 'member.add', member: ME },
      fabricMessage: { hash: 'deadbeef', hex: '00', type: 'GroupChange' }
    }, {
      id: 'gchg-2',
      type: 'FleetShare',
      acceptedAt: '2026-08-13T12:01:00.000Z',
      message: { name: 'Permafleet' }
    }];
    const tree = page.render();
    const text = textOf(tree);
    assert.match(text, /Member added/);
    assert.match(text, /Fleet shared/);
    assert.match(text, /Data/);
    assert.match(text, /Fabric/);
    const fabricLinks = findByClass(tree, 'gp-btn').filter((n) => n.type === 'a' ||
      (n.props && n.props.href && String(n.props.href).includes('fabric-message')));
    assert.ok(fabricLinks.some((n) => String(n.props.href).includes('/collections/fabric-message/')));
    page.state.logOpenId = 'gchg-1';
    const open = page.render();
    assert.match(textOf(open), /member\.add/);
    assert.match(textOf(open), /deadbeef/);
  });
});
