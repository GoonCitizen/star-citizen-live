'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { scanQrNative } = require('../../functions/qrScanClient');

describe('scanQrNative', () => {
  it('skips when the Capacitor plugin is missing (desktop / tests)', async () => {
    const hit = await scanQrNative();
    assert.equal(hit.skipped, true);
  });
});
