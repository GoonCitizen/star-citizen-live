'use strict';

/**
 * First-run identity onboarding for the GoonCitizen desktop app.
 *
 * Shown when the Electron shell reports no stored identity (or a locked
 * one). Creates or restores a BIP39 identity via the main-process IPC
 * bridge (`window.electronAPI.identity`); the mnemonic is displayed
 * exactly once for backup. Pure browser sessions (npm start) have no
 * identity bridge and skip onboarding entirely.
 */

const React = require('react');

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
`;

function identityBridge () {
  return (typeof window !== 'undefined' && window.electronAPI && window.electronAPI.identity) || null;
}

class Onboarding extends React.Component {
  constructor (props) {
    super(props);
    this.state = {
      step: 'loading', // loading | choice | password | backup | restore | import | unlock | done
      busy: false,
      error: null,
      password: '',
      password2: '',
      mnemonic: null, // shown once after create
      restoreWords: '',
      acked: false,
      pubkey: null,
      importPassword: ''
    };
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
        this.setState({ step: 'unlock', pubkey: info.pubkey });
      }
    }).catch(() => this.setState({ step: 'choice' }));
  }

  finish (pubkey) {
    this.setState({ step: 'done', pubkey });
    if (this.props.onReady) this.props.onReady(pubkey);
  }

  passwordsOk () {
    return this.state.password.length >= 8 && this.state.password === this.state.password2;
  }

  async create () {
    if (!this.passwordsOk()) return;
    this.setState({ busy: true, error: null });
    const res = await identityBridge().create(this.state.password);
    if (res.error) {
      this.setState({ busy: false, error: res.error });
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
    this.finish(res.pubkey);
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

  field (label, key, type, placeholder) {
    return React.createElement('div', { className: 'ob-field' },
      React.createElement('label', null, label),
      React.createElement('input', {
        type: type || 'password',
        value: this.state[key],
        placeholder: placeholder || '',
        onChange: (e) => this.setState({ [key]: e.target.value })
      })
    );
  }

  passwordFields () {
    return [
      this.field('Password (min 8 characters)', 'password'),
      this.field('Confirm password', 'password2'),
      this.state.password && this.state.password2 && !this.passwordsOk()
        ? React.createElement('div', { className: 'ob-error', key: 'pwmm' },
          this.state.password.length < 8 ? 'Password must be at least 8 characters.' : 'Passwords do not match.')
        : null
    ];
  }

  renderChoice () {
    return [
      React.createElement('h2', { key: 'h' }, 'Welcome, Citizen'),
      React.createElement('div', { className: 'sub', key: 's' },
        'GoonCitizen uses a cryptographic identity to sign what you share with your org. ' +
        'It never leaves this machine — only signatures do.'),
      React.createElement('div', { className: 'ob-actions', key: 'a' },
        React.createElement('button', {
          className: 'ob-btn',
          onClick: () => this.setState({ step: 'password', error: null })
        }, 'Create new identity'),
        React.createElement('button', {
          className: 'ob-btn ghost',
          onClick: () => this.setState({ step: 'restore', error: null })
        }, 'Restore from seed phrase'),
        React.createElement('button', {
          className: 'ob-btn ghost',
          onClick: () => this.setState({ step: 'import', error: null })
        }, 'Load from backup file')
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
        if (res.error) return this.setState({ busy: false, error: res.error });
        this.finish(res.pubkey);
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
        'Select a GoonCitizen encrypted backup file (.enc.json) and enter the password that sealed it.'),
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
        'Your key is encrypted on disk with this password. You will need it each time GoonCitizen starts.'),
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
        'These words are the only way to recover your identity. Write them down and store them safely.'),
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
          onClick: () => this.finish(this.state.pubkey)
        }, 'Done — enter GoonCitizen')
      )
    ];
  }

  renderRestore () {
    return [
      React.createElement('h2', { key: 'h' }, 'Restore identity'),
      React.createElement('div', { className: 'sub', key: 's' },
        'Enter your 12/24-word seed phrase (or an xprv), then choose a password for this machine.'),
      React.createElement('div', { className: 'ob-field', key: 'f' },
        React.createElement('label', null, 'Seed phrase'),
        React.createElement('textarea', {
          value: this.state.restoreWords,
          placeholder: 'word1 word2 word3 …',
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
        'Enter your password to unlock signing for this session.'),
      this.state.pubkey
        ? React.createElement('div', { className: 'ob-pk', key: 'p' }, this.state.pubkey)
        : null,
      this.field('Password', 'password'),
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

    return React.createElement('div', { className: 'ob-overlay' },
      React.createElement('div', { className: 'ob-card' },
        body,
        this.state.error
          ? React.createElement('div', { className: 'ob-error' }, this.state.error)
          : null
      )
    );
  }
}

Onboarding.CSS = CSS;
Onboarding.hasBridge = () => !!identityBridge();

module.exports = Onboarding;
