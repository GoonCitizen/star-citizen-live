'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert');

require('../helpers/installReactStub');
const { textOf, hasClass } = require('../helpers/reactTree');
const Onboarding = require('../../components/Onboarding');
const MasterSeedWizard = require('../../components/MasterSeedWizard');

describe('Master seed wizard (optional first-run)', () => {
  it('adds a wizard button on the choice screen without removing create/restore/import', () => {
    const onboarding = new Onboarding({});
    onboarding.state.step = 'choice';
    const text = textOf(onboarding.render());
    assert.match(text, /Create new identity/);
    assert.match(text, /Restore seed or xprv/);
    assert.match(text, /Load from backup file/);
    assert.match(text, /Master seed wizard/);
  });

  it('explains seed + derivation password and child xprvs on intro', () => {
    const wizard = new MasterSeedWizard({});
    wizard.state.step = 'intro';
    const text = textOf(wizard.render());
    assert.match(text, /Master seed wizard/);
    assert.match(text, /derivation password/);
    assert.match(text, /Bitcoin/);
    assert.match(text, /companion device/i);
    assert.match(text, /does not replace Create \/ Restore/);
  });

  it('setup step asks for extra devices and both passwords', () => {
    const wizard = new MasterSeedWizard({});
    wizard.state.step = 'setup';
    const text = textOf(wizard.render());
    assert.match(text, /Derivation password/);
    assert.match(text, /Unlock password for this device/);
    assert.match(text, /Extra devices/);
    assert.match(text, /Generate seed and xprvs/);
  });

  it('reveal step lists Bitcoin and device slips', () => {
    const wizard = new MasterSeedWizard({});
    wizard.state.step = 'reveal';
    wizard.state.vault = {
      mnemonic: 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about',
      bitcoin: {
        label: 'Associated Bitcoin wallet',
        path: "m/44'/0'/0'",
        xprv: 'xprv-btc',
        xpub: 'xpub-btc'
      },
      devices: [{
        label: 'This device',
        path: "m/44'/7778'/0'",
        xprv: 'xprv-dev0',
        xpub: 'xpub-dev0',
        pubkey: '02ab'
      }, {
        label: 'Companion device',
        path: "m/44'/7778'/1'",
        xprv: 'xprv-dev1',
        xpub: 'xpub-dev1',
        pubkey: '02cd'
      }]
    };
    const tree = wizard.render();
    const text = textOf(tree);
    assert.match(text, /Associated Bitcoin wallet/);
    assert.match(text, /This device/);
    assert.match(text, /Companion device/);
    assert.match(text, /Install this device/);
    assert.match(text, /Download slips/);
    assert.ok(hasClass(tree, 'msw-slip') || /m\/44'\/0'\/0'/.test(text));
  });
});
