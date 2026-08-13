'use strict';

/**
 * Browser-only Fabric site login (D-011) against Hub POST /sessions.
 * Interchangeable with GoonSPA /sessions: GoonCitizen desktop (fabric://login)
 * or Fabric Passport (postMessage FABRIC_SITE_LOGIN_REQUEST).
 *
 * No-op in Electron (desktop uses Identity + FabricLoginModal as the signer).
 * When the page is served by standalone LiveRelay (no Hub), createSession
 * fails with a clear error — deploy goon.vc Hub as the HTTP front.
 */

const React = require('react');

const STORAGE_KEY = 'fabric.identity.session';
const DELEGATION_KEY = 'fabric.delegation';

const CSS = `
  .sl-wrap{display:inline-flex;align-items:center;gap:6px;flex-wrap:wrap}
  .sl-btn{background:var(--panel2);border:1px solid var(--line);color:var(--text);
    border-radius:7px;padding:4px 10px;font-size:12px;font-weight:600;cursor:pointer}
  .sl-btn:hover{border-color:var(--accent)}
  .sl-btn:disabled{opacity:.45;cursor:default}
  .sl-btn.primary{background:var(--accent);border-color:var(--accent);color:#fff}
  .sl-chip{font-size:11px;color:var(--muted);max-width:140px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .sl-status{font-size:11px;color:var(--muted);max-width:220px}
  .sl-status.err{color:var(--kill)}
  .sl-status.ok{color:var(--good)}
`;

function readStoredSession () {
  try {
    const raw = typeof localStorage !== 'undefined' && localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || !parsed.identity) return null;
    return parsed;
  } catch (_) {
    return null;
  }
}

function storeSignedIdentity (payload) {
  try {
    const row = {
      identity: payload.identity || null,
      pubkeyHex: payload.pubkeyHex || null,
      delegationToken: payload.delegationToken || null,
      signer: payload.signer || 'client',
      linkedAt: Date.now()
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(row));
    if (payload.delegationToken) {
      localStorage.setItem(DELEGATION_KEY, JSON.stringify({
        token: payload.delegationToken,
        linkedAt: row.linkedAt,
        origin: window.location.origin
      }));
    }
    return row;
  } catch (_) {
    return null;
  }
}

function clearStoredSession () {
  try {
    localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem(DELEGATION_KEY);
  } catch (_) {}
}

class SiteLogin extends React.Component {
  constructor (props) {
    super(props);
    this.state = {
      session: readStoredSession(),
      busy: false,
      status: '',
      error: false
    };
    this._pollTimer = null;
    this._passportWait = null;
  }

  componentWillUnmount () {
    this._clearPoll();
    if (this._passportWait) {
      window.removeEventListener('message', this._passportWait);
      this._passportWait = null;
    }
  }

  _clearPoll () {
    if (this._pollTimer) {
      clearInterval(this._pollTimer);
      this._pollTimer = null;
    }
  }

  _setStatus (status, error) {
    this.setState({ status: status || '', error: !!error });
  }

  async _createSession () {
    const origin = window.location.origin;
    const res = await fetch('/sessions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ origin })
    });
    const j = await res.json().catch(() => ({}));
    if (!res.ok || !j || !j.ok) {
      const hint = (j && j.error) || `HTTP ${res.status}`;
      const missing = res.status === 404
        ? ' — this host is not serving Hub /sessions (deploy goon.vc Hub as the HTTP front).'
        : '';
      throw new Error(hint + missing);
    }
    return j;
  }

  _pollSigned (sessionId) {
    let tries = 0;
    this._clearPoll();
    this._pollTimer = setInterval(() => {
      tries += 1;
      if (tries > 90) {
        this._clearPoll();
        this.setState({ busy: false });
        this._setStatus('Timed out waiting for approval.', true);
        return;
      }
      fetch('/sessions/' + encodeURIComponent(sessionId), {
        headers: { Accept: 'application/json' },
        cache: 'no-store'
      }).then((res) => res.json().then((j) => ({ ok: res.ok, j })))
        .then((r) => {
          if (!r.ok || !r.j || r.j.status !== 'signed') return;
          this._clearPoll();
          const row = storeSignedIdentity(r.j);
          this.setState({ busy: false, session: row });
          this._setStatus('Signed in.', false);
          if (typeof this.props.onSignedIn === 'function') this.props.onSignedIn(r.j);
        }).catch(() => {});
    }, 1500);
  }

  async _loginDesktop () {
    this.setState({ busy: true });
    this._setStatus('Starting Fabric login…');
    try {
      const j = await this._createSession();
      const protocolUrl = j.protocolUrl ||
        ('fabric://login?sessionId=' + encodeURIComponent(j.sessionId) +
          '&hub=' + encodeURIComponent(window.location.origin));
      this._setStatus('Approve in GoonCitizen / Fabric desktop…');
      const a = document.createElement('a');
      a.href = protocolUrl;
      a.style.display = 'none';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      this._pollSigned(j.sessionId);
    } catch (e) {
      this.setState({ busy: false });
      this._setStatus((e && e.message) || String(e), true);
    }
  }

  async _loginPassport () {
    this.setState({ busy: true });
    this._setStatus('Starting Passport login…');
    if (this._passportWait) {
      window.removeEventListener('message', this._passportWait);
      this._passportWait = null;
    }
    try {
      const j = await this._createSession();
      const sessionId = j.sessionId;
      const message = j.message;
      this._passportWait = (event) => {
        if (event.origin !== window.location.origin) return;
        const d = event.data;
        if (!d || d.source !== 'fabric-passport' || d.type !== 'FABRIC_SITE_LOGIN_RESULT') return;
        window.removeEventListener('message', this._passportWait);
        this._passportWait = null;
        if (!d.ok) {
          this._clearPoll();
          this.setState({ busy: false });
          this._setStatus('Passport: ' + (d.error || 'rejected'), true);
          return;
        }
        this._setStatus('Passport approved — confirming…');
      };
      window.addEventListener('message', this._passportWait);
      window.postMessage({
        source: 'fabric-site',
        type: 'FABRIC_SITE_LOGIN_REQUEST',
        sessionId,
        hub: window.location.origin,
        origin: window.location.origin,
        message
      }, window.location.origin);
      this._setStatus('Approve in the Passport popup…');
      this._pollSigned(sessionId);
    } catch (e) {
      this.setState({ busy: false });
      this._setStatus((e && e.message) || String(e), true);
    }
  }

  _signOut () {
    clearStoredSession();
    this.setState({ session: null });
    this._setStatus('');
    if (typeof this.props.onSignedOut === 'function') this.props.onSignedOut();
  }

  render () {
    if (typeof window !== 'undefined' && window.electronAPI && window.electronAPI.identity) {
      return null;
    }

    const { session, busy, status, error } = this.state;
    const idLabel = session && session.identity && session.identity.id
      ? String(session.identity.id)
      : (session && session.pubkeyHex ? String(session.pubkeyHex).slice(0, 12) + '…' : null);

    return React.createElement(React.Fragment, null,
      React.createElement('style', null, CSS),
      React.createElement('div', { className: 'sl-wrap', title: 'Fabric site login (Passport or GoonCitizen)' },
        idLabel
          ? React.createElement(React.Fragment, null,
            React.createElement('span', { className: 'sl-chip', title: idLabel }, '🔑 ' + idLabel.slice(0, 18) + (idLabel.length > 18 ? '…' : '')),
            React.createElement('button', {
              type: 'button',
              className: 'sl-btn',
              disabled: busy,
              onClick: () => this._signOut()
            }, 'Sign out'))
          : React.createElement(React.Fragment, null,
            React.createElement('button', {
              type: 'button',
              className: 'sl-btn primary',
              disabled: busy,
              onClick: () => this._loginDesktop()
            }, 'Desktop'),
            React.createElement('button', {
              type: 'button',
              className: 'sl-btn',
              disabled: busy,
              onClick: () => this._loginPassport()
            }, 'Passport')),
        status
          ? React.createElement('span', { className: 'sl-status' + (error ? ' err' : status === 'Signed in.' ? ' ok' : '') }, status)
          : null
      )
    );
  }
}

module.exports = SiteLogin;
