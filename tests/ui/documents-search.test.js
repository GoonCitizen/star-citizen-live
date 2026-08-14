'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert');

require('../helpers/installReactStub');
const { textOf, hasClass, findByClass } = require('../helpers/reactTree');
const DocumentExchange = require('../../components/DocumentExchange');
const { FABRIC_BITCOIN_BLOCK_MIME } = require('../../functions/documentSearch');

describe('DocumentExchange search controls', () => {
  it('renders type chips and filters the catalog', () => {
    const view = new DocumentExchange({ documentsEnable: true });
    view.state.documents = [
      { id: 't1', name: 'readme.txt', mime: 'text/plain', published: true, purchasePriceSats: 0 },
      { id: 'b1', name: 'block-42', mime: FABRIC_BITCOIN_BLOCK_MIME, published: true, purchasePriceSats: 10 },
      { id: 'i1', name: 'banner.png', mime: 'image/png', published: false }
    ];
    view.state.loading = false;
    let tree = view.render();
    assert.ok(hasClass(tree, 'dx-search'));
    assert.ok(textOf(tree).includes('Search name'));
    assert.ok(textOf(tree).includes('BTC blocks'));
    assert.ok(textOf(tree).includes('readme.txt'));
    assert.ok(textOf(tree).includes('block-42'));

    view.state.searchType = 'bitcoin-block';
    tree = view.render();
    const body = textOf(tree);
    assert.ok(body.includes('block-42'));
    assert.ok(!body.includes('readme.txt'));
    assert.ok(findByClass(tree, 'dx-chip').some((n) => (n.props.className || '').includes(' on')));
  });

  it('hides create until New file, lists peer files, and shows price-sorted offers', () => {
    const view = new DocumentExchange({ documentsEnable: true });
    view.state.loading = false;
    view.state.documents = [
      { id: 't1', name: 'readme.txt', mime: 'text/plain', published: true, purchasePriceSats: 0, local: true },
      {
        id: 'p1',
        name: 'wing-brief.txt',
        mime: 'text/plain',
        published: true,
        purchasePriceSats: 10,
        local: false,
        source: 'peer',
        peerAlias: 'Wing',
        peerCount: 2
      }
    ];
    let tree = view.render();
    assert.ok(textOf(tree).includes('New file'));
    assert.ok(textOf(tree).includes('Query peers'));
    assert.ok(!textOf(tree).includes('Create on this node'));
    assert.ok(textOf(tree).includes('wing-brief.txt'));
    assert.ok(textOf(tree).includes('Wing'));
    assert.ok(textOf(tree).includes('10 sats') || textOf(tree).includes('10'));

    view.state.createOpen = true;
    tree = view.render();
    assert.ok(textOf(tree).includes('Create on this node'));
    assert.ok(hasClass(tree, 'dx-create'));

    view.state.createOpen = false;
    view.state.selectedId = 'p1';
    view.state.detail = {
      local: false,
      document: {
        id: 'p1',
        name: 'wing-brief.txt',
        mime: 'text/plain',
        local: false,
        published: true,
        purchasePriceSats: 10
      },
      offers: [
        { id: 'p1:ops', peerAlias: 'Ops', purchasePriceSats: 10, local: false },
        { id: 'p1:wing', peerAlias: 'Wing', purchasePriceSats: 40, local: false }
      ]
    };
    tree = view.render();
    assert.ok(hasClass(tree, 'dx-offers'));
    const offersText = textOf(findByClass(tree, 'dx-offers')[0]);
    assert.ok(offersText.indexOf('Ops') < offersText.indexOf('Wing'));
    assert.ok(offersText.includes('lowest'));
  });

  it('shows a local listing beside cheaper peer offers (reseller catalog)', () => {
    const view = new DocumentExchange({ documentsEnable: true });
    view.state.loading = false;
    view.state.documents = [{
      id: 'p1',
      name: 'held.txt',
      mime: 'text/plain',
      published: true,
      local: true,
      source: 'local',
      purchasePriceSats: 110,
      bestPeerPriceSats: 100,
      offerCount: 2
    }];
    const tree = view.render();
    const body = textOf(tree);
    assert.ok(body.includes('held.txt'));
    assert.ok(body.includes('110') || body.includes('100'));
  });
});
