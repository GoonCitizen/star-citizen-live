'use strict';

/**
 * Optional first-run wizard: one seed + derivation password → Bitcoin xprv
 * and per-device identity xprvs. Does not replace Create / Restore / Import.
 */

const React = require('react');
const {
  MAX_EXTRA_DEVICES,
  generateVaultMnemonic,
  deriveMasterSeedVault,
  formatVaultSlips
} = require('../functions/masterSeedVault');

const CSS = `
  .msw-steps{display:flex;gap:8px;flex-wrap:wrap;margin:0 0 14px;font-size:11.5px;color:var(--muted)}
  .msw-steps span.on{color:var(--text);font-weight:600}
  .msw-slip{background:var(--bg);border:1px solid var(--line);border-radius:8px;padding:10px 12px;margin:10px 0}
  .msw-slip h4{margin:0 0 4px;font-size:13px}
  .msw-slip .path{font-family:'Cascadia Code',Consolas,monospace;font-size:11px;color:var(--muted);margin-bottom:8px}
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
      notice: null,
      passphrase: '',
      passphrase2: '',
      extraDevices: 1,
      unlockPassword: '',
      unlockPassword2: '',
      vault: null,
      ackedSeed: false,
      ackedPass: false,
      showMnemonic: true,
      showSecrets: {},
      copied: null
    };
  }

  passphrasesOk () {
    return this.state.passphrase.length >= 8 &&
      this.state.passphrase === this.state.passphrase2;
  }

  unlockOk () {
    return this.state.unlockPassword.length >= 8 &&
      this.state.unlockPassword === this.state.unlockPassword2;
  }

  async generate () {
    if (!this.passphrasesOk() || !this.unlockOk()) return;
    this.setState({ busy: true, error: null });
    try {
      const mnemonic = generateVaultMnemonic();
      const vault = deriveMasterSeedVault({
        mnemonic,
        passphrase: this.state.passphrase,
        extraDevices: this.state.extraDevices
      });
      this.setState({
        busy: false,
        step: 'reveal',
        vault,
        ackedSeed: false,
        ackedPass: false,
        showMnemonic: true,
        showSecrets: {}
      });
    } catch (e) {
      this.setState({ busy: false, error: (e && e.message) || String(e) });
    }
  }

  copy (text, key) {
    const value = String(text || '');
    if (!value) return;
    const done = () => this.setState({ copied: key, notice: 'Copied.' });
    try {
      if (typeof navigator !== 'undefined' && navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(value).then(done).catch(() => {
          this.setState({ error: 'Could not copy to clipboard.' });
        });
        return;
      }
    } catch (_) { /* fall through */ }
    done();
  }

  downloadSlips () {
    const vault = this.state.vault;
    if (!vault) return;
    const body = formatVaultSlips(vault);
    try {
      const blob = new Blob([body], { type: 'text/plain' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'gooncitizen-vault-slips.txt';
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1500);
    } catch (e) {
      this.setState({ error: (e && e.message) || 'Could not download slips.' });
    }
  }

  async installFirstDevice () {
    const vault = this.state.vault;
    const first = vault && vault.devices && vault.devices[0];
    const bridge = identityBridge();
    if (!first || !bridge || typeof bridge.restore !== 'function') {
      this.setState({ error: 'Identity restore is not available in this session.' });
      return;
    }
    if (!this.state.ackedSeed || !this.state.ackedPass || !this.unlockOk()) return;
    this.setState({ busy: true, error: null });
    const res = await bridge.restore({
      xprv: first.xprv,
      password: this.state.unlockPassword
    });
    if (res && res.error) {
      this.setState({ busy: false, error: res.error });
      return;
    }
    this.setState({ busy: false });
    if (this.props.onInstalled) this.props.onInstalled(res.pubkey);
  }

  toggleSecret (key) {
    this.setState((s) => ({
      showSecrets: Object.assign({}, s.showSecrets, { [key]: !s.showSecrets[key] })
    }));
  }

  field (label, key, opts = {}) {
    return React.createElement('div', { className: 'ob-field' },
      React.createElement('label', null, label),
      React.createElement('input', {
        type: opts.type || 'password',
        value: this.state[key],
        placeholder: opts.placeholder || '',
        min: opts.min,
        max: opts.max,
        onChange: (e) => {
          const raw = e.target.value;
          this.setState({
            [key]: opts.number ? Number(raw) : raw,
            error: null,
            notice: null
          });
        }
      })
    );
  }

  renderSteps () {
    const names = [['intro', '1. Why'], ['setup', '2. Passwords'], ['reveal', '3. Export']];
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
        'Optional. Generate one seed, then a password-derived master xprv, then child xprvs: Bitcoin funds, this device’s identity, and optionally a companion device (or more). Each child stays online if another device is lost. Emergency recovery is the seed plus the derivation password — not every machine’s copy of the seed.'),
      React.createElement('div', { className: 'ob-warn', key: 'w' },
        'This does not replace Create / Restore. The wizard only prepares slips. This machine stores the first-device xprv, never the master seed.'),
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
    const extra = this.state.extraDevices;
    return [
      React.createElement('h2', { key: 'h' }, 'Passwords and devices'),
      React.createElement('div', { className: 'sub', key: 's' },
        'The derivation password is part of the physical backup (BIP39 passphrase). The unlock password only encrypts this device’s child xprv on disk — same as a normal restore.'),
      this.field('Derivation password (min 8 characters)', 'passphrase', {
        placeholder: 'used with the seed to rebuild every child'
      }),
      this.field('Confirm derivation password', 'passphrase2'),
      this.state.passphrase && this.state.passphrase2 && !this.passphrasesOk()
        ? React.createElement('div', { className: 'ob-error', key: 'pmm' },
          this.state.passphrase.length < 8
            ? 'Derivation password must be at least 8 characters.'
            : 'Derivation passwords do not match.')
        : null,
      React.createElement('div', { className: 'ob-field', key: 'n' },
        React.createElement('label', null, 'Extra devices besides this one (0–' + MAX_EXTRA_DEVICES + ')'),
        React.createElement('input', {
          type: 'number',
          min: 0,
          max: MAX_EXTRA_DEVICES,
          value: extra,
          onChange: (e) => {
            const n = Math.max(0, Math.min(MAX_EXTRA_DEVICES, Math.floor(Number(e.target.value) || 0)));
            this.setState({ extraDevices: n });
          }
        }),
        React.createElement('div', { className: 'sub', style: { margin: '6px 0 0' } },
          extra === 0
            ? 'Bitcoin wallet + this device only.'
            : extra === 1
              ? 'Will also export a companion-device xprv.'
              : 'Will export this device plus ' + extra + ' other device xprvs.')
      ),
      this.field('Unlock password for this device (min 8 characters)', 'unlockPassword', {
        placeholder: 'encrypts the first-device xprv here'
      }),
      this.field('Confirm unlock password', 'unlockPassword2'),
      this.state.unlockPassword && this.state.unlockPassword2 && !this.unlockOk()
        ? React.createElement('div', { className: 'ob-error', key: 'umm' },
          this.state.unlockPassword.length < 8
            ? 'Unlock password must be at least 8 characters.'
            : 'Unlock passwords do not match.')
        : null,
      React.createElement('div', { className: 'ob-actions', key: 'a' },
        React.createElement('button', {
          className: 'ob-btn',
          disabled: !this.passphrasesOk() || !this.unlockOk() || this.state.busy,
          onClick: () => this.generate()
        }, this.state.busy ? 'Deriving…' : 'Generate seed and xprvs'),
        React.createElement('button', {
          className: 'ob-btn ghost',
          onClick: () => this.setState({ step: 'intro', error: null })
        }, 'Back')
      )
    ];
  }

  renderSlip (slip, secretKey) {
    const shown = this.state.showSecrets[secretKey] === true;
    return React.createElement('div', { className: 'msw-slip', key: secretKey },
      React.createElement('h4', null, slip.label),
      React.createElement('div', { className: 'path' }, slip.path),
      slip.pubkey
        ? React.createElement('div', { className: 'ob-pk', style: { marginTop: 0 } },
          'pubkey: ' + slip.pubkey)
        : null,
      React.createElement('div', { className: 'msw-secret' + (shown ? '' : ' hidden') },
        shown ? slip.xprv : 'xprv hidden — show to copy'),
      React.createElement('div', { className: 'ob-actions', style: { marginTop: 8 } },
        React.createElement('button', {
          className: 'ob-btn ghost',
          onClick: () => this.toggleSecret(secretKey)
        }, shown ? 'Hide xprv' : 'Show xprv'),
        React.createElement('button', {
          className: 'ob-btn ghost',
          disabled: !shown,
          onClick: () => this.copy(slip.xprv, secretKey)
        }, this.state.copied === secretKey ? 'Copied' : 'Copy xprv'),
        slip.xpub
          ? React.createElement('button', {
            className: 'ob-btn ghost',
            onClick: () => this.copy(slip.xpub, secretKey + '-xpub')
          }, this.state.copied === secretKey + '-xpub' ? 'Copied xpub' : 'Copy xpub')
          : null
      )
    );
  }

  renderReveal () {
    const vault = this.state.vault;
    if (!vault) return null;
    const words = (vault.mnemonic || '').split(/\s+/).filter(Boolean);
    return [
      React.createElement('h2', { key: 'h' }, 'Write down the seed, then export xprvs'),
      React.createElement('div', { className: 'sub', key: 's' },
        'The seed plus the derivation password rebuild every child. Copy the Bitcoin xprv and each device xprv onto separate slips. Restore other apps with that device’s xprv — not this seed.'),
      React.createElement('div', { className: 'ob-warn', key: 'w' },
        'This phrase is shown only once here. Anyone with the seed and derivation password can rebuild Bitcoin and every device.'),
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
      this.renderSlip(vault.bitcoin, 'btc'),
      vault.devices.map((d, i) => this.renderSlip(d, 'dev-' + i)),
      React.createElement('div', { className: 'ob-actions', key: 'dl' },
        React.createElement('button', {
          className: 'ob-btn ghost',
          onClick: () => this.downloadSlips()
        }, 'Download slips…')
      ),
      React.createElement('label', { className: 'ob-check', key: 'c1' },
        React.createElement('input', {
          type: 'checkbox',
          checked: this.state.ackedSeed,
          onChange: (e) => this.setState({ ackedSeed: e.target.checked })
        }),
        React.createElement('span', null, 'I wrote down the seed phrase and will not store it on every device.')
      ),
      React.createElement('label', { className: 'ob-check', key: 'c2' },
        React.createElement('input', {
          type: 'checkbox',
          checked: this.state.ackedPass,
          onChange: (e) => this.setState({ ackedPass: e.target.checked })
        }),
        React.createElement('span', null, 'I wrote down the derivation password with the seed.')
      ),
      React.createElement('div', { className: 'ob-actions', key: 'a' },
        React.createElement('button', {
          className: 'ob-btn',
          disabled: !this.state.ackedSeed || !this.state.ackedPass || this.state.busy,
          onClick: () => this.installFirstDevice()
        }, this.state.busy ? 'Installing…' : 'Install this device'),
        React.createElement('button', {
          className: 'ob-btn ghost',
          onClick: () => this.props.onBack && this.props.onBack()
        }, 'Skip install — back to setup')
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
        : null,
      this.state.notice
        ? React.createElement('div', { className: 'ob-pk' }, this.state.notice)
        : null
    );
  }
}

MasterSeedWizard.CSS = CSS;

module.exports = MasterSeedWizard;
