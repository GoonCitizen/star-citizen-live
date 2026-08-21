'use strict';

/**
 * Dedicated Keys / Devices / Security / Privacy pages (Android + desktop).
 * Avoids stacking the Identity and Settings modals on a mobile device.
 */

const React = require('react');
const Identity = require('./Identity');
const { isAndroidCompanion, androidSurface } = require('../functions/androidSurface');

const SECTIONS = [
  ['keys', 'Keys'],
  ['devices', 'Devices'],
  ['security', 'Security'],
  ['privacy', 'Privacy']
];

const CSS = `
  .ac-wrap{width:100%;max-width:none;margin:0;padding:12px 14px 72px;box-sizing:border-box}
  .ac-nav{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:8px}
  .ac-lead{color:var(--muted);font-size:13px;line-height:1.55;margin:0 0 12px}
`;

function leadFor (section) {
  const android = isAndroidCompanion();
  if (section === 'devices') {
    return 'This identity’s linked devices. Pair with fabric://link, then chat and notes replay over Fabric both ways (desktop ↔ phone). Website login is Passport or GoonCitizen fabric://login — not this pairing QR.';
  }
  if (section === 'security') {
    return 'Lock this identity, set auto-lock, and link or revoke Passport / desktop / another device. Unlock to sign. Lost the password? Forget the identity on this device, then restore from seed.';
  }
  if (section === 'privacy') {
    return androidSurface('heatmap')
      ? 'What peers can see: profile, presence, and optional when-you-fly publishing on your profile.'
      : 'What peers can see: profile and presence.';
  }
  return android
    ? (androidSurface('associatedFunds')
      ? 'This device’s Fabric key, recovery backups, and associated Bitcoin funds. Each app keeps its own seed — link devices from Devices.'
      : 'This device’s Fabric key and recovery backups. Each app keeps its own seed — link devices from Devices.')
    : 'This device’s Fabric key, recovery backups, and associated Bitcoin funds.';
}

class Account extends React.Component {
  render () {
    const section = this.props.section || 'keys';
    return React.createElement('div', { className: 'page-shell ac-wrap' },
      React.createElement('div', { className: 'ac-nav', role: 'tablist' },
        SECTIONS.map(([key, label]) => React.createElement('button', {
          key,
          type: 'button',
          role: 'tab',
          'aria-selected': section === key,
          className: 'tab ' + (section === key ? 'on' : ''),
          onClick: () => this.props.onSection && this.props.onSection(key)
        }, label))
      ),
      React.createElement('p', { className: 'ac-lead' }, leadFor(section)),
      React.createElement(Identity, {
        layout: 'page',
        section,
        onClose: this.props.onClose,
        onForget: this.props.onForget,
        onNicknameChange: this.props.onNicknameChange,
        onPresenceChange: this.props.onPresenceChange,
        analytics: this.props.analytics
      }),
      section === 'privacy' && typeof this.props.onOpenSettings === 'function'
        ? React.createElement('button', {
          type: 'button',
          className: 'tab',
          style: { marginTop: 8 },
          onClick: () => this.props.onOpenSettings()
        }, 'Relay & advanced…')
        : null
    );
  }
}

Account.CSS = CSS;
Account.SECTIONS = SECTIONS;

module.exports = Account;
