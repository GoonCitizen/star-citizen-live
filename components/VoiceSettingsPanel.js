'use strict';

/**
 * Shared Voice settings: enable/disable push-to-talk and rebind the hold key.
 */

const React = require('react');
const groupVoiceSettings = require('../functions/groupVoiceSettings');

const CSS = `
  .vs-panel .d{color:var(--muted);font-size:12px;margin-bottom:10px}
  .vs-panel .st-field{display:grid;gap:5px;margin-bottom:10px}
  .vs-panel .st-field label{font-size:12px;color:var(--muted)}
  .vs-ptt-row{display:flex;gap:8px;align-items:center}
  .vs-ptt-row input{flex:1;min-width:0;width:auto;background:var(--bg);border:1px solid var(--line);
    color:var(--text);border-radius:7px;padding:8px 10px;font-size:13px;box-sizing:border-box;
    font-family:'Cascadia Code',Consolas,monospace}
  .vs-ptt-row.capturing input{border-color:var(--accent);box-shadow:0 0 0 2px rgba(59,130,246,.18)}
  .vs-panel input[type=range]{width:100%}
  .vs-panel .st-btn{background:var(--panel2);border:1px solid var(--line);color:var(--text);
    border-radius:7px;padding:7px 14px;font-size:12.5px;font-weight:600;cursor:pointer;white-space:nowrap}
  .vs-panel .st-btn:disabled{opacity:.45;cursor:default}
`;

class VoiceSettingsPanel extends React.Component {
  constructor (props) {
    super(props);
    this.state = { capturing: false };
    this._onCapture = this._onCapture.bind(this);
    this._onCaptureKeyUp = this._onCaptureKeyUp.bind(this);
  }

  componentWillUnmount () {
    this.stopCapture();
  }

  voice () {
    return groupVoiceSettings.sanitizeVoiceSettings(this.props.voice);
  }

  stopCapture () {
    if (typeof window === 'undefined') return;
    window.removeEventListener('keydown', this._onCapture, true);
    window.removeEventListener('keyup', this._onCaptureKeyUp, true);
    if (this.state.capturing) this.setState({ capturing: false });
  }

  startCapture () {
    if (this.props.disabled) return;
    if (typeof window === 'undefined') return;
    window.addEventListener('keydown', this._onCapture, true);
    window.addEventListener('keyup', this._onCaptureKeyUp, true);
    this.setState({ capturing: true });
  }

  _onCaptureKeyUp (ev) {
    if (!this.state.capturing) return;
    ev.preventDefault();
    ev.stopPropagation();
  }

  _onCapture (ev) {
    if (!this.state.capturing) return;
    ev.preventDefault();
    ev.stopPropagation();
    if (ev.repeat) return;
    if (ev.key === 'Escape') {
      this.stopCapture();
      return;
    }
    const bind = groupVoiceSettings.bindFromKeyboardEvent(ev);
    if (!bind) return;
    this.stopCapture();
    this.patch({ mode: 'ptt', pttKey: bind });
  }

  patch (next) {
    if (typeof this.props.onChange === 'function') this.props.onChange(next);
  }

  render () {
    const v = this.voice();
    const ptt = v.mode !== 'vad';
    const disabled = !!this.props.disabled;
    const capturing = this.state.capturing;
    return React.createElement('div', { className: 'vs-panel' },
      this.props.hideIntro
        ? null
        : React.createElement('div', { className: 'd' },
          'Federation group voice. Default is push-to-talk (Shift+Tab), captured while another app is focused. Signaling uses public Hub hub.fabric.pub; audio is peer-to-peer. Discord voice is a later bridge.'),
      React.createElement('label', {
        style: { display: 'flex', gap: 8, alignItems: 'center', fontSize: 13, cursor: disabled ? 'default' : 'pointer', marginBottom: 8 }
      },
        React.createElement('input', {
          type: 'checkbox',
          checked: ptt,
          disabled,
          onChange: (e) => this.patch({ mode: e.target.checked ? 'ptt' : 'vad' })
        }),
        'Push-to-talk'
      ),
      React.createElement('div', { className: 'd', style: { marginTop: -4, marginBottom: 10 } },
        ptt
          ? 'Hold the bind to talk. Works in the game window on desktop. Uncheck to use voice activity instead.'
          : 'Microphone opens when you speak. Check Push-to-talk to require a hold key.'),
      ptt
        ? React.createElement('div', { className: 'st-field' },
          React.createElement('label', null, 'PTT key'),
          React.createElement('div', { className: 'vs-ptt-row' + (capturing ? ' capturing' : '') },
            React.createElement('input', {
              value: capturing ? 'Press a key…' : groupVoiceSettings.pttBindLabel(v.pttKey),
              readOnly: true,
              disabled,
              onClick: () => this.startCapture(),
              title: 'Click Rebind, then hold the new combination (default Shift+Tab)'
            }),
            React.createElement('button', {
              className: 'st-btn ghost',
              type: 'button',
              disabled,
              onClick: () => capturing ? this.stopCapture() : this.startCapture()
            }, capturing ? 'Cancel' : 'Rebind'),
            React.createElement('button', {
              className: 'st-btn ghost',
              type: 'button',
              disabled: disabled || capturing,
              onClick: () => this.patch({
                mode: 'ptt',
                pttKey: Object.assign({}, groupVoiceSettings.DEFAULT_PTT_BIND)
              })
            }, 'Reset')
          )
        )
        : React.createElement('div', { className: 'st-field' },
          React.createElement('label', null, 'Voice-activity sensitivity'),
          React.createElement('input', {
            type: 'range',
            min: '0.04',
            max: '0.4',
            step: '0.02',
            value: String(v.vadSensitivity),
            disabled,
            onChange: (e) => this.patch({ vadSensitivity: Number(e.target.value) })
          })
        )
    );
  }
}

VoiceSettingsPanel.CSS = CSS;
module.exports = VoiceSettingsPanel;
