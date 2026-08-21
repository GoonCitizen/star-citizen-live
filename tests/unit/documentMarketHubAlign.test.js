'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert');
const path = require('path');

function loadHubMarket () {
  const candidates = [
    path.join(__dirname, '..', '..', '..', 'hub.fabric.pub', 'functions', 'documentInventoryMarket'),
    '@fabric/hub/functions/documentInventoryMarket'
  ];
  for (const id of candidates) {
    try {
      return require(id);
    } catch (_) { /* pin or sibling missing */ }
  }
  return null;
}

describe('document market Hub helper alignment', () => {
  it('uses Hub markupListPrice so a GoonCitizen reseller stays above origin cost', () => {
    const market = loadHubMarket();
    if (!market || typeof market.markupListPrice !== 'function') {
      return;
    }
    const origin = 100;
    const listed = market.markupListPrice(origin, { markupBps: 1000, markupSats: 0 });
    assert.strictEqual(listed, 110);
    assert.ok(listed > origin);

    const decision = market.republishDecision({
      hasLocalFile: true,
      published: false,
      remoteOffers: [{ purchasePriceSats: origin }],
      policy: { republishWithMarkup: true, markupBps: 1000, markupSats: 0 }
    });
    assert.strictEqual(decision.action, 'publish');
    assert.strictEqual(decision.purchasePriceSats, 110);

    const noBlob = market.republishDecision({
      hasLocalFile: false,
      remoteOffers: [{ purchasePriceSats: origin }],
      policy: { republishWithMarkup: true, markupBps: 1000 }
    });
    assert.strictEqual(noBlob.reason, 'no-local-file');

    if (typeof market.omitPrivateMarketFields === 'function') {
      const publicRow = market.omitPrivateMarketFields({
        purchasePriceSats: listed,
        costBasisSats: origin,
        local: true
      });
      assert.strictEqual(publicRow.purchasePriceSats, 110);
      assert.strictEqual(publicRow.costBasisSats, undefined);

      const fileId = 'ab'.repeat(32);
      const map = {};
      market.replacePeerOffers(map, { peerPubkey: '02' + 'aa'.repeat(32) }, [{
        id: fileId,
        purchasePriceSats: origin,
        published: true
      }]);
      const merged = market.mergeCatalog([{
        id: fileId,
        purchasePriceSats: listed,
        costBasisSats: origin,
        published: true
      }], market.listOffers(map));
      assert.strictEqual(merged[0].purchasePriceSats, 110);
      assert.strictEqual(merged[0].bestPeerPriceSats, 100);
      assert.strictEqual(merged[0].costBasisSats, undefined);
    }
  });
});
