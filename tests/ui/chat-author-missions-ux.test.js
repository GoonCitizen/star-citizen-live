'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert');

require('../helpers/installReactStub');
const { textOf, findByClass } = require('../helpers/reactTree');
const Chat = require('../../components/Chat');
const Missions = require('../../components/Missions');

describe('Chat author labels', () => {
  it('does not duplicate short pubkey when handle is missing', () => {
    const chat = new Chat({ identityPubkey: null });
    const author = '359351ea84144200abcdef0123456789abcdef0123456789abcdef0123456789';
    const node = chat.renderAuthor(author, null);
    const text = textOf(node);
    // One short key only — not "359351ea… 359351ea…"
    assert.strictEqual((text.match(/359351ea…/g) || []).length, 1);
    assert.ok(!findByClass(node, 'key').length);
  });

  it('shows nickname plus short key when handle is set', () => {
    const chat = new Chat({ identityPubkey: null });
    const author = 'dc6142cd08a6a38535006a811541e2a534e4b38e71d97f32a7f7a75d095a1f36';
    const node = chat.renderAuthor(author, 'WATCHMAN');
    const text = textOf(node);
    assert.ok(text.includes('WATCHMAN'));
    assert.ok(text.includes('dc6142cd…'));
    assert.ok(findByClass(node, 'key').length >= 1);
  });
});

describe('Missions register UX', () => {
  it('hides cancelled missions by default and offers a show toggle', () => {
    const page = new Missions({});
    page.state.loading = false;
    page.state.missions = [
      { id: 'm-open', title: 'Live job', status: 'open', createdBy: 'aa' },
      { id: 'm-cancel', title: 'adv-fake', status: 'cancelled', createdBy: null }
    ];
    page.state.showCancelled = false;
    let tree = page.render();
    let text = textOf(tree);
    assert.ok(text.includes('Live job'));
    assert.ok(!text.includes('adv-fake'));
    assert.ok(text.includes('Show cancelled (1)'));

    page.state.showCancelled = true;
    tree = page.render();
    text = textOf(tree);
    assert.ok(text.includes('adv-fake'));
    assert.ok(text.includes('Hide cancelled (1)'));
  });

  it('filters posted vs Game.log sources', () => {
    const page = new Missions({});
    page.state.loading = false;
    page.state.missions = [
      { id: 'p1', title: 'Posted bounty', status: 'open', createdBy: 'aa' },
      {
        id: 'uuid-1',
        title: 'Foxwell patrol',
        status: 'in_progress',
        source: 'gamelog',
        generator: 'Foxwell_Generator'
      }
    ];
    page.state.sourceFilter = 'gamelog';
    let text = textOf(page.render());
    assert.ok(text.includes('Foxwell patrol'));
    assert.ok(!text.includes('Posted bounty'));
    assert.ok(text.includes('From log (1)'));

    page.state.sourceFilter = 'posted';
    text = textOf(page.render());
    assert.ok(text.includes('Posted bounty'));
    assert.ok(!text.includes('Foxwell patrol'));
  });

  it('filters My missions and shows submit completion for the creator', () => {
    const me = '02aa'.padEnd(66, 'a');
    const page = new Missions({ identityPubkey: me });
    page.state.loading = false;
    page.state.pubkey = me;
    page.state.missions = [
      {
        id: 'mine-1',
        title: 'Escort the Hull-C',
        status: 'open',
        createdBy: me,
        authorities: { keys: [me], threshold: 1 },
        participantIds: []
      },
      { id: 'other-1', title: 'Someone else', status: 'open', createdBy: 'zz' }
    ];
    page.state.sourceFilter = 'mine';
    let text = textOf(page.render());
    assert.ok(text.includes('My missions (1)'));
    assert.ok(text.includes('Escort the Hull-C'));
    assert.ok(!text.includes('Someone else'));
    assert.ok(text.includes('✔ Submit completion'));

    page.state.claims = [{
      id: 'c1',
      missionId: 'mine-1',
      claimantId: me,
      note: 'cargo delivered',
      status: 'pending'
    }];
    text = textOf(page.render());
    assert.ok(text.includes('Review completions'));
    assert.ok(text.includes('cargo delivered'));
    assert.ok(text.includes('Approve'));
    assert.ok(text.includes('Reject'));
  });
});
