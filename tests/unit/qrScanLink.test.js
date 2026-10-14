'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { interpretQrScan } = require('../../functions/qrScanLink');

const SID = 'aa'.repeat(24);
const HUB = 'https://relay.goon.vc';

describe('interpretQrScan', () => {
  it('accepts fabric://link from the desktop Add-a-device QR', () => {
    const url = `fabric://link?sessionId=${SID}&hub=${encodeURIComponent(HUB)}`;
    const hit = interpretQrScan(url);
    assert.equal(hit.ok, true);
    assert.equal(hit.kind, 'device-link');
    assert.equal(hit.sessionId, SID);
    assert.equal(hit.hubBase, HUB);
    assert.equal(hit.protocolUrl, url);
  });

  it('converts the HTTPS Passport landing into fabric://link', () => {
    const hit = interpretQrScan(`${HUB}/#device-link=${SID}`);
    assert.equal(hit.ok, true);
    assert.equal(hit.kind, 'device-link');
    assert.equal(hit.sessionId, SID);
    assert.match(hit.protocolUrl, /^fabric:\/\/link\?/);
    assert.match(hit.protocolUrl, new RegExp(SID));
  });

  it('rejects an empty scan', () => {
    const hit = interpretQrScan('   ');
    assert.equal(hit.ok, false);
  });

  it('rejects a random URL', () => {
    const hit = interpretQrScan('https://example.com/not-a-link');
    assert.equal(hit.ok, false);
    assert.match(hit.error, /device-link QR/i);
  });

  it('rejects fabric://link when the hub is not allowlisted', () => {
    const url = `fabric://link?sessionId=${SID}&hub=${encodeURIComponent('https://evil.example')}`;
    const hit = interpretQrScan(url);
    assert.equal(hit.ok, false);
    assert.match(String(hit.error || ''), /allowlist|hub/i);
  });
});
