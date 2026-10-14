'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { protocolQrDataUrl } = require('../../functions/protocolQr');

describe('protocolQr', () => {
  it('returns null for empty input', async () => {
    assert.equal(await protocolQrDataUrl(''), null);
    assert.equal(await protocolQrDataUrl(null), null);
  });

  it('returns a PNG data URL when qrcode is installed', async () => {
    const url = await protocolQrDataUrl('fabric://login?sessionId=ab&hub=https://relay.goon.vc');
    if (url === null) return; // optional dep missing
    assert.match(url, /^data:image\/png;base64,/);
  });
});
