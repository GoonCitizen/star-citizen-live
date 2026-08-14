'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert');
const path = require('path');

function loadHubMarket () {
  const candidates = [
    '@fabric/hub/functions/documentInventoryMarket',
    path.join(__dirname, '..', '..', '..', 'hub.fabric.pub', 'functions', 'documentInventoryMarket')
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
  });
});
