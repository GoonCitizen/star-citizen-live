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

  it('restore asks for the derivation password with a seed phrase, not with an xprv', () => {
    const onboarding = new Onboarding({});
    onboarding.state.step = 'restore';
    assert.match(textOf(onboarding.render()), /Derivation password/);
    onboarding.state.restoreWords = 'xprv9s21ZrQH143K';
    assert.doesNotMatch(textOf(onboarding.render()), /Derivation password/);
  });

  it('intro explains one master key and how a second device joins', () => {
    const wizard = new MasterSeedWizard({});
    wizard.state.step = 'intro';
    const text = textOf(wizard.render());
    assert.match(text, /Master seed wizard/);
    assert.match(text, /derivation password/);
    assert.match(text, /Bitcoin wallet/);
    assert.match(text, /same seed and derivation password/);
    assert.match(text, /Add a device/);
    assert.doesNotMatch(text, /xprv/);
  });

  it('setup asks for the derivation password and the lock password', () => {
    const wizard = new MasterSeedWizard({});
    wizard.state.step = 'setup';
    const text = textOf(wizard.render());
    assert.match(text, /Derivation password/);
    assert.match(text, /Lock password for this device/);
    assert.doesNotMatch(text, /Extra devices/);
    assert.match(text, /Generate seed/);
  });

  it('refuses the same password for both', () => {
    const wizard = new MasterSeedWizard({});
    wizard.state.passphrase = wizard.state.passphrase2 = 'same-password';
    wizard.state.unlockPassword = wizard.state.unlockPassword2 = 'same-password';
    assert.equal(wizard.unlockOk(), false);
    wizard.state.unlockPassword = wizard.state.unlockPassword2 = 'other-password';
    assert.equal(wizard.unlockOk(), true);
  });

  it('reveal shows the seed and the account paths, never a private key', () => {
    const wizard = new MasterSeedWizard({});
    wizard.state.step = 'reveal';
    wizard.state.vault = {
      mnemonic: 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about',
      network: 'regtest',
      account: 0,
      identity: { path: "m/44'/7778'/0'/0/0", pubkey: '02ab' },
      wallet: {
        segwit: { path: "m/84'/1'/0'", xpub: 'tpub-segwit' },
        standard: { path: "m/44'/1'/0'", xpub: 'tpub-standard' },
        receive: 'segwit'
      },
      cosigner: { path: "m/87'/1'/0'/0/0", pubkey: '03cd' }
    };
    const tree = wizard.render();
    const text = textOf(tree);
    assert.match(text, /Account 0 on regtest/);
    assert.match(text, /m\/84'\/1'\/0'/);
    assert.match(text, /m\/87'\/1'\/0'\/0\/0/);
    assert.match(text, /Use this seed here/);
    assert.doesNotMatch(text, /Download slips|xprv/);
    assert.ok(hasClass(tree, 'msw-slip'));
  });

  it('installs by restoring the seed with both passwords through the bridge', async () => {
    const calls = [];
    global.window = { electronAPI: { identity: { restore: async (o) => { calls.push(o); return { pubkey: '02ab' }; } } } };
    try {
      let installed = null;
      const wizard = new MasterSeedWizard({ onInstalled: (pk) => { installed = pk; } });
      wizard.setState = (patch) => Object.assign(wizard.state, typeof patch === 'function' ? patch(wizard.state) : patch);
      Object.assign(wizard.state, {
        vault: { mnemonic: 'm', account: 0, network: 'regtest' },
        passphrase: 'derive-pass',
        passphrase2: 'derive-pass',
        unlockPassword: 'lock-pass-1',
        unlockPassword2: 'lock-pass-1',
        ackedSeed: true,
        ackedPass: true
      });
      await wizard.install();
      assert.deepEqual(calls, [{ mnemonic: 'm', passphrase: 'derive-pass', password: 'lock-pass-1', account: 0, network: 'regtest' }]);
      assert.equal(installed, '02ab');
      assert.equal(wizard.state.passphrase, '');
    } finally {
      delete global.window;
    }
  });
});
