'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  isAndroidCompanion,
  androidSurface,
  androidDashboardTabVisible
} = require('../../functions/androidSurface');

describe('androidSurface', () => {
  it('leaves every surface on outside Android', () => {
    assert.equal(isAndroidCompanion(), false);
    assert.equal(androidSurface('wallet'), true);
    assert.equal(androidSurface('heatmap'), true);
    assert.equal(androidDashboardTabVisible('wallet'), true);
    assert.equal(androidDashboardTabVisible('groups'), true);
  });

  it('hides desktop-only tabs and Game.log / Hub Bitcoin surfaces on Android', () => {
    const prev = global.window && global.window.electronAPI;
    global.window = global.window || {};
    global.window.electronAPI = { platform: 'android' };
    try {
      assert.equal(isAndroidCompanion(), true);
      assert.equal(androidSurface('wallet'), false);
      assert.equal(androidSurface('documents'), false);
      assert.equal(androidSurface('library'), false);
      assert.equal(androidSurface('heatmap'), false);
      assert.equal(androidSurface('corpus'), false);
      assert.equal(androidSurface('discordBot'), false);
      assert.equal(androidSurface('hubObserve'), false);
      assert.equal(androidSurface('associatedFunds'), false);
      assert.equal(androidSurface('logShare'), false);
      assert.equal(androidDashboardTabVisible('wallet'), false);
      assert.equal(androidDashboardTabVisible('documents'), false);
      assert.equal(androidDashboardTabVisible('library'), false);
      assert.equal(androidDashboardTabVisible('groups'), true);
      assert.equal(androidDashboardTabVisible('chat'), true);
    } finally {
      if (global.window) global.window.electronAPI = prev;
    }
  });
});
