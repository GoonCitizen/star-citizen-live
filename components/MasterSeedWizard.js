'use strict';

/**
 * Optional first-run wizard: one seed + derivation password (BIP39
 * passphrase) → master key, sealed here with the lock password. Every
 * account's identity, wallet, and cosigner keys come from that master.
 * Does not replace Create / Restore / Import.
 */

const React = require('react');
const { setAndroidSecureFlag } = require('../functions/androidSecureScreen');
const {
  generateVaultMnemonic,
  deriveMasterSeedVault
} = require('../functions/masterSeedVault');

const CSS = `
  .msw-steps{display:flex;gap:8px;flex-wrap:wrap;margin:0 0 14px;font-size:11.5px;color:var(--muted)}
  .msw-steps span.on{color:var(--text);font-weight:600}
  .msw-slip{background:var(--bg);border:1px solid var(--line);border-radius:8px;padding:10px 12px;margin:10px 0}
  .msw-slip h4{margin:0 0 4px;font-size:13px}
  .msw-slip .path{font-family:'Cascadia Code',Consolas,monospace;font-size:11px;color:var(--muted);margin-bottom:4px}
  .msw-secret{font-family:'Cascadia Code',Consolas,monospace;font-size:11.5px;word-break:break-all;
    background:var(--panel);border:1px solid var(--line);border-radius:6px;padding:8px 10px;margin:6px 0}
  .msw-secret.hidden{color:var(--muted);font-style:italic;font-family:'Segoe UI',system-ui,sans-serif}
`;

function identityBridge () {
  return (typeof window !== 'undefined' && window.electronAPI && window.electronAPI.identity) || null;
}

class MasterSeedWizard extends React.Component {
  constructor (props) {
    super(props);
    this.state = {
      step: 'intro', // intro | setup | reveal
      busy: false,
      error: null,
      passphrase: '',
      passphrase2: '',
      unlockPassword: '',
      unlockPassword2: '',
      vault: null,
      ackedSeed: false,
      ackedPass: false,
      showMnemonic: true
    };
  }

  componentDidMount () {
    this.syncSeedSecureFlag();
  }

  componentDidUpdate (_prevProps, prevState) {
    if (prevState.step !== this.state.step) this.syncSeedSecureFlag();
  }

  componentWillUnmount () {
    setAndroidSecureFlag(false);
  }

  syncSeedSecureFlag () {
    setAndroidSecureFlag(this.state.step === 'reveal');
  }

  passphrasesOk () {
    return this.state.passphrase.length >= 8 &&
      this.state.passphrase === this.state.passphrase2;
  }

  unlockOk () {
    return this.state.unlockPassword.length >= 8 &&
      this.state.unlockPassword === this.state.unlockPassword2 &&
      this.state.unlockPassword !== this.state.passphrase;
  }

  async generate () {
    if (!this.passphrasesOk() || !this.unlockOk()) return;
    this.setState({ busy: true, error: null });
    try {
      const vault = deriveMasterSeedVault({
        mnemonic: generateVaultMnemonic(),
        passphrase: this.state.passphrase,
        network: this.props.network
      });
      this.setState({
        busy: false,
        step: 'reveal',
        vault,
        ackedSeed: false,
        ackedPass: false,
        showMnemonic: true
      });
    } catch (e) {
      this.setState({ busy: false, error: (e && e.message) || String(e) });
    }
  }

  async install () {
    const vault = this.state.vault;
    const bridge = identityBridge();
    if (!vault || !bridge || typeof bridge.restore !== 'function') {
      this.setState({ error: 'Identity restore is not available in this session.' });
      return;
    }
    if (!this.state.ackedSeed || !this.state.ackedPass || !this.unlockOk()) return;
    this.setState({ busy: true, error: null });
    const res = await bridge.restore({
      mnemonic: vault.mnemonic,
      passphrase: this.state.passphrase,
      password: this.state.unlockPassword,
      account: vault.account,
      network: vault.network
    });
    if (res && res.error) {
      this.setState({ busy: false, error: res.error });
      return;
    }
    this.setState({
      busy: false,
      vault: null,
      passphrase: '',
      passphrase2: '',
      unlockPassword: '',
      unlockPassword2: ''
    });
    if (this.props.onInstalled) this.props.onInstalled(res.pubkey);
  }

  field (label, key, opts = {}) {
    return React.createElement('div', { className: 'ob-field', key: 'f-' + key },
      React.createElement('label', null, label),
      React.createElement('input', {
        type: 'password',
        value: this.state[key],
        placeholder: opts.placeholder || '',
        onChange: (e) => this.setState({ [key]: e.target.value, error: null })
      })
    );
  }

  renderSteps () {
    const names = [['intro', '1. Why'], ['setup', '2. Passwords'], ['reveal', '3. Seed']];
    return React.createElement('div', { className: 'msw-steps' },
      names.map(([id, label]) => React.createElement('span', {
        key: id,
        className: this.state.step === id ? 'on' : ''
      }, label))
    );
  }

  renderIntro () {
    return [
      React.createElement('h2', { key: 'h' }, 'Master seed wizard'),
      React.createElement('div', { className: 'sub', key: 's' },
        'Optional. Generate one seed and protect it with a derivation password. Together they make one master key. Your network identity, your Bitcoin wallet, and your multisig key each come from it on their own path, and switching accounts changes all three.'),
      React.createElement('div', { className: 'ob-warn', key: 'w' },
        'This machine keeps only the master key, locked with a second password. To use another device, enter the same seed and derivation password there, or give it its own seed and link the two with Add a device.'),
      React.createElement('div', { className: 'ob-actions', key: 'a' },
        React.createElement('button', {
          className: 'ob-btn',
          onClick: () => this.setState({ step: 'setup', error: null })
        }, 'Continue'),
        React.createElement('button', {
          className: 'ob-btn ghost',
          onClick: () => this.props.onBack && this.props.onBack()
        }, 'Back')
      )
    ];
  }

  renderSetup () {
    const s = this.state;
    return [
      React.createElement('h2', { key: 'h' }, 'Two passwords'),
      React.createElement('div', { className: 'sub', key: 's' },
        'The derivation password is part of your backup: the seed alone does not rebuild your keys without it. The lock password only protects the key on this device and is asked for each time GoonCitizen starts.'),
      this.field('Derivation password (min 8 characters)', 'passphrase', {
        placeholder: 'write this down with the seed'
      }),
      this.field('Confirm derivation password', 'passphrase2'),
      s.passphrase && s.passphrase2 && !this.passphrasesOk()
        ? React.createElement('div', { className: 'ob-error', key: 'pmm' },
          s.passphrase.length < 8
            ? 'Derivation password must be at least 8 characters.'
            : 'Derivation passwords do not match.')
        : null,
      this.field('Lock password for this device (min 8 characters)', 'unlockPassword', {
        placeholder: 'unlocks GoonCitizen here'
      }),
      this.field('Confirm lock password', 'unlockPassword2'),
      s.unlockPassword && s.unlockPassword2 && !this.unlockOk()
        ? React.createElement('div', { className: 'ob-error', key: 'umm' },
          s.unlockPassword.length < 8
            ? 'Lock password must be at least 8 characters.'
            : s.unlockPassword !== s.unlockPassword2
              ? 'Lock passwords do not match.'
              : 'Use a different lock password than the derivation password.')
        : null,
      React.createElement('div', { className: 'ob-actions', key: 'a' },
        React.createElement('button', {
          className: 'ob-btn',
          disabled: !this.passphrasesOk() || !this.unlockOk() || s.busy,
          onClick: () => this.generate()
        }, s.busy ? 'Deriving…' : 'Generate seed'),
        React.createElement('button', {
          className: 'ob-btn ghost',
          onClick: () => this.setState({ step: 'intro', error: null })
        }, 'Back')
      )
    ];
  }

  renderPreview (vault) {
    return React.createElement('div', { className: 'msw-slip', key: 'preview' },
      React.createElement('h4', null, 'Account ' + vault.account + ' on ' + vault.network),
      React.createElement('div', { className: 'path' }, 'Identity ' + vault.identity.path),
      React.createElement('div', { className: 'ob-pk', style: { marginTop: 0 } }, vault.identity.pubkey),
      React.createElement('div', { className: 'path' },
        'Wallet ' + vault.wallet.segwit.path + ' (SegWit) and ' + vault.wallet.standard.path),
      React.createElement('div', { className: 'path' }, 'Multisig ' + vault.cosigner.path)
    );
  }

  renderReveal () {
    const vault = this.state.vault;
    if (!vault) return null;
    const words = (vault.mnemonic || '').split(/\s+/).filter(Boolean);
    return [
      React.createElement('h2', { key: 'h' }, 'Write down the seed'),
      React.createElement('div', { className: 'sub', key: 's' },
        'Keep the seed and the derivation password together, offline. With both, any device can rebuild every account.'),
      React.createElement('div', { className: 'ob-warn', key: 'w' },
        'This phrase is shown only once. Anyone with the seed and derivation password controls your identity and your funds.'),
      this.state.showMnemonic
        ? React.createElement('div', { className: 'ob-mnemonic', key: 'm' },
          words.map((w, i) => React.createElement('span', { key: i },
            React.createElement('i', null, i + 1 + '.'), w)))
        : React.createElement('div', { className: 'msw-secret hidden', key: 'mh' },
          'Seed phrase hidden.'),
      React.createElement('div', { className: 'ob-actions', key: 'ma', style: { marginTop: 8 } },
        React.createElement('button', {
          className: 'ob-btn ghost',
          onClick: () => this.setState({ showMnemonic: !this.state.showMnemonic })
        }, this.state.showMnemonic ? 'Hide seed' : 'Show seed')
      ),
      this.renderPreview(vault),
      React.createElement('label', { className: 'ob-check', key: 'c1' },
        React.createElement('input', {
          type: 'checkbox',
          checked: this.state.ackedSeed,
          onChange: (e) => this.setState({ ackedSeed: e.target.checked })
        }),
        React.createElement('span', null, 'I wrote down the seed phrase.')
      ),
      React.createElement('label', { className: 'ob-check', key: 'c2' },
        React.createElement('input', {
          type: 'checkbox',
          checked: this.state.ackedPass,
          onChange: (e) => this.setState({ ackedPass: e.target.checked })
        }),
        React.createElement('span', null, 'I wrote down the derivation password with it.')
      ),
      React.createElement('div', { className: 'ob-actions', key: 'a' },
        React.createElement('button', {
          className: 'ob-btn',
          disabled: !this.state.ackedSeed || !this.state.ackedPass || this.state.busy,
          onClick: () => this.install()
        }, this.state.busy ? 'Installing…' : 'Use this seed here'),
        React.createElement('button', {
          className: 'ob-btn ghost',
          onClick: () => this.props.onBack && this.props.onBack()
        }, 'Cancel')
      )
    ];
  }

  render () {
    let body = null;
    if (this.state.step === 'intro') body = this.renderIntro();
    else if (this.state.step === 'setup') body = this.renderSetup();
    else if (this.state.step === 'reveal') body = this.renderReveal();
    return React.createElement(React.Fragment, null,
      this.renderSteps(),
      body,
      this.state.error
        ? React.createElement('div', { className: 'ob-error' }, this.state.error)
        : null
    );
  }
}

MasterSeedWizard.CSS = CSS;

module.exports = MasterSeedWizard;
