'use strict';

/**
 * Settings modal — operator relay settings.
 *
 * Mirrors the Hub's settings surface (`GET /settings`, `PUT /settings/:name`).
 * Peer management lives on the top-level Peers tab (`components/Peers.js`),
 * revealed via the "Advanced mode" toggle here (client-only preference).
 */

const React = require('react');
const { showDesktopNotification, ensureNotifyPermission } = require('../functions/desktopNotify');

const CSS = `
  .st-overlay{position:fixed;inset:0;z-index:40;background:rgba(8,10,14,.7);
    display:flex;align-items:flex-start;justify-content:center;padding:60px 16px 30px;backdrop-filter:blur(2px)}
  .st-card{background:var(--panel);border:1px solid var(--line);border-radius:12px;
    width:min(640px,94vw);max-height:84vh;overflow:auto}
  .st-head{display:flex;align-items:center;gap:10px;padding:14px 18px;border-bottom:1px solid var(--line);
    position:sticky;top:0;background:var(--panel);z-index:1}
  .st-head h2{margin:0;font-size:16px;flex:1}
  .st-x{background:none;border:none;color:var(--muted);font-size:18px;cursor:pointer;padding:2px 8px}
  .st-x:hover{color:var(--text)}
  .st-sec{padding:14px 18px;border-bottom:1px solid var(--line)}
  .st-sec h3{margin:0 0 4px;font-size:13px}
  .st-sec .d{color:var(--muted);font-size:12px;margin-bottom:10px}
  .st-field{display:grid;gap:5px;margin-bottom:10px}
  .st-field label{font-size:12px;color:var(--muted)}
  .st-field input{width:100%;background:var(--bg);border:1px solid var(--line);color:var(--text);
    border-radius:7px;padding:8px 10px;font-size:13px;box-sizing:border-box;
    font-family:'Cascadia Code',Consolas,monospace}
  .st-row{display:flex;gap:8px;align-items:center}
  .st-btn{background:var(--accent);border:none;color:#fff;border-radius:7px;padding:7px 14px;
    font-size:12.5px;font-weight:600;cursor:pointer;white-space:nowrap}
  .st-btn:disabled{opacity:.45;cursor:default}
  .st-btn.ghost{background:var(--panel2);border:1px solid var(--line);color:var(--text)}
  .st-err{background:rgba(248,81,73,.12);color:var(--kill);border-radius:7px;padding:8px 11px;font-size:12.5px;margin-bottom:10px}
  .st-note{background:rgba(210,153,34,.12);color:var(--warn);border-radius:7px;padding:8px 11px;font-size:12.5px;margin-top:10px}
  .st-runtime{color:var(--muted);font-size:11.5px;display:grid;gap:3px;
    font-family:'Cascadia Code',Consolas,monospace}
  .st-runtime b{color:var(--text);font-weight:600}
  .gear{background:var(--panel2);border:1px solid var(--line);color:var(--text);border-radius:7px;
    padding:5px 11px;font-size:14px;cursor:pointer;line-height:1}
  .gear:hover{border-color:var(--accent)}
`;

class Settings extends React.Component {
  constructor (props) {
    super(props);
    this.state = {
      loading: true,
      error: null,
      editable: false,
      requiresRestart: false,
      runtime: {},
      logfile: '',
      channel: '',
      discordWebhook: '',
      snapshotsEnabled: false,
      snapshotIntervalSeconds: 10,
      snapshotAutoPurge: true,
      snapshotMaxMB: 256,
      shareLogsGlobal: false,
      notifyDesktop: true,
      notifyChatGlobal: true,
      notifyChatGroups: true,
      notifyWhenFocused: false,
      notifyMissionBroadcasts: true,
      peerCount: 0,
      busy: false
    };
  }

  componentDidMount () {
    this.load();
  }

  async load () {
    this.setState({ loading: true, error: null });
    try {
      const [settingsRes, peersRes] = await Promise.all([
        fetch('/settings').then((r) => r.json()),
        fetch('/peers').then((r) => (r.ok ? r.json() : { data: [] })).catch(() => ({ data: [] }))
      ]);
      const s = settingsRes.settings || {};
      this.setState({
        loading: false,
        editable: !!settingsRes.editable,
        requiresRestart: !!settingsRes.requiresRestart,
        runtime: settingsRes.runtime || {},
        logfile: s.logfile || '',
        channel: s.channel || '',
        discordWebhook: s.discordWebhook || '',
        snapshotsEnabled: !!s.snapshotsEnabled,
        snapshotIntervalSeconds: s.snapshotIntervalSeconds || 10,
        snapshotAutoPurge: s.snapshotAutoPurge !== false,
        snapshotMaxMB: s.snapshotMaxMB || 256,
        shareLogsGlobal: s.shareLogsGlobal === true || (settingsRes.runtime && settingsRes.runtime.shareLogsGlobal === true),
        notifyDesktop: s.notifyDesktop !== false,
        notifyChatGlobal: s.notifyChatGlobal !== false,
        notifyChatGroups: s.notifyChatGroups !== false,
        notifyWhenFocused: !!s.notifyWhenFocused,
        notifyMissionBroadcasts: s.notifyMissionBroadcasts !== false,
        peerCount: Array.isArray(peersRes.data) ? peersRes.data.length : 0
      });
    } catch (e) {
      this.setState({ loading: false, error: e.message });
    }
  }

  async putNotify (key, value) {
    this.setState({ [key]: value, error: null });
    try {
      await this.put(key, value);
    } catch (err) {
      this.setState({ error: err.message });
    }
  }

  async testNotify () {
    const perm = await ensureNotifyPermission();
    if (perm === 'denied' || perm === 'unsupported') {
      this.setState({ error: perm === 'unsupported'
        ? 'Desktop notifications are not available in this environment'
        : 'Notification permission denied — enable it in your OS / browser settings' });
      return;
    }
    const ok = await showDesktopNotification({
      title: 'GoonCitizen',
      body: 'Desktop notifications are working.'
    });
    if (!ok) this.setState({ error: 'Could not show a test notification' });
  }

  async put (name, value) {
    const res = await fetch(`/settings/${encodeURIComponent(name)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ value: value === '' ? null : value })
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
    return json;
  }

  async save () {
    if (this.state.busy || !this.state.editable) return;
    this.setState({ busy: true, error: null });
    try {
      await this.put('logfile', this.state.logfile.trim() || null);
      await this.put('channel', this.state.channel.trim() || null);
      await this.put('discordWebhook', this.state.discordWebhook.trim() || null);
      this.setState({ busy: false, requiresRestart: true });
      await this.load();
    } catch (e) {
      this.setState({ busy: false, error: e.message });
    }
  }

  /** Snapshot settings apply live (no relay restart). */
  async saveSnapshots () {
    if (this.state.busy || !this.state.editable) return;
    this.setState({ busy: true, error: null });
    try {
      const interval = Math.max(2, Math.floor(Number(this.state.snapshotIntervalSeconds) || 10));
      const maxMB = Math.max(16, Math.floor(Number(this.state.snapshotMaxMB) || 256));
      await this.put('snapshotsEnabled', !!this.state.snapshotsEnabled);
      await this.put('snapshotIntervalSeconds', interval);
      await this.put('snapshotAutoPurge', !!this.state.snapshotAutoPurge);
      await this.put('snapshotMaxMB', maxMB);
      this.setState({ busy: false, snapshotIntervalSeconds: interval, snapshotMaxMB: maxMB });
      await this.load();
    } catch (e) {
      this.setState({ busy: false, error: e.message });
    }
  }

  async restart () {
    if (window.electronAPI && window.electronAPI.restartService) {
      await window.electronAPI.restartService();
    }
  }

  field (label, key, placeholder, hint) {
    return React.createElement('div', { className: 'st-field' },
      React.createElement('label', null, label),
      React.createElement('input', {
        type: 'text',
        value: this.state[key],
        placeholder: placeholder || '',
        onChange: (e) => this.setState({ [key]: e.target.value })
      }),
      hint ? React.createElement('span', { style: { fontSize: 11, color: 'var(--muted)' } }, hint) : null
    );
  }

  async pickLogFile () {
    if (!(window.electronAPI && window.electronAPI.dialog && window.electronAPI.dialog.openLogFile)) return;
    try {
      const result = await window.electronAPI.dialog.openLogFile();
      if (!result || result.canceled || !result.path) return;
      this.setState({ logfile: result.path });
    } catch (e) {
      this.setState({ error: e.message || String(e) });
    }
  }

  render () {
    const rt = this.state.runtime;
    return React.createElement('div', { className: 'st-overlay', onClick: (e) => { if (e.target === e.currentTarget) this.props.onClose(); } },
      React.createElement('div', { className: 'st-card' },
        React.createElement('div', { className: 'st-head' },
          React.createElement('h2', null, '⚙️ Settings'),
          React.createElement('button', { className: 'st-x', title: 'Close', onClick: () => this.props.onClose() }, '✕')
        ),
        this.state.loading
          ? React.createElement('div', { className: 'st-sec' }, 'loading…')
          : React.createElement(React.Fragment, null,
            this.state.error ? React.createElement('div', { className: 'st-sec' }, React.createElement('div', { className: 'st-err' }, this.state.error)) : null,

            React.createElement('div', { className: 'st-sec' },
              React.createElement('h3', null, 'Relay'),
              React.createElement('div', { className: 'd' }, 'Where the game log comes from. Leave blank to auto-detect the freshest Game.log across drives and channels. To import historical log folders or individual files, use Feed → Import logs.'),
              this.field('Game.log path', 'logfile', 'auto-detect (e.g. C:\\...\\StarCitizen\\LIVE\\Game.log)'),
              (window.electronAPI && window.electronAPI.dialog && window.electronAPI.dialog.openLogFile)
                ? React.createElement('div', { className: 'st-row', style: { marginTop: -4, marginBottom: 10 } },
                  React.createElement('button', {
                    type: 'button', className: 'st-btn ghost',
                    style: { padding: '3px 10px', fontSize: 11 },
                    disabled: !this.state.editable || this.state.busy,
                    onClick: () => this.pickLogFile()
                  }, 'Browse for Game.log…')
                )
                : null,
              this.field('Channel', 'channel', 'auto (LIVE / PTU / EPTU / HOTFIX / TECH-PREVIEW)'),
              this.field('Discord webhook URL', 'discordWebhook', 'https://discord.com/api/webhooks/… (optional)'),
              React.createElement('div', { className: 'st-row' },
                React.createElement('button', { className: 'st-btn', disabled: !this.state.editable || this.state.busy, onClick: () => this.save() }, this.state.busy ? 'Saving…' : 'Save'),
                !this.state.editable ? React.createElement('span', { style: { fontSize: 11.5, color: 'var(--muted)' } }, 'read-only: no settings directory configured') : null
              ),
              this.state.requiresRestart
                ? React.createElement('div', { className: 'st-note' },
                  'Saved. Log settings apply after a restart. ',
                  (window.electronAPI && window.electronAPI.restartService)
                    ? React.createElement('button', { className: 'st-btn ghost', style: { marginLeft: 8, padding: '3px 10px', fontSize: 11 }, onClick: () => this.restart() }, 'Restart relay now')
                    : 'Restart the relay to apply.')
                : null
            ),

            React.createElement('div', { className: 'st-sec' },
              React.createElement('h3', null, 'Snapshots'),
              React.createElement('div', { className: 'd' },
                'Opt-in periodic screen captures while you play — stored reduced-size in the Library for later image analysis. Desktop app only; applies live.'),
              React.createElement('label', { style: { display: 'flex', gap: 8, alignItems: 'center', fontSize: 13, cursor: 'pointer', marginBottom: 10 } },
                React.createElement('input', {
                  type: 'checkbox',
                  checked: this.state.snapshotsEnabled,
                  onChange: (e) => this.setState({ snapshotsEnabled: e.target.checked })
                }),
                'Capture snapshots of my screen while GoonCitizen runs'
              ),
              React.createElement('div', { className: 'st-row', style: { flexWrap: 'wrap' } },
                React.createElement('label', { style: { fontSize: 12, color: 'var(--muted)', display: 'flex', gap: 6, alignItems: 'center' } },
                  'every',
                  React.createElement('input', {
                    type: 'number', min: 2, max: 3600, value: this.state.snapshotIntervalSeconds,
                    style: { width: 70, background: 'var(--bg)', border: '1px solid var(--line)', color: 'var(--text)', borderRadius: 7, padding: '6px 8px' },
                    onChange: (e) => this.setState({ snapshotIntervalSeconds: e.target.value })
                  }),
                  'seconds'
                ),
                React.createElement('label', { style: { fontSize: 12, color: 'var(--muted)', display: 'flex', gap: 6, alignItems: 'center' } },
                  React.createElement('input', {
                    type: 'checkbox',
                    checked: this.state.snapshotAutoPurge,
                    onChange: (e) => this.setState({ snapshotAutoPurge: e.target.checked })
                  }),
                  'auto-purge oldest beyond'
                ),
                React.createElement('label', { style: { fontSize: 12, color: 'var(--muted)', display: 'flex', gap: 6, alignItems: 'center' } },
                  React.createElement('input', {
                    type: 'number', min: 16, max: 65536, value: this.state.snapshotMaxMB,
                    style: { width: 80, background: 'var(--bg)', border: '1px solid var(--line)', color: 'var(--text)', borderRadius: 7, padding: '6px 8px' },
                    onChange: (e) => this.setState({ snapshotMaxMB: e.target.value })
                  }),
                  'MB'
                ),
                React.createElement('button', { className: 'st-btn', disabled: !this.state.editable || this.state.busy, onClick: () => this.saveSnapshots() }, 'Apply')
              ),
              rt.snapshots
                ? React.createElement('div', { style: { fontSize: 11.5, color: 'var(--muted)', marginTop: 8 } },
                  `${rt.snapshots.count} stored · ${(rt.snapshots.bytes / (1024 * 1024)).toFixed(1)} MB`,
                  rt.snapshots.enabled && !rt.snapshots.available ? ' · capture needs the desktop app' : '',
                  rt.snapshots.lastError ? ` · last error: ${rt.snapshots.lastError}` : '',
                  ' · view in the Library tab')
                : null
            ),

            React.createElement('div', { className: 'st-sec' },
              React.createElement('h3', null, 'Identity & presence'),
              React.createElement('div', { className: 'd' },
                'Nickname, Star Citizen handle, bio, and online status (ship sharing) live on the identity card in the header — click your key / nickname pill.'),
              React.createElement('div', { className: 'st-row' },
                React.createElement('button', {
                  className: 'st-btn ghost',
                  type: 'button',
                  onClick: () => {
                    if (typeof this.props.onOpenIdentity === 'function') {
                      this.props.onClose();
                      this.props.onOpenIdentity();
                    }
                  }
                }, 'Open Identity')
              )
            ),

            React.createElement('div', { className: 'st-sec' },
              React.createElement('h3', null, 'Desktop notifications'),
              React.createElement('div', { className: 'd' },
                'OS notifications for new chat messages. The global chat dock stays available on every tab; the Chat page still covers all channels.'),
              React.createElement('label', { style: { display: 'flex', gap: 8, alignItems: 'center', fontSize: 13, cursor: 'pointer', marginBottom: 8 } },
                React.createElement('input', {
                  type: 'checkbox',
                  checked: this.state.notifyDesktop,
                  disabled: !this.state.editable || this.state.busy,
                  onChange: (e) => this.putNotify('notifyDesktop', e.target.checked)
                }),
                'Enable desktop notifications'
              ),
              React.createElement('label', { style: { display: 'flex', gap: 8, alignItems: 'center', fontSize: 13, cursor: 'pointer', marginBottom: 8 } },
                React.createElement('input', {
                  type: 'checkbox',
                  checked: this.state.notifyChatGlobal,
                  disabled: !this.state.editable || this.state.busy || !this.state.notifyDesktop,
                  onChange: (e) => this.putNotify('notifyChatGlobal', e.target.checked)
                }),
                'Global chat messages'
              ),
              React.createElement('label', { style: { display: 'flex', gap: 8, alignItems: 'center', fontSize: 13, cursor: 'pointer', marginBottom: 8 } },
                React.createElement('input', {
                  type: 'checkbox',
                  checked: this.state.notifyChatGroups,
                  disabled: !this.state.editable || this.state.busy || !this.state.notifyDesktop,
                  onChange: (e) => this.putNotify('notifyChatGroups', e.target.checked)
                }),
                'Group chat messages'
              ),
              React.createElement('label', { style: { display: 'flex', gap: 8, alignItems: 'center', fontSize: 13, cursor: 'pointer', marginBottom: 8 } },
                React.createElement('input', {
                  type: 'checkbox',
                  checked: this.state.notifyWhenFocused,
                  disabled: !this.state.editable || this.state.busy || !this.state.notifyDesktop,
                  onChange: (e) => this.putNotify('notifyWhenFocused', e.target.checked)
                }),
                'Notify even when this window is focused'
              ),
              React.createElement('label', { style: { display: 'flex', gap: 8, alignItems: 'center', fontSize: 13, cursor: 'pointer', marginBottom: 10 } },
                React.createElement('input', {
                  type: 'checkbox',
                  checked: this.state.notifyMissionBroadcasts,
                  disabled: !this.state.editable || this.state.busy || !this.state.notifyDesktop,
                  onChange: (e) => this.putNotify('notifyMissionBroadcasts', e.target.checked)
                }),
                'Mission broadcasts from peers (Accept / Ignore)'
              ),
              React.createElement('div', { className: 'st-row' },
                React.createElement('button', {
                  className: 'st-btn ghost',
                  disabled: this.state.busy,
                  onClick: () => this.testNotify()
                }, 'Send test notification')
              )
            ),

            React.createElement('div', { className: 'st-sec' },
              React.createElement('h3', null, 'Profile activity'),
              React.createElement('div', { className: 'd' },
                'Show the Home “When you fly” activity heatmap on Identity and peer profiles. Uses the same cumulative analytics as the stats pages. Stored in this browser.'),
              React.createElement('label', { style: { display: 'flex', gap: 8, alignItems: 'center', fontSize: 13, cursor: 'pointer' } },
                React.createElement('input', {
                  type: 'checkbox',
                  checked: this.props.showProfileActivity !== false,
                  onChange: (e) => {
                    if (typeof this.props.onShowProfileActivityChange === 'function') {
                      this.props.onShowProfileActivityChange(e.target.checked);
                    }
                  }
                }),
                'Show activity graph on player profiles'
              )
            ),

            React.createElement('div', { className: 'st-sec' },
              React.createElement('h3', null, 'Advanced mode'),
              React.createElement('div', { className: 'd' },
                'Reveal advanced features: Peers (Fabric Network management) and Messages (complete AMP wire Message log — Fabric Messages only, not Game.log). Stored in this browser.'),
              React.createElement('label', { style: { display: 'flex', gap: 8, alignItems: 'center', fontSize: 13, cursor: 'pointer' } },
                React.createElement('input', {
                  type: 'checkbox',
                  checked: !!this.props.advancedMode,
                  onChange: (e) => {
                    if (typeof this.props.onAdvancedModeChange === 'function') {
                      this.props.onAdvancedModeChange(e.target.checked);
                    }
                  }
                }),
                'Enable advanced mode (Peers + Fabric Messages)'
              )
            ),

            React.createElement('div', { className: 'st-sec' },
              React.createElement('h3', null, 'Fabric Network'),
              React.createElement('div', { className: 'd' },
                'Fabric peers (hub.fabric.pub:7777 and relay.goon.vc:7777 are seeded by default) receive your signed wire Messages over TCP/NOISE. Log events stay private until you authorize sharing — prefer per-peer grants on the Peers tab, or enable global below.'),
              React.createElement('label', { style: { display: 'flex', gap: 8, alignItems: 'center', fontSize: 13, cursor: 'pointer', marginBottom: 10 } },
                React.createElement('input', {
                  type: 'checkbox',
                  checked: this.state.shareLogsGlobal,
                  disabled: !this.state.editable || this.state.busy,
                  onChange: async (e) => {
                    const value = e.target.checked;
                    this.setState({ shareLogsGlobal: value });
                    try { await this.put('shareLogsGlobal', value); } catch (err) { this.setState({ error: err.message }); }
                  }
                }),
                'Share logs to global — push my parsed game events to every connected Fabric peer'
              ),
              React.createElement('div', { className: 'd', style: { marginTop: -4, marginBottom: 10 } },
                'Default is off. Per-peer “Share logs” on Peers is the usual path for authorizing a network hub.'),
              React.createElement('div', { className: 'st-row' },
                React.createElement('span', { style: { fontSize: 12.5, color: 'var(--muted)' } },
                  this.state.peerCount
                    ? `${this.state.peerCount} peer${this.state.peerCount === 1 ? '' : 's'} configured`
                    : 'no peers configured'),
                this.props.advancedMode
                  ? React.createElement(React.Fragment, null,
                    React.createElement('button', {
                      className: 'st-btn ghost',
                      onClick: () => {
                        this.props.onClose();
                        window.location.hash = 'peers';
                      }
                    }, 'Open Peers'),
                    React.createElement('button', {
                      className: 'st-btn ghost',
                      onClick: () => {
                        this.props.onClose();
                        window.location.hash = 'messages';
                      }
                    }, 'Fabric Messages')
                  )
                  : React.createElement('span', { style: { fontSize: 11.5, color: 'var(--muted)' } }, 'enable Advanced mode for Peers + Messages')
              )
            ),

            React.createElement('div', { className: 'st-sec' },
              React.createElement('h3', null, 'Runtime'),
              React.createElement('div', { className: 'st-runtime' },
                React.createElement('span', null, 'log: ', React.createElement('b', null, rt.logfile || 'not found (auto-detect)')),
                React.createElement('span', null, 'channel: ', React.createElement('b', null, rt.channel || '—'), '  ·  port: ', React.createElement('b', null, rt.port || '—')),
                React.createElement('span', null, 'identity: ', React.createElement('b', null, rt.identity ? rt.identity.slice(0, 16) + '…' : 'locked / none')),
                React.createElement('span', null, 'uplink: ', React.createElement('b', null, rt.uplinkActive ? `active (${rt.uplinkQueued} queued)` : 'idle'))
              )
            )
          )
      )
    );
  }
}

Settings.CSS = CSS;

module.exports = Settings;
