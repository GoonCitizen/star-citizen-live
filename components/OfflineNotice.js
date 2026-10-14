'use strict';

/**
 * Stand-in for a networking page while Offline Mode is on.
 */

const React = require('react');

function OfflineNotice (props) {
  const back = (props && props.backHref) || '/';
  const label = (props && props.backLabel) || '← Home';
  return React.createElement('div', {
    className: 'offline-notice',
    style: { padding: '28px 20px', maxWidth: 560 }
  },
  React.createElement('a', { href: back, style: { color: 'var(--muted)', fontSize: 13 } }, label),
  React.createElement('h1', { style: { fontSize: 18, margin: '14px 0 8px' } }, 'Offline Mode'),
  React.createElement('p', {
    style: { color: 'var(--muted)', fontSize: 13.5, lineHeight: 1.5, margin: 0 }
  }, 'Networking and sharing are off on this desktop. Turn Offline Mode off in Settings to use this page.')
  );
}

module.exports = OfflineNotice;
