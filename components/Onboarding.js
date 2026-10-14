'use strict';

/**
 * First-run identity onboarding for GoonCitizen (desktop and Android).
 *
 * Shown when the identity bridge reports no stored identity (or a locked
 * one). Creates or restores a BIP39 identity via `window.electronAPI.identity`
 * (Electron IPC, or the Android Capacitor polyfill). The mnemonic is displayed
 * exactly once for backup. Pure browser sessions without a local node skip
 * onboarding entirely.
 */

const React = require('react');
const { isAndroidCompanion } = require('../functions/isAndroidCompanion');
const { setAndroidSecureFlag } = require('../functions/androidSecureScreen');
const MasterSeedWizard = require('./MasterSeedWizard');

const CSS = `
  .ob-overlay{position:fixed;inset:0;z-index:50;background:rgba(8,10,14,.88);
    display:flex;align-items:center;justify-content:center;backdrop-filter:blur(3px)}
  .ob-card{background:var(--panel);border:1px solid var(--line);border-radius:12px;
    width:min(560px,92vw);max-height:88vh;overflow:auto;padding:26px 30px}
  .ob-card h2{margin:0 0 4px;font-size:19px}
  .ob-card .sub{color:var(--muted);font-size:13px;margin-bottom:18px}
  .ob-field{margin:12px 0}
  .ob-field label{display:block;font-size:12px;color:var(--muted);margin-bottom:5px}
  .ob-field input,.ob-field textarea{width:100%;background:var(--bg);border:1px solid var(--line);
    color:var(--text);border-radius:7px;padding:9px 11px;font-size:13.5px}
  .ob-field textarea{min-height:74px;font-family:'Cascadia Code',Consolas,monospace;resize:vertical}
  .ob-actions{display:flex;gap:10px;margin-top:18px;flex-wrap:wrap}
  .ob-btn{background:var(--accent);border:none;color:#fff;border-radius:7px;
    padding:9px 18px;font-size:13.5px;font-weight:600;cursor:pointer}
  .ob-btn:disabled{opacity:.45;cursor:default}
  .ob-btn.ghost{background:var(--panel2);border:1px solid var(--line);color:var(--text)}
  .ob-error{background:rgba(248,81,73,.12);color:var(--kill);border-radius:7px;
    padding:9px 12px;font-size:13px;margin-top:12px}
  .ob-mnemonic{display:grid;grid-template-columns:repeat(3,1fr);gap:7px;margin:14px 0;
    font-family:'Cascadia Code',Consolas,monospace;font-size:13px}
  .ob-mnemonic span{background:var(--bg);border:1px solid var(--line);border-radius:6px;
    padding:7px 9px}
  .ob-mnemonic i{color:var(--muted);font-style:normal;margin-right:6px;font-size:11px}
  .ob-warn{background:rgba(210,153,34,.12);color:var(--warn);border-radius:7px;
    padding:10px 12px;font-size:12.5px;line-height:1.5}
  .ob-check{display:flex;gap:8px;align-items:flex-start;margin-top:14px;font-size:13px;cursor:pointer}
  .ob-pk{font-family:'Cascadia Code',Consolas,monospace;font-size:11.5px;color:var(--muted);
    word-break:break-all;margin-top:10px}
  .ob-shell{position:fixed;inset:0;z-index:50;background:var(--bg);overflow:auto;
    padding:max(20px, env(safe-area-inset-top)) 18px max(28px, env(safe-area-inset-bottom))}
  .ob-btn.danger{background:var(--kill,#c62828);color:#fff}
  .ob-btn.danger:disabled{opacity:.45;cursor:default}
  .ob-destroy{margin-top:18px;padding-top:14px;border-top:1px solid var(--line)}
`;

function identityBridge () {
  return (typeof window !== 'undefined' && window.electronAPI && window.electronAPI.identity) || null;
}

class Onboarding extends React.Component {
  constructor (props) {
    super(props);
    this.state = {
      step: 'loading', // loading | choice | password | backup | restore | import | unlock | wizard | done
      busy: false,
      error: null,
      password: '',
      password2: '',
      mnemonic: null, // shown once after create
      restoreWords: '',
      acked: false,
      pubkey: null,
      importPassword: '',
      confirmForget: false,
      forgetText: ''
    };
    this._unsub = null;
    this._passwordRef = null;
  }

  componentDidMount () {
    const bridge = identityBridge();
    if (!bridge) {
      this.finish(null);
      return;
    }
    bridge.get().then((info) => {
      if (!info || !info.exists) {
        this.setState({ step: 'choice' });
      } else if (info.unlocked) {
        this.finish(info.pubkey);
      } else {
        this.setState({ step: 'unlock', pubkey: info.pubkey || null });
      }
    }).catch(() => this.setState({ step: 'choice' }));

    // Auto-lock / manual lock: re-open the same full-screen unlock as first launch.
    if (bridge.onChanged) {
      this._unsub = bridge.onChanged((summary) => {
        if (!summary || !summary.exists) {
          if (this.state.step === 'done' || this.state.step === 'unlock') {
            this.setState({
              step: 'choice',
              password: '',
              error: null,
              pubkey: null,
              busy: false
            });
          }
          return;
        }
        if (!summary.unlocked) {
          // Only reset the form when entering unlock from another step —
          // never clear password while the user is typing.
          if (this.state.step !== 'unlock') {
            this.setState({
              step: 'unlock',
              password: '',
              error: null,
              busy: false,
              pubkey: summary.pubkey || this.state.pubkey || null
            });
            if (this.props.onLocked) this.props.onLocked();
          } else if (this.props.onLocked) {
            this.props.onLocked();
          }
          return;
        }
        if (this.state.step === 'unlock' || this.state.step === 'loading') {
          this.finish(summary.pubkey);
        }
      });
    }
  }

  componentDidUpdate (_prevProps, prevState) {
    if (this.state.step !== prevState.step &&
      (this.state.step === 'unlock' || this.state.step === 'password' || this.state.step === 'restore')) {
      this.focusPasswordField();
    }
    if (this.state.step !== prevState.step) {
      setAndroidSecureFlag(this.state.step === 'backup');
    }
  }

  componentWillUnmount () {
    setAndroidSecureFlag(false);
    if (this._unsub) this._unsub();
  }

  focusPasswordField () {
    // Focus once when the step opens — do not select() on every render
    // (that replaces the whole value with the next keypress).
    const focus = () => {
      if (this._passwordRef && typeof this._passwordRef.focus === 'function') {
        this._passwordRef.focus();
      }
    };
    if (typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(() => setTimeout(focus, 0));
    } else {
      setTimeout(focus, 0);
    }
  }

  finish (pubkey, meta) {
    this.setState({ step: 'done', pubkey, password: '', error: null, busy: false });
    if (this.props.onReady) this.props.onReady(pubkey, meta || null);
  }

  passwordsOk () {
    return this.state.password.length >= 8 && this.state.password === this.state.password2;
  }

  async create () {
    if (!this.passwordsOk()) return;
    this.setState({ busy: true, error: null });
    const res = await identityBridge().create(this.state.password);
    if (res.error) {
      const next = { busy: false, error: res.error };
      if (res.exists) next.step = 'unlock';
      this.setState(next, () => this.refreshPubkey());
      return;
    }
    this.setState({ busy: false, step: 'backup', mnemonic: res.mnemonic, pubkey: res.pubkey, acked: false });
  }

  async restore () {
    if (!this.passwordsOk() || !this.state.restoreWords.trim()) return;
    this.setState({ busy: true, error: null });
    const words = this.state.restoreWords.trim().replace(/\s+/g, ' ');
    const opts = words.startsWith('xprv')
      ? { xprv: words, password: this.state.password }
      : { mnemonic: words, password: this.state.password };
    const res = await identityBridge().restore(opts);
    if (res.error) {
      this.setState({ busy: false, error: res.error });
      return;
    }
    this.finish(res.pubkey, { firstRun: true });
  }

  async unlock () {
    if (!this.state.password) return;
    this.setState({ busy: true, error: null });
    const res = await identityBridge().unlock(this.state.password);
    if (res.error) {
      this.setState({ busy: false, error: res.error });
      return;
    }
    this.finish(res.pubkey);
  }

  refreshPubkey () {
    const bridge = identityBridge();
    if (!bridge || typeof bridge.get !== 'function') return;
    bridge.get().then((info) => {
      if (info && info.pubkey) this.setState({ pubkey: info.pubkey });
    }).catch(() => {});
  }

  async forget () {
    if (this.state.forgetText !== 'forget') return;
    const bridge = identityBridge();
    if (!bridge || typeof bridge.forget !== 'function') return;
    this.setState({ busy: true, error: null });
    const res = await bridge.forget(true);
    if (res && res.error) {
      this.setState({ busy: false, error: res.error });
      return;
    }
    this.setState({
      busy: false,
      step: 'choice',
      confirmForget: false,
      forgetText: '',
      password: '',
      password2: '',
      pubkey: null,
      mnemonic: null,
      error: null
    });
  }

  showDestroy () {
    if (this.state.step === 'unlock') return true;
    return /already exists/i.test(String(this.state.error || ''));
  }

  renderDestroy () {
    if (!this.showDestroy()) return null;
    const android = isAndroidCompanion();
    return React.createElement('div', { className: 'ob-destroy', key: 'destroy' },
      !this.state.confirmForget
        ? React.createElement('button', {
          className: 'ob-btn ghost',
          onClick: () => this.setState({ confirmForget: true, forgetText: '', error: null })
        }, android ? 'Forget identity on this device…' : 'Forget identity on this machine…')
        : React.createElement(React.Fragment, null,
          React.createElement('div', { className: 'ob-warn' },
            android
              ? 'This deletes the encrypted key from this device. Restore later with your seed phrase or a backup file — if you have neither, this identity is gone.'
              : 'This deletes the encrypted key file from this machine. Restore later with your seed phrase or a backup file.'),
          React.createElement('div', { className: 'ob-actions' },
            React.createElement('input', {
              type: 'text',
              placeholder: 'type "forget" to confirm',
              value: this.state.forgetText,
              onChange: (e) => this.setState({ forgetText: e.target.value }),
              style: {
                flex: 1,
                minWidth: '8rem',
                background: 'var(--bg)',
                border: '1px solid var(--line)',
                color: 'var(--text)',
                borderRadius: 7,
                padding: '9px 11px',
                fontSize: 13.5
              }
            }),
            React.createElement('button', {
              className: 'ob-btn danger',
              disabled: this.state.forgetText !== 'forget' || this.state.busy,
              onClick: () => this.forget()
            }, this.state.busy ? 'Deleting…' : 'Delete identity'),
            React.createElement('button', {
              className: 'ob-btn ghost',
              onClick: () => this.setState({ confirmForget: false, forgetText: '' })
            }, 'Cancel')
          )
        )
    );
  }

  field (label, key, opts = {}) {
    const {
      type = 'password',
      placeholder = '',
      autoFocus = false,
      onEnter = null
    } = opts;
    return React.createElement('div', { className: 'ob-field', key: 'f-' + key },
      React.createElement('label', null, label),
      React.createElement('input', {
        type,
        value: this.state[key],
        placeholder,
        autoFocus: !!autoFocus,
        ref: autoFocus ? (el) => { this._passwordRef = el; } : undefined,
        onChange: (e) => this.setState({ [key]: e.target.value }),
        onKeyDown: onEnter
          ? (e) => { if (e.key === 'Enter') onEnter(); }
          : undefined
      })
    );
  }

  passwordFields () {
    return [
      this.field('Password (min 8 characters)', 'password', { autoFocus: true }),
      this.field('Confirm password', 'password2'),
      this.state.password && this.state.password2 && !this.passwordsOk()
        ? React.createElement('div', { className: 'ob-error', key: 'pwmm' },
          this.state.password.length < 8 ? 'Password must be at least 8 characters.' : 'Passwords do not match.')
        : null
    ];
  }

  renderChoice () {
    const android = isAndroidCompanion();
    return [
      React.createElement('h2', { key: 'h' }, android ? 'Welcome to GoonCitizen' : 'Welcome, Citizen'),
      React.createElement('div', { className: 'sub', key: 's' },
        android
          ? 'This device is its own node. Create a new key, restore a 12/24-word seed or xprv, or load an encrypted backup. Linking to desktop or Passport comes next — each app keeps its own seed.'
          : 'GoonCitizen uses a cryptographic identity to sign what you share with your org. It never leaves this machine — only signatures do.'),
      React.createElement('div', { className: 'ob-actions', key: 'a' },
        React.createElement('button', {
          className: 'ob-btn',
          onClick: () => this.setState({ step: 'password', error: null })
        }, 'Create new identity'),
        React.createElement('button', {
          className: 'ob-btn ghost',
          onClick: () => this.setState({ step: 'restore', error: null })
        }, 'Restore seed or xprv'),
        React.createElement('button', {
          className: 'ob-btn ghost',
          onClick: () => this.setState({ step: 'import', error: null })
        }, 'Load from backup file'),
        React.createElement('button', {
          className: 'ob-btn ghost',
          onClick: () => this.setState({ step: 'wizard', error: null })
        }, 'Master seed wizard…')
      )
    ];
  }

  importBackupFile (file) {
    if (!file || !this.state.importPassword) return;
    this.setState({ busy: true, error: null });
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        const backup = JSON.parse(String(reader.result || ''));
        const res = await identityBridge().importBackup(backup, this.state.importPassword, false);
        if (res.error) {
          const next = { busy: false, error: res.error };
          if (res.exists) next.step = 'unlock';
          this.setState(next, () => this.refreshPubkey());
          return;
        }
        this.finish(res.pubkey, { firstRun: true });
      } catch (e) {
        this.setState({ busy: false, error: 'Could not read backup file: ' + e.message });
      }
    };
    reader.onerror = () => this.setState({ busy: false, error: 'Failed to read backup file.' });
    reader.readAsText(file);
  }

  renderImport () {
    return [
      React.createElement('h2', { key: 'h' }, 'Load from backup'),
      React.createElement('div', { className: 'sub', key: 's' },
        isAndroidCompanion()
          ? 'Pick a GoonCitizen encrypted backup (.enc.json) from this device and enter the password that sealed it.'
          : 'Select a GoonCitizen encrypted backup file (.enc.json) and enter the password that sealed it.'),
      this.field('Backup password', 'importPassword'),
      React.createElement('div', { className: 'ob-actions', key: 'a' },
        React.createElement('label', {
          className: 'ob-btn' + (this.state.importPassword ? '' : ' ghost'),
          style: { cursor: this.state.importPassword ? 'pointer' : 'default', opacity: this.state.importPassword ? 1 : 0.45 }
        },
        this.state.busy ? 'Importing…' : 'Choose backup file…',
        React.createElement('input', {
          type: 'file', accept: '.json,application/json', style: { display: 'none' },
          disabled: !this.state.importPassword || this.state.busy,
          onChange: (e) => this.importBackupFile(e.target.files && e.target.files[0])
        })
        ),
        React.createElement('button', {
          className: 'ob-btn ghost',
          onClick: () => this.setState({ step: 'choice', error: null })
        }, 'Back')
      )
    ];
  }

  renderPassword () {
    return [
      React.createElement('h2', { key: 'h' }, 'Protect your identity'),
      React.createElement('div', { className: 'sub', key: 's' },
        isAndroidCompanion()
          ? 'Your key is encrypted on this device with this password. You will need it each time GoonCitizen starts.'
          : 'Your key is encrypted on disk with this password. You will need it each time GoonCitizen starts.'),
      ...this.passwordFields(),
      React.createElement('div', { className: 'ob-actions', key: 'a' },
        React.createElement('button', {
          className: 'ob-btn',
          disabled: !this.passwordsOk() || this.state.busy,
          onClick: () => this.create()
        }, this.state.busy ? 'Creating…' : 'Create identity'),
        React.createElement('button', {
          className: 'ob-btn ghost',
          onClick: () => this.setState({ step: 'choice', error: null })
        }, 'Back')
      )
    ];
  }

  renderBackup () {
    const words = (this.state.mnemonic || '').split(' ');
    return [
      React.createElement('h2', { key: 'h' }, 'Back up your seed phrase'),
      React.createElement('div', { className: 'sub', key: 's' },
        isAndroidCompanion()
          ? 'Write these words down. After this you can link desktop or Passport from Keys → Security → Add a device.'
          : 'These words are the only way to recover your identity. Write them down and store them safely.'),
      React.createElement('div', { className: 'ob-warn', key: 'w' },
        'This phrase is shown only once. Anyone who has it can impersonate you — never share it, never paste it into chat.'),
      React.createElement('div', { className: 'ob-mnemonic', key: 'm' },
        words.map((w, i) => React.createElement('span', { key: i },
          React.createElement('i', null, i + 1 + '.'), w))
      ),
      React.createElement('label', { className: 'ob-check', key: 'c' },
        React.createElement('input', {
          type: 'checkbox',
          checked: this.state.acked,
          onChange: (e) => this.setState({ acked: e.target.checked })
        }),
        React.createElement('span', null, 'I wrote down my seed phrase and understand it cannot be shown again.')
      ),
      this.state.pubkey
        ? React.createElement('div', { className: 'ob-pk', key: 'p' }, 'Your public identity: ' + this.state.pubkey)
        : null,
      React.createElement('div', { className: 'ob-actions', key: 'a' },
        React.createElement('button', {
          className: 'ob-btn',
          disabled: !this.state.acked,
          onClick: () => this.finish(this.state.pubkey, { firstRun: true })
        }, isAndroidCompanion() ? 'Done — open Keys' : 'Done — enter GoonCitizen')
      )
    ];
  }

  renderRestore () {
    return [
      React.createElement('h2', { key: 'h' }, 'Restore identity'),
      React.createElement('div', { className: 'sub', key: 's' },
        isAndroidCompanion()
          ? 'Paste your 12/24-word seed phrase, or an xprv, then choose a password for this device.'
          : 'Enter your 12/24-word seed phrase (or an xprv), then choose a password for this machine.'),
      React.createElement('div', { className: 'ob-field', key: 'f' },
        React.createElement('label', null, 'Seed phrase or xprv'),
        React.createElement('textarea', {
          value: this.state.restoreWords,
          placeholder: 'word1 word2 …   or   xprv…',
          onChange: (e) => this.setState({ restoreWords: e.target.value })
        })
      ),
      ...this.passwordFields(),
      React.createElement('div', { className: 'ob-actions', key: 'a' },
        React.createElement('button', {
          className: 'ob-btn',
          disabled: !this.passwordsOk() || !this.state.restoreWords.trim() || this.state.busy,
          onClick: () => this.restore()
        }, this.state.busy ? 'Restoring…' : 'Restore'),
        React.createElement('button', {
          className: 'ob-btn ghost',
          onClick: () => this.setState({ step: 'choice', error: null })
        }, 'Back')
      )
    ];
  }

  renderUnlock () {
    return [
      React.createElement('h2', { key: 'h' }, 'Unlock your identity'),
      React.createElement('div', { className: 'sub', key: 's' },
        isAndroidCompanion()
          ? 'Enter the password for this device. If you lost it, forget the identity here and restore from seed or a backup.'
          : 'Enter your password to unlock signing for this session.'),
      this.state.pubkey
        ? React.createElement('div', { className: 'ob-pk', key: 'p' }, this.state.pubkey)
        : null,
      this.field('Password', 'password', {
        autoFocus: true,
        onEnter: () => this.unlock()
      }),
      React.createElement('div', { className: 'ob-actions', key: 'a' },
        React.createElement('button', {
          className: 'ob-btn',
          disabled: !this.state.password || this.state.busy,
          onClick: () => this.unlock()
        }, this.state.busy ? 'Unlocking…' : 'Unlock'),
        React.createElement('button', {
          className: 'ob-btn ghost',
          title: 'Continue without signing — uploads to your org are disabled until unlocked',
          onClick: () => this.finish(null)
        }, 'Skip for now')
      )
    ];
  }

  render () {
    if (this.state.step === 'done' || this.state.step === 'loading') return null;

    let body = null;
    if (this.state.step === 'choice') body = this.renderChoice();
    else if (this.state.step === 'password') body = this.renderPassword();
    else if (this.state.step === 'backup') body = this.renderBackup();
    else if (this.state.step === 'restore') body = this.renderRestore();
    else if (this.state.step === 'import') body = this.renderImport();
    else if (this.state.step === 'unlock') body = this.renderUnlock();
    else if (this.state.step === 'wizard') {
      body = React.createElement(MasterSeedWizard, {
        onBack: () => this.setState({ step: 'choice', error: null }),
        onInstalled: (pubkey) => this.finish(pubkey, { firstRun: true, vault: true })
      });
    }

    const android = isAndroidCompanion();
    return React.createElement('div', { className: android ? 'ob-shell' : 'ob-overlay' },
      React.createElement('div', { className: 'ob-card' },
        body,
        this.state.error
          ? React.createElement('div', { className: 'ob-error' }, this.state.error)
          : null,
        this.renderDestroy()
      )
    );
  }
}

Onboarding.CSS = CSS + '\n' + (MasterSeedWizard.CSS || '');
Onboarding.hasBridge = () => !!identityBridge();

module.exports = Onboarding;
