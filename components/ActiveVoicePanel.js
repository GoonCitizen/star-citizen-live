'use strict';

/**
 * Bottom-left active-voice chrome + Join voice control for group headers.
 * Media stays in the renderer; LiveRelay/Hub only coordinate.
 */

const React = require('react');
const groupVoiceClient = require('../functions/groupVoiceClient');
const groupVoiceSettings = require('../functions/groupVoiceSettings');
const { VoiceMesh } = require('../functions/groupVoiceRtc');

const CSS = `
  .avp{position:fixed;left:var(--chrome-inset,16px);bottom:var(--chrome-inset,16px);z-index:33;
    width:min(320px,calc(100vw - 36px));pointer-events:none}
  .avp-card{pointer-events:auto;background:var(--panel);border:1px solid var(--line);border-radius:12px;
    box-shadow:0 12px 40px rgba(0,0,0,.45);padding:10px 12px;display:grid;gap:8px}
  .avp-top{display:flex;align-items:center;gap:8px;min-width:0}
  .avp-name{flex:1;min-width:0;font-size:13px;font-weight:650;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;
    background:none;border:none;color:var(--text);cursor:pointer;text-align:left;padding:0}
  .avp-name:hover{color:var(--accent)}
  .avp-sub{color:var(--muted);font-size:11.5px}
  .avp-dots{display:flex;flex-wrap:wrap;gap:4px}
  .avp-dot{width:8px;height:8px;border-radius:50%;background:var(--muted);flex:none}
  .avp-dot.on{background:var(--good);box-shadow:0 0 0 2px rgba(63,185,80,.25)}
  .avp-row{display:flex;gap:6px;flex-wrap:wrap;align-items:center}
  .avp-btn{background:var(--panel2);border:1px solid var(--line);color:var(--text);border-radius:7px;
    padding:6px 10px;font-size:12px;font-weight:600;cursor:pointer}
  .avp-btn:hover{border-color:var(--accent)}
  .avp-btn.on{border-color:var(--accent);background:rgba(59,130,246,.14);color:var(--accent)}
  .avp-btn.ptt{min-width:92px}
  .avp-btn.ptt.held{border-color:var(--good);background:rgba(63,185,80,.16);color:var(--good)}
  .avp-btn.leave{margin-left:auto}
  .avp-err{background:rgba(248,81,73,.12);color:var(--kill);border-radius:7px;padding:6px 8px;font-size:12px}
  .chat-voice-btn,.gp-voice{background:var(--panel2);border:1px solid var(--line);color:var(--text);
    border-radius:8px;height:34px;padding:0 10px;flex:none;cursor:pointer;font-size:12px;font-weight:650;
    display:inline-flex;align-items:center;justify-content:center;gap:4px}
  .chat-voice-btn:hover,.gp-voice:hover{border-color:var(--accent);background:rgba(56,139,253,.1)}
  .chat-voice-btn.on,.gp-voice.on{border-color:var(--good);color:var(--good);background:rgba(63,185,80,.12)}
  .mbb-stack.raised{bottom:calc(var(--chrome-inset,16px) + 88px)}
`;

class JoinVoiceButton extends React.Component {
  constructor (props) {
    super(props);
    this.state = { busy: false, error: null, joined: !!props.joined };
  }

  componentDidMount () {
    this.tick();
    this._timer = setInterval(() => this.tick(), 1500);
  }

  componentWillUnmount () {
    if (this._timer) clearInterval(this._timer);
  }

  async tick () {
    try {
      const voice = await groupVoiceClient.fetchVoice({ token: this.props.authToken });
      const joined = !!(voice && voice.joined && voice.groupId === this.props.groupId);
      if (joined !== this.state.joined) this.setState({ joined });
    } catch (_) { /* ignore */ }
  }

  async authOpts () {
    let token = this.props.authToken || null;
    if (!token && typeof this.props.getAuthToken === 'function') {
      try { token = await this.props.getAuthToken(); } catch (_) { token = null; }
    }
    return {
      token: token || null,
      pubkey: this.props.identityPubkey || this.props.pubkey || null
    };
  }

  async toggle () {
    const groupId = this.props.groupId;
    if (!groupId || this.state.busy) return;
    this.setState({ busy: true, error: null });
    try {
      const opts = await this.authOpts();
      if (this.state.joined) await groupVoiceClient.leaveVoice(groupId, opts);
      else {
        await groupVoiceClient.joinVoice(groupId, {
          handle: this.props.handle || null,
          pubkey: opts.pubkey
        }, opts);
      }
      await this.tick();
      if (typeof this.props.onChange === 'function') this.props.onChange();
      this.setState({ busy: false });
    } catch (e) {
      this.setState({ busy: false, error: (e && e.message) || 'voice failed' });
    }
  }

  render () {
    if (!this.props.groupId) return null;
    const joined = !!this.state.joined;
    return React.createElement(React.Fragment, null,
      React.createElement('button', {
        type: 'button',
        className: (this.props.className || 'chat-voice-btn') + (joined ? ' on' : ''),
        disabled: !!this.state.busy || !!this.props.disabled,
        title: joined ? 'Leave voice' : 'Join voice (push-to-talk)',
        'aria-label': joined ? 'Leave voice' : 'Join voice',
        'aria-pressed': joined,
        onClick: () => this.toggle()
      }, joined ? 'Leave voice' : 'Join voice'),
      this.state.error
        ? React.createElement('span', { className: 'avp-err', style: { fontSize: 11 } }, this.state.error)
        : null
    );
  }
}

class ActiveVoicePanel extends React.Component {
  constructor (props) {
    super(props);
    this.state = {
      voice: null,
      error: null,
      pttHeld: false,
      muted: false,
      deafened: false
    };
    this._mesh = null;
    this._rosterTimer = null;
    this._signalTimer = null;
    this._onKeyDown = this._onKeyDown.bind(this);
    this._onKeyUp = this._onKeyUp.bind(this);
    this._unsubPtt = null;
  }

  componentDidMount () {
    this.refresh();
    this._rosterTimer = setInterval(() => this.refresh(), 1000);
    this._signalTimer = setInterval(() => this.drainSignals(), 300);
    window.addEventListener('keydown', this._onKeyDown);
    window.addEventListener('keyup', this._onKeyUp);
    const api = typeof window !== 'undefined' && window.electronAPI && window.electronAPI.voice;
    if (api && typeof api.onPtt === 'function') {
      this._unsubPtt = api.onPtt((held) => this.setPtt(!!held));
    }
  }

  componentWillUnmount () {
    window.removeEventListener('keydown', this._onKeyDown);
    window.removeEventListener('keyup', this._onKeyUp);
    if (this._rosterTimer) clearInterval(this._rosterTimer);
    if (this._signalTimer) clearInterval(this._signalTimer);
    if (typeof this._unsubPtt === 'function') this._unsubPtt();
    this.stopMesh();
  }

  bind () {
    const settings = (this.state.voice && this.state.voice.settings) || groupVoiceSettings.defaultVoiceSettings();
    return settings.pttKey;
  }

  _onKeyDown (ev) {
    if (ev.repeat) return;
    const tag = ev.target && ev.target.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || (ev.target && ev.target.isContentEditable)) return;
    if (!this.state.voice || !this.state.voice.joined) return;
    const settings = this.state.voice.settings || {};
    if (settings.mode === 'vad') return;
    if (groupVoiceSettings.matchesPttKey(ev, this.bind())) {
      ev.preventDefault();
      this.setPtt(true);
    }
  }

  _onKeyUp (ev) {
    if (!this.state.voice || !this.state.voice.joined) return;
    const settings = this.state.voice.settings || {};
    if (settings.mode === 'vad') return;
    if (!this.state.pttHeld) return;
    if (groupVoiceSettings.pttComboReleased(ev, this.bind())) {
      ev.preventDefault();
      this.setPtt(false);
    }
  }

  setPtt (held) {
    if (!this.state.voice || !this.state.voice.joined) return;
    const settings = this.state.voice.settings || {};
    if (settings.mode === 'vad') return;
    this.setState({ pttHeld: !!held });
    if (this._mesh) this._mesh.setTalking(!!held);
    const groupId = this.state.voice.groupId;
    if (groupId) {
      groupVoiceClient.publishSpeaking(groupId, !!held).catch(() => {});
    }
  }

  stopMesh () {
    if (this._mesh) {
      try { this._mesh.stop(); } catch (_) { /* ignore */ }
      this._mesh = null;
    }
  }

  async ensureMesh (voice) {
    if (!voice || !voice.joined) {
      this.stopMesh();
      return;
    }
    if (!this._mesh) {
      const settings = voice.settings || groupVoiceSettings.defaultVoiceSettings();
      this._mesh = new VoiceMesh({
        localPeerId: voice.webrtcPeerId,
        localMember: {
          webrtcPeerId: voice.webrtcPeerId,
          joinedAt: voice.joinedAt
        },
        inputDeviceId: settings.inputDeviceId,
        outputDeviceId: settings.outputDeviceId,
        sendSignal: (toPeerId, signal) => groupVoiceClient.sendVoiceSignal(voice.groupId, toPeerId, signal),
        onSpeaking: (on) => {
          groupVoiceClient.publishSpeaking(voice.groupId, on).catch(() => {});
        }
      });
      this._mesh.setMode(settings.mode);
      this._mesh.setMuted(!!this.state.muted || !!settings.muted);
      this._mesh.setDeafened(!!this.state.deafened || !!settings.deafened);
      this._mesh.setVadSensitivity(settings.vadSensitivity);
    }
    try {
      await this._mesh.syncMembers(voice.members || []);
    } catch (e) {
      this.setState({ error: (e && e.message) || 'microphone failed' });
    }
  }

  async drainSignals () {
    if (!this.state.voice || !this.state.voice.joined || !this._mesh) return;
    try {
      const rows = await groupVoiceClient.fetchVoiceSignals();
      for (const row of rows || []) {
        if (!row || row.fromPeerId === this.state.voice.webrtcPeerId) continue;
        await this._mesh.handleSignal(row.fromPeerId, row.signal);
      }
    } catch (_) { /* ignore */ }
  }

  async refresh () {
    try {
      const voice = await groupVoiceClient.fetchVoice();
      const joined = !!(voice && voice.joined);
      this.setState({ voice, error: joined ? this.state.error : null });
      const bindKey = JSON.stringify(voice && voice.settings && {
        mode: voice.settings.mode,
        pttKey: voice.settings.pttKey
      });
      if (bindKey && bindKey !== this._pttBindKey) {
        this._pttBindKey = bindKey;
        groupVoiceSettings.applyElectronPttBind(voice.settings);
      }
      await this.ensureMesh(joined ? voice : null);
      if (typeof this.props.onVoice === 'function') this.props.onVoice(voice);
    } catch (_) {
      /* relay offline */
    }
  }

  async leave () {
    try {
      await groupVoiceClient.leaveVoice();
      this.stopMesh();
      await this.refresh();
    } catch (e) {
      this.setState({ error: (e && e.message) || 'leave failed' });
    }
  }

  toggleMute () {
    const muted = !this.state.muted;
    this.setState({ muted });
    if (this._mesh) this._mesh.setMuted(muted);
  }

  toggleDeafen () {
    const deafened = !this.state.deafened;
    this.setState({ deafened });
    if (this._mesh) this._mesh.setDeafened(deafened);
    if (deafened && this._mesh) this._mesh.setTalking(false);
  }

  openGroup () {
    const id = this.state.voice && this.state.voice.groupId;
    if (!id) return;
    window.location.hash = 'groups';
    window.location.search = '';
    try { window.location.href = '/groups/' + encodeURIComponent(id); } catch (_) { /* ignore */ }
  }

  render () {
    const voice = this.state.voice;
    if (!voice || !voice.joined) return null;
    const settings = voice.settings || groupVoiceSettings.defaultVoiceSettings();
    const members = voice.members || [];
    const ptt = settings.mode !== 'vad';
    return React.createElement('div', { className: 'avp', role: 'status' },
      React.createElement('div', { className: 'avp-card' },
        React.createElement('div', { className: 'avp-top' },
          React.createElement('button', {
            type: 'button',
            className: 'avp-name',
            title: 'Open group',
            onClick: () => this.openGroup()
          }, voice.groupName || 'Voice'),
          React.createElement('span', { className: 'avp-sub' },
            members.length + '/' + (voice.cap || 8))
        ),
        React.createElement('div', { className: 'avp-dots', 'aria-label': 'Speakers' },
          members.map((m) => React.createElement('span', {
            key: m.webrtcPeerId || m.pubkey,
            className: 'avp-dot' + (m.speaking ? ' on' : ''),
            title: m.handle || (m.pubkey && m.pubkey.slice(0, 8))
          }))
        ),
        this.state.error ? React.createElement('div', { className: 'avp-err' }, this.state.error) : null,
        React.createElement('div', { className: 'avp-row' },
          React.createElement('button', {
            type: 'button',
            className: 'avp-btn' + (this.state.muted ? ' on' : ''),
            onClick: () => this.toggleMute()
          }, this.state.muted ? 'Unmute' : 'Mute'),
          ptt
            ? React.createElement('button', {
              type: 'button',
              className: 'avp-btn ptt' + (this.state.pttHeld ? ' held' : ''),
              onPointerDown: (e) => { e.preventDefault(); this.setPtt(true); },
              onPointerUp: () => this.setPtt(false),
              onPointerLeave: () => this.setPtt(false),
              title: groupVoiceSettings.pttBindLabel(settings.pttKey)
            }, this.state.pttHeld ? 'Talking' : groupVoiceSettings.pttBindLabel(settings.pttKey))
            : React.createElement('span', { className: 'avp-sub' }, 'Voice activity'),
          React.createElement('button', {
            type: 'button',
            className: 'avp-btn' + (this.state.deafened ? ' on' : ''),
            onClick: () => this.toggleDeafen()
          }, this.state.deafened ? 'Undeafen' : 'Deafen'),
          React.createElement('button', {
            type: 'button',
            className: 'avp-btn leave',
            onClick: () => this.leave()
          }, 'Leave')
        )
      )
    );
  }
}

ActiveVoicePanel.CSS = CSS;
ActiveVoicePanel.JoinVoiceButton = JoinVoiceButton;
module.exports = ActiveVoicePanel;
module.exports.JoinVoiceButton = JoinVoiceButton;
