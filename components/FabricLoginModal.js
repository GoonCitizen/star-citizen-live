'use strict';

/**
 * In-app approval for fabric://login (site login) and fabric://link (device link).
 * Secrets never enter the renderer — approve/reject goes through IPC.
 */

const React = require('react');
const PubkeyEmoji = require('./PubkeyEmoji');
const {
  DEVICE_LINK_APPROVE_TIMEOUT_MS
} = require('../functions/deviceLinkLifecycle');

const CSS = `
  .fl-overlay{position:fixed;inset:0;z-index:60;background:rgba(8,10,14,.8);
    display:flex;align-items:flex-start;justify-content:center;padding:54px 16px 30px;backdrop-filter:blur(2px)}
  .fl-card{background:var(--panel);border:1px solid var(--line);border-radius:12px;
    width:min(520px,94vw);max-height:86vh;overflow:auto;box-shadow:0 12px 40px rgba(0,0,0,.35)}
  .fl-head{display:flex;align-items:center;gap:10px;padding:14px 18px;border-bottom:1px solid var(--line)}
  .fl-head h2{margin:0;font-size:16px;flex:1}
  .fl-body{padding:16px 18px}
  .fl-body p{margin:0 0 10px;font-size:13px;line-height:1.5;color:var(--text)}
  .fl-body .muted{color:var(--muted);font-size:12px}
  .fl-kv{font-family:'Cascadia Code',Consolas,monospace;font-size:11.5px;word-break:break-all;
    background:var(--bg);border:1px solid var(--line);border-radius:7px;padding:8px 10px;margin:8px 0}
  .fl-kv b{color:var(--muted);font-weight:600;font-family:'Segoe UI',system-ui,sans-serif;font-size:11px}
  .fl-row{display:flex;gap:8px;flex-wrap:wrap;margin-top:14px}
  .fl-btn{background:var(--accent);border:none;color:#fff;border-radius:7px;padding:8px 16px;
    font-size:13px;font-weight:600;cursor:pointer}
  .fl-btn:disabled{opacity:.45;cursor:default}
  .fl-btn.ghost{background:var(--panel2);border:1px solid var(--line);color:var(--text)}
  .fl-err{background:rgba(248,81,73,.12);color:var(--kill);border-radius:7px;padding:8px 11px;font-size:12.5px;margin-top:10px}
  .fl-warn{background:rgba(210,153,34,.12);color:var(--warn);border-radius:7px;padding:9px 12px;font-size:12.5px;line-height:1.5;margin-bottom:10px}
`;

function withTimeout (promise, ms, message) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

function short (s, n = 20) {
  const t = String(s || '');
  if (t.length <= n) return t;
  return t.slice(0, n) + '…';
}

class FabricLoginModal extends React.Component {
  constructor (props) {
    super(props);
    this.state = {
      prompt: null,
      busy: false,
      error: null
    };
    this._unsub = null;
  }

  componentDidMount () {
    const api = typeof window !== 'undefined' && window.electronAPI && window.electronAPI.fabricLogin;
    if (!api) return;
    if (typeof api.onPrompt === 'function') {
      this._unsub = api.onPrompt((payload) => this._setPrompt(payload));
    }
    if (typeof api.pullPending === 'function') {
      void api.pullPending().then((p) => {
        if (p && p.sessionId) this._setPrompt(p);
      }).catch(() => {});
    }
  }

  componentWillUnmount () {
    if (typeof this._unsub === 'function') this._unsub();
  }

  _setPrompt (payload) {
    if (!payload || !payload.sessionId) {
      this.setState({ prompt: null, error: null, busy: false });
      return;
    }
    this.setState({ prompt: payload, error: null, busy: false });
  }

  async _resolve (approve) {
    const { prompt } = this.state;
    if (!prompt || !prompt.sessionId) return;
    const api = window.electronAPI && window.electronAPI.fabricLogin;
    if (!api || typeof api.resolve !== 'function') return;
    this.setState({ busy: true, error: null });
    try {
      const work = api.resolve({ approve: !!approve, sessionId: prompt.sessionId });
      const res = approve
        ? await withTimeout(
          work,
          DEVICE_LINK_APPROVE_TIMEOUT_MS,
          'Hub did not answer. Dismiss and scan a fresh QR.'
        )
        : await work;
      if (!approve) {
        this.setState({ prompt: null, busy: false });
        return;
      }
      if (res && res.error) {
        this.setState({ busy: false, error: res.error });
        return;
      }
      this.setState({ prompt: null, busy: false });
    } catch (e) {
      this.setState({ busy: false, error: (e && e.message) ? e.message : String(e) });
    }
  }

  render () {
    const { prompt, busy, error } = this.state;
    if (!prompt) return null;
    const isLink = prompt.kind === 'device-link';
    const origin = prompt.origin || prompt.hubBase || '';
    const locked = !!prompt.identityLocked;
    const peerId = prompt.initiator && prompt.initiator.id;
    const shownError = error || prompt.error;

    return React.createElement(React.Fragment, null,
      React.createElement('style', null, CSS),
      React.createElement('div', { className: 'fl-overlay', role: 'dialog', 'aria-modal': 'true' },
        React.createElement('div', { className: 'fl-card' },
          React.createElement('div', { className: 'fl-head' },
            React.createElement('h2', null, isLink ? 'Link this device' : 'Sign in to website')),
          React.createElement('div', { className: 'fl-body' },
            React.createElement('p', null,
              isLink
                ? 'Another Fabric app wants a mutual identity link (separate seeds). Match the emoji with the QR screen on the other device, then approve. Chat and account data sync over Fabric after that.'
                : 'A website is asking this app to prove your Fabric identity (Passport and GoonCitizen are interchangeable here). This does not link a new device. Approve only if you started this login.'),
            React.createElement('p', { className: 'muted' },
              isLink
                ? ('Purpose: device link · Hub: ' + (origin || 'unknown'))
                : ('Purpose: site login · Hub: ' + (origin || 'unknown'))),
            locked
              ? React.createElement('div', { className: 'fl-warn' },
                'Your identity is locked. Unlock it in Settings / Identity, then approve again (or reopen the link).')
              : null,
            React.createElement('div', { className: 'fl-kv' },
              React.createElement('b', null, isLink ? 'Hub' : 'Site'),
              React.createElement('div', null, origin || '—')),
            isLink
              ? React.createElement(PubkeyEmoji, {
                from: prompt,
                label: 'These emoji must match the Add-a-device QR on the other screen. They fingerprint that device’s Fabric key — not a seed.'
              })
              : null,
            isLink && prompt.label
              ? React.createElement('div', { className: 'fl-kv' },
                React.createElement('b', null, 'Offer label'),
                React.createElement('div', null, prompt.label))
              : null,
            isLink && peerId
              ? React.createElement('div', { className: 'fl-kv' },
                React.createElement('b', null, 'Peer Fabric id'),
                React.createElement('div', { title: peerId }, short(peerId, 48)))
              : null,
            React.createElement('div', { className: 'fl-kv' },
              React.createElement('b', null, 'Session'),
              React.createElement('div', { title: prompt.sessionId }, short(prompt.sessionId, 48))),
            !isLink && prompt.message
              ? React.createElement('div', { className: 'fl-kv' },
                React.createElement('b', null, 'Challenge'),
                React.createElement('div', { className: 'muted', title: prompt.message }, short(prompt.message, 96)))
              : null,
            shownError ? React.createElement('div', { className: 'fl-err' }, shownError) : null,
            React.createElement('div', { className: 'fl-row' },
              React.createElement('button', {
                type: 'button',
                className: 'fl-btn',
                disabled: busy || locked || !!(prompt.error && !prompt.initiator),
                onClick: () => void this._resolve(true)
              }, busy ? (isLink ? 'Linking…' : 'Signing…') : (isLink ? 'Approve & link' : 'Approve & sign')),
              React.createElement('button', {
                type: 'button',
                className: 'fl-btn ghost',
                disabled: false,
                onClick: () => void this._resolve(false)
              }, busy ? 'Dismiss' : 'Ignore'))))));
  }
}

FabricLoginModal.CSS = CSS;
module.exports = FabricLoginModal;
