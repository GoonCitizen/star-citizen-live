'use strict';

/**
 * Large emoji fingerprint for in-person device-link confirmation.
 */

const React = require('react');
const { emojiFingerprint, initiatorSource } = require('../functions/pubkeyEmoji');

const CSS = `
  .pk-emoji{display:grid;gap:6px;justify-items:center;background:var(--bg);
    border:1px solid var(--line);border-radius:10px;padding:12px 10px;margin:10px 0}
  .pk-emoji-row{font-size:28px;letter-spacing:.18em;line-height:1.25;text-align:center}
  .pk-emoji p{margin:0;font-size:12px;line-height:1.45;color:var(--muted);text-align:center;max-width:28em}
`;

class PubkeyEmoji extends React.Component {
  render () {
    const props = this.props || {};
    const source = Object.prototype.hasOwnProperty.call(props, 'source')
      ? props.source
      : initiatorSource(props.from);
    const fp = emojiFingerprint(source);
    if (!fp) return null;
    const label = props.label || 'Match these emoji with the other device. They fingerprint this Fabric key.';
    return React.createElement('div', {
      className: 'pk-emoji',
      role: 'img',
      'aria-label': 'Key fingerprint ' + fp.emoji
    },
    React.createElement('div', { className: 'pk-emoji-row' }, fp.emoji),
    React.createElement('p', null, label));
  }
}

PubkeyEmoji.CSS = CSS;
module.exports = PubkeyEmoji;
