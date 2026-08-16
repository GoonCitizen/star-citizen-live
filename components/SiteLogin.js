'use strict';

/**
 * Browser-only Fabric site login (D-011) against Hub POST /sessions.
 * Interchangeable with GoonSPA /sessions: GoonCitizen desktop (fabric://login)
 * or Fabric Passport (postMessage FABRIC_SITE_LOGIN_REQUEST).
 *
 * No-op in Electron (desktop uses Identity + FabricLoginModal as the signer).
 * POST /sessions is LiveRelay (D-011), Hub, or the goon.vc HTML zipper proxy.
 * A 404 means this origin is not that HTTP front.
 */

const React = require('react');

const STORAGE_KEY = 'fabric.identity.session';
const DELEGATION_KEY = 'fabric.delegation';

const CSS = `
  .sl-wrap{display:inline-flex;align-items:center;gap:6px;flex-wrap:wrap;min-width:0;max-width:100%}
  .sl-btn{background:var(--panel2);border:1px solid var(--line);color:var(--text);
    border-radius:7px;padding:4px 10px;font-size:12px;font-weight:600;cursor:pointer}
  @media (max-width:720px){
    .sl-wrap{gap:4px}
    .sl-btn{padding:5px 8px;font-size:11.5px}
  }
  .sl-btn:hover{border-color:var(--accent)}
  .sl-btn:disabled{opacity:.45;cursor:default}
  .sl-btn.primary{background:var(--accent);border-color:var(--accent);color:#fff}
  .sl-chip{font-size:11px;color:var(--muted);max-width:140px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .sl-status{font-size:11px;color:var(--muted);max-width:220px}
  .sl-status.err{color:var(--kill)}
  .sl-status.ok{color:var(--good)}
  .sl-qr{display:flex;flex-direction:column;gap:6px;margin-top:8px;padding:8px;
    background:var(--panel2);border:1px solid var(--line);border-radius:8px;max-width:240px}
  .sl-qr img{width:196px;height:196px;image-rendering:pixelated;background:#fff;border-radius:4px}
  .sl-qr code{font-size:10px;word-break:break-all;color:var(--muted)}
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
      error: false,
      protocolUrl: null,
      qrDataUrl: null
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
        ? ' — this host is not serving /sessions (use goon.vc, Hub, or a LiveRelay with site login).'
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
      this.setState({ protocolUrl });
      try {
        const { protocolQrDataUrl } = require('../functions/protocolQr');
        const qr = await protocolQrDataUrl(protocolUrl);
        if (qr) this.setState({ qrDataUrl: qr });
      } catch (_) { /* qrcode optional */ }
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
            }, 'Sign in with GoonCitizen'),
            React.createElement('button', {
              type: 'button',
              className: 'sl-btn',
              disabled: busy,
              onClick: () => this._loginPassport()
            }, 'Sign in with Passport')),
        this.state.protocolUrl && !idLabel
          ? React.createElement('div', { className: 'sl-qr' },
            this.state.qrDataUrl
              ? React.createElement('img', {
                src: this.state.qrDataUrl,
                alt: 'Scan with GoonCitizen on another device'
              })
              : null,
            React.createElement('div', { className: 'sl-status' },
              'Scan or open on another device / desktop'),
            React.createElement('code', null, this.state.protocolUrl),
            React.createElement('button', {
              type: 'button',
              className: 'sl-btn',
              onClick: () => {
                try { navigator.clipboard.writeText(this.state.protocolUrl); } catch (_) {}
              }
            }, 'Copy link'))
          : null,
        status
          ? React.createElement('span', { className: 'sl-status' + (error ? ' err' : status === 'Signed in.' ? ' ok' : '') }, status)
          : null
      )
    );
  }
}

SiteLogin.CSS = CSS;

module.exports = SiteLogin;
