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
    assert.ok(body.includes('110'));
    assert.ok(!body.includes('Cost basis'));
  });

  it('does not render stuffed costBasisSats on a peer-only detail', () => {
    const view = new DocumentExchange({ documentsEnable: true });
    view.state.loading = false;
    view.state.selectedId = 'p1';
    view.state.detail = {
      local: false,
      document: {
        id: 'p1',
        name: 'ghost.txt',
        mime: 'text/plain',
        local: false,
        published: true,
        purchasePriceSats: 10,
        costBasisSats: 99999,
        contentBase64: 'AAAA'
      },
      offers: [
        { id: 'p1:ops', peerAlias: 'Ops', purchasePriceSats: 10, local: false, costBasisSats: 99999 }
      ]
    };
    const tree = view.render();
    const body = textOf(tree);
    assert.ok(body.includes('ghost.txt'));
    assert.ok(body.includes('Ops'));
    assert.ok(!body.includes('99999'));
    assert.ok(!body.includes('AAAA'));
    assert.ok(!body.includes('Cost basis'));
  });
});

describe('DocumentExchange disk upload + cluster sync', () => {
  it('shows a disk file input and enables Create when a file is selected', () => {
    const { findType } = require('../helpers/reactTree');
    const view = new DocumentExchange({ documentsEnable: true });
    view.state.loading = false;
    view.state.createOpen = true;
    let tree = view.render();
    const files = findType(tree, 'input').filter((n) => n.props && n.props.type === 'file');
    assert.strictEqual(files.length, 1);
    assert.ok(textOf(tree).includes('Choose from disk'));
    assert.ok(textOf(tree).includes('Sync to my other devices'));
    const createBtn = findType(tree, 'button').find((n) => textOf(n).includes('Create on this node'));
    assert.ok(createBtn);
    assert.strictEqual(createBtn.props.disabled, true);

    view.state.createFileBase64 = Buffer.from('from-disk', 'utf8').toString('base64');
    view.state.createFileLabel = 'brief.bin (9 bytes)';
    tree = view.render();
    const enabled = findType(tree, 'button').find((n) => textOf(n).includes('Create on this node'));
    assert.strictEqual(enabled.props.disabled, false);
    assert.ok(textOf(tree).includes('Selected: brief.bin'));
  });

  it('offers Sync on a local catalog row', () => {
    const view = new DocumentExchange({ documentsEnable: true });
    view.state.loading = false;
    view.state.documents = [
      { id: 'aa'.repeat(32), name: 'wing.txt', mime: 'text/plain', local: true, clusterSync: false }
    ];
    const tree = view.render();
    assert.ok(textOf(tree).includes('Sync to my devices'));
    assert.ok(textOf(tree).includes('Sync'));
  });
});
