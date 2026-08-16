'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert');

require('../helpers/installReactStub');
const { textOf, findType, hasClass, findByClass } = require('../helpers/reactTree');
const Onboarding = require('../../components/Onboarding');
const Identity = require('../../components/Identity');
const Account = require('../../components/Account');
const Dashboard = require('../../components/Dashboard');
const BitcoinWalletPanel = require('../../components/BitcoinWalletPanel');

function withAndroid (fn) {
  const prev = window.electronAPI;
  window.electronAPI = Object.assign({}, prev, {
    platform: 'android',
    identity: (prev && prev.identity) || { get: async () => ({ exists: false }) }
  });
  try {
    return fn();
  } finally {
    window.electronAPI = prev;
  }
}

describe('Android first-run and account pages', () => {
  it('keeps desktop onboarding as an overlay with the original welcome', () => {
    const onboarding = new Onboarding({});
    onboarding.state.step = 'choice';
    const tree = onboarding.render();
    const text = textOf(tree);
    assert.ok(hasClass(tree, 'ob-overlay'));
    assert.match(text, /Welcome, Citizen/);
    assert.match(text, /Restore seed or xprv/);
    assert.match(text, /Master seed wizard/);
  });

  it('unlock offers destroy when an identity already exists', () => {
    withAndroid(() => {
      const onboarding = new Onboarding({});
      onboarding.state.step = 'unlock';
      onboarding.state.pubkey = '02' + 'ab'.repeat(32);
      const text = textOf(onboarding.render());
      assert.match(text, /Forget identity on this device/);
      assert.match(text, /Unlock/);
    });
  });

  it('create conflict shows forget so a stored identity can be destroyed', () => {
    withAndroid(() => {
      const onboarding = new Onboarding({});
      onboarding.state.step = 'password';
      onboarding.state.error = 'An identity already exists. Unlock it, or forget it on this device first.';
      const text = textOf(onboarding.render());
      assert.match(text, /already exists/);
      assert.match(text, /Forget identity on this device/);
    });
  });

  it('onboards with create, seed/xprv restore, and backup import', () => {
    withAndroid(() => {
      const onboarding = new Onboarding({});
      onboarding.state.step = 'choice';
      const tree = onboarding.render();
      const text = textOf(tree);
      assert.ok(hasClass(tree, 'ob-shell'));
      assert.match(text, /Welcome to GoonCitizen/);
      assert.match(text, /Create new identity/);
      assert.match(text, /Restore seed or xprv/);
      assert.match(text, /Load from backup file/);
      assert.match(text, /own node/);
    });
  });

  it('Keys page shows this device’s key without Hub Bitcoin', () => {
    withAndroid(() => {
      const identity = new Identity({ layout: 'page', section: 'keys' });
      identity.state.info = {
        exists: true,
        unlocked: true,
        pubkey: '02' + 'ab'.repeat(32),
        xpub: 'xpub1test'
      };
      const body = identity.renderBody();
      const text = textOf(body);
      assert.match(text, /This device.s key/);
      assert.doesNotMatch(text, /Associated funds/);
      assert.match(text, /pubkey \(actor id\)/);
      assert.match(text, /Forget identity on this device/);
      assert.equal(findType(body, BitcoinWalletPanel).length, 0);
    });
  });

  it('Account subnav lists Keys, Devices, Security, and Privacy', () => {
    withAndroid(() => {
      const account = new Account({
        section: 'privacy',
        onSection () {},
        onOpenSettings () {}
      });
      const tree = account.render();
      const text = textOf(tree);
      assert.match(text, /Keys/);
      assert.match(text, /Devices/);
      assert.match(text, /Security/);
      assert.match(text, /Privacy/);
      assert.match(text, /Relay & advanced/);
      assert.ok(findType(tree, Identity).length >= 1);
    });
  });

  it('Dashboard hash tabs render Account instead of the Identity overlay', () => {
    withAndroid(() => {
      const dash = new Dashboard({});
      dash.state.tab = 'keys';
      dash.state.showIdentity = false;
      const view = dash.renderTab();
      assert.ok(findType(view, Account).length >= 1);
      dash.state.tab = 'devices';
      assert.ok(findType(dash.renderTab(), Account).length >= 1);
      dash.state.tab = 'security';
      assert.ok(findType(dash.renderTab(), Account).length >= 1);
      dash.state.tab = 'privacy';
      assert.ok(findType(dash.renderTab(), Account).length >= 1);
    });
  });

  it('gear copy points at dedicated pages, not the Settings modal', () => {
    withAndroid(() => {
      const dash = new Dashboard({});
      dash.state.tab = 'home';
      dash.state.online = true;
      dash.state.status = 'ok';
      dash.state.identityExists = true;
      dash.state.identityPubkey = '02' + 'ab'.repeat(32);
      const shell = dash.render();
      assert.match(textOf(shell), /Privacy, security, keys/);
      assert.equal(dash.state.showIdentity, false);
    });
  });

  it('hides desktop-only tabs, Game.log analyze, and Hub Bitcoin on Home', () => {
    withAndroid(() => {
      const dash = new Dashboard({});
      dash.state.tab = 'home';
      dash.state.online = true;
      dash.state.status = 'ok';
      dash.state.advancedMode = true;
      const home = dash.render();
      const text = textOf(home);
      assert.ok(dash.walletVisible() === false);
      assert.ok(dash.documentsVisible() === false);
      assert.doesNotMatch(text, /My logs/);
      assert.doesNotMatch(text, /When you fly/);
      assert.doesNotMatch(text, /cumulative history from your logs/);
      assert.match(text, /this device.s node/);
      const labels = [];
      for (const btn of findByClass(home, 'tab')) {
        labels.push(textOf(btn));
      }
      assert.ok(labels.includes('Home'));
      assert.ok(labels.includes('Groups'));
      assert.ok(labels.includes('Chat'));
      assert.ok(!labels.includes('Wallet'));
      assert.ok(!labels.includes('Files'));
      assert.ok(!labels.includes('Library'));
    });
  });
});
