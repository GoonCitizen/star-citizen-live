'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert');

require('../helpers/installReactStub');
const { findByClass, collect, textOf, classList } = require('../helpers/reactTree');
const Dashboard = require('../../components/Dashboard');
const { GC_UI_RUNTIME_STATIC, GC_UI_RUNTIME_LIVE } = require('../../functions/goonCitizenClientEnvironment');

describe('Dashboard capability chrome', () => {
  it('hides Import and Settings for public visitors on liveRelay', () => {
    const dash = new Dashboard({});
    dash.state.apiRuntime = GC_UI_RUNTIME_LIVE;
    dash.state.siteToken = null;
    dash.state.identityPubkey = null;
    dash.state.online = true;
    dash.state.status = 'ok';
    dash.state.capabilityChecked = true;
    // Browser shell (no electronAPI)
    const prev = global.window && global.window.electronAPI;
    if (global.window) global.window.electronAPI = undefined;
    try {
      assert.equal(dash.isPublicVisitor(), true);
      const tree = dash.render();
      const importBtns = collect(tree, (n) => n && n.props && n.props['data-testid'] === 'gc-import-btn');
      const gear = collect(tree, (n) => n && n.props && n.props['data-testid'] === 'gc-settings-gear');
      assert.equal(importBtns.length, 0, 'visitor should hide Import');
      assert.equal(gear.length, 0, 'visitor should hide Settings gear');
      const tabs = collect(findByClass(tree, 'header-nav')[0], (n) =>
        n && n.type === 'button' && classList(n).includes('tab')).map((n) => textOf(n).trim());
      assert.ok(tabs.includes('Home'));
      assert.ok(tabs.includes('Map'));
      assert.ok(!tabs.includes('Missions'));
    } finally {
      if (global.window) global.window.electronAPI = prev;
    }
  });

  it('static client shows LiveRelay sign-in prompt on Home', () => {
    const dash = new Dashboard({});
    dash.state.apiRuntime = GC_UI_RUNTIME_STATIC;
    dash.state.tab = 'home';
    dash.state.capabilityChecked = true;
    const prev = global.window && global.window.electronAPI;
    if (global.window) global.window.electronAPI = undefined;
    try {
      const body = dash.renderTab();
      assert.equal(body.props['data-testid'], 'gc-signin-prompt');
      assert.match(textOf(body), /LiveRelay/);
    } finally {
      if (global.window) global.window.electronAPI = prev;
    }
  });

  it('authenticated siteToken keeps Import visible', () => {
    const dash = new Dashboard({});
    dash.state.apiRuntime = GC_UI_RUNTIME_LIVE;
    dash.state.siteToken = 'tok';
    dash.state.online = true;
    dash.state.status = 'ok';
    const prev = global.window && global.window.electronAPI;
    if (global.window) global.window.electronAPI = undefined;
    try {
      assert.equal(dash.isPublicVisitor(), false);
      const tree = dash.render();
      const importBtns = collect(tree, (n) => n && n.props && n.props['data-testid'] === 'gc-import-btn');
      assert.equal(importBtns.length, 1);
    } finally {
      if (global.window) global.window.electronAPI = prev;
    }
  });
});
