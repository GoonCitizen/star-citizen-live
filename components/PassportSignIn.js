'use strict';

/**
 * Browser sign-in to this relay with Fabric Passport v2
 * (`@fabric/http/functions/passportPage`): the relay issues a challenge for
 * its own origin, Passport answers over a private MessagePort (signing itself
 * or through a linked GoonCitizen / Hub desktop), and the relay sets an
 * HttpOnly `fabric.session` cookie. Nothing is kept in page storage.
 *
 * Renders nothing in the desktop / Android app, which acts as its own identity.
 */

const React = require('react');
const { passportStatus, signInWithPassport } = require('@fabric/http/functions/passportPage');
const { endSiteSession } = require('../functions/goonCitizenClientEnvironment');

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
  .sl-status{font-size:11px;color:var(--muted);max-width:260px}
  .sl-status.err{color:var(--kill)}
`;

class PassportSignIn extends React.Component {
  constructor (props) {
    super(props);
    this.state = { busy: false, status: '', error: false };
    this._cancel = null;
  }

  componentWillUnmount () {
    if (typeof this._cancel === 'function') this._cancel();
  }

  async _signIn () {
    const passport = passportStatus(window.document);
    if (passport === 'outdated') {
      this.setState({ status: 'Update Fabric Passport to sign in here. This relay uses Passport v2.', error: true });
      return;
    }
    if (passport !== 'ready') {
      this.setState({ status: 'Install Fabric Passport to sign in. It can also ask your GoonCitizen desktop to sign.', error: true });
      return;
    }
    this.setState({ busy: true, status: 'Approve in Passport…', error: false });
    const result = await signInWithPassport({
      window,
      purpose: 'Sign in to GoonCitizen',
      onPending: ({ cancel }) => { this._cancel = cancel; }
    });
    this._cancel = null;
    if (!result.ok) {
      const status = result.error === 'passport_outdated'
        ? 'Update Fabric Passport, or the desktop app it asked, to sign in here.'
        : 'Passport: ' + (result.error || 'sign-in failed');
      this.setState({ busy: false, status, error: true });
      return;
    }
    this.setState({ busy: false, status: '', error: false });
    if (typeof this.props.onSignedIn === 'function') this.props.onSignedIn(result.session);
  }

  async _signOut () {
    this.setState({ busy: true });
    await endSiteSession();
    this.setState({ busy: false, status: '', error: false });
    if (typeof this.props.onSignedOut === 'function') this.props.onSignedOut();
  }

  render () {
    if (typeof window !== 'undefined' && window.electronAPI && window.electronAPI.identity) {
      return null;
    }
    const { busy, status, error } = this.state;
    const session = this.props.session;
    const identity = session && session.identity;
    const idLabel = identity && (identity.id || identity.pubkey) ? String(identity.id || identity.pubkey) : null;
    return React.createElement(React.Fragment, null,
      React.createElement('style', null, CSS),
      React.createElement('div', { className: 'sl-wrap', title: 'Sign in with Fabric Passport' },
        idLabel
          ? React.createElement(React.Fragment, null,
            React.createElement('span', { className: 'sl-chip', title: idLabel },
              '🔑 ' + idLabel.slice(0, 18) + (idLabel.length > 18 ? '…' : '')),
            React.createElement('button', {
              type: 'button',
              className: 'sl-btn',
              disabled: busy,
              onClick: () => void this._signOut()
            }, 'Sign out'))
          : React.createElement('button', {
            type: 'button',
            className: 'sl-btn primary',
            disabled: busy,
            onClick: () => void this._signIn()
          }, busy ? 'Waiting for Passport…' : 'Sign in with Passport'),
        status
          ? React.createElement('span', { className: 'sl-status' + (error ? ' err' : '') }, status)
          : null));
  }
}

PassportSignIn.CSS = CSS;
module.exports = PassportSignIn;
