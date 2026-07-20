'use strict';

/**
 * Settings modal — operator settings + peer management.
 *
 * Mirrors the Hub's settings surface (`GET /settings`, `PUT /settings/:name`)
 * and its peer semantics (ListPeers/AddPeer/RemovePeer) against the local
 * relay. Peers are remote hubs (e.g. https://goon.vc) that receive this
 * relay's Schnorr-signed event batches while the identity is unlocked.
 */

const React = require('react');

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
  .st-btn.danger{background:transparent;border:1px solid var(--line);color:var(--kill);padding:3px 9px;font-size:11px;font-weight:500}
  .st-peer{display:flex;gap:10px;align-items:center;padding:8px 0;border-bottom:1px solid #20262f}
  .st-peer:last-child{border-bottom:none}
  .st-peer .u{flex:1;min-width:0}
  .st-peer .url{font-family:'Cascadia Code',Consolas,monospace;font-size:12px;word-break:break-all}
  .st-peer .meta{color:var(--muted);font-size:11px;margin-top:2px}
  .st-peer .meta .err{color:var(--kill)}
  .st-peer .meta .ok{color:var(--good)}
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
      // fields
      logfile: '',
      channel: '',
      discordWebhook: '',
      // peers
      peers: [],
      newPeerUrl: '',
      newPeerLabel: '',
      busy: false
    };
  }

  componentDidMount () {
    this.load();
  }

  async load () {
    try {
      const [settingsRes, peersRes] = await Promise.all([
        fetch('/settings').then((r) => r.json()),
        fetch('/peers').then((r) => r.json())
      ]);
      const s = settingsRes.settings || {};
      this.setState({
        loading: false,
        editable: !!settingsRes.editable,
        runtime: settingsRes.runtime || {},
        logfile: s.logfile || '',
        channel: s.channel || '',
        discordWebhook: s.discordWebhook || '',
        peers: peersRes.data || []
      });
    } catch (e) {
      this.setState({ loading: false, error: 'Could not load settings: ' + e.message });
    }
  }

  async put (name, value) {
    const res = await fetch(`/settings/${name}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ value: value === '' ? null : value })
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
    if (json.requiresRestart) this.setState({ requiresRestart: true });
    return json;
  }

  async save () {
    if (this.state.busy) return;
    this.setState({ busy: true, error: null });
    try {
      await this.put('logfile', this.state.logfile.trim());
      await this.put('channel', this.state.channel.trim());
      await this.put('discordWebhook', this.state.discordWebhook.trim());
      this.setState({ busy: false });
    } catch (e) {
      this.setState({ busy: false, error: e.message });
    }
  }

  async addPeer () {
    const url = this.state.newPeerUrl.trim();
    if (!/^https?:\/\//.test(url) || this.state.busy) return;
    this.setState({ busy: true, error: null });
    try {
      const res = await fetch('/peers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url, label: this.state.newPeerLabel.trim() || null })
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
      this.setState({ busy: false, newPeerUrl: '', newPeerLabel: '' });
      await this.load();
    } catch (e) {
      this.setState({ busy: false, error: e.message });
    }
  }

  async togglePeer (peer) {
    if (this.state.busy) return;
    this.setState({ busy: true, error: null });
    try {
      await fetch(`/peers/${peer.id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: !(peer.enabled !== false) })
      });
      this.setState({ busy: false });
      await this.load();
    } catch (e) {
      this.setState({ busy: false, error: e.message });
    }
  }

  async removePeer (peer) {
    if (this.state.busy) return;
    this.setState({ busy: true, error: null });
    try {
      await fetch(`/peers/${peer.id}`, { method: 'DELETE' });
      this.setState({ busy: false });
      await this.load();
    } catch (e) {
      this.setState({ busy: false, error: e.message });
    }
  }

  async restart () {
    if (window.electronAPI && window.electronAPI.restartService) {
      this.setState({ busy: true });
      try { await window.electronAPI.restartService(); } catch (_) { /* window reloads */ }
      this.setState({ busy: false, requiresRestart: false });
      await this.load();
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

            // --- Relay ---
            React.createElement('div', { className: 'st-sec' },
              React.createElement('h3', null, 'Relay'),
              React.createElement('div', { className: 'd' }, 'Where the game log comes from. Leave blank to auto-detect the freshest Game.log across drives and channels.'),
              this.field('Game.log path', 'logfile', 'auto-detect (e.g. C:\\...\\StarCitizen\\LIVE\\Game.log)'),
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

            // --- Peers ---
            React.createElement('div', { className: 'st-sec' },
              React.createElement('h3', null, 'Peers'),
              React.createElement('div', { className: 'd' },
                'Remote hubs that receive your signed event batches (e.g. https://goon.vc). Pushing starts when your identity is unlocked; delivery is idempotent, so multiple peers are safe.'),
              this.state.peers.length
                ? this.state.peers.map((p) => React.createElement('div', { className: 'st-peer', key: p.id },
                  React.createElement('div', { className: 'u' },
                    React.createElement('div', { className: 'url' }, (p.label ? p.label + ' — ' : '') + p.url),
                    React.createElement('div', { className: 'meta' },
                      p.enabled === false
                        ? 'disabled'
                        : (p.lastError
                          ? React.createElement('span', { className: 'err' }, 'error: ' + p.lastError)
                          : (p.lastSeen
                            ? React.createElement('span', { className: 'ok' }, 'last push ' + String(p.lastSeen).slice(11, 19))
                            : 'no pushes yet'))
                    )
                  ),
                  React.createElement('button', { className: 'st-btn ghost', style: { padding: '3px 10px', fontSize: 11 }, disabled: this.state.busy, onClick: () => this.togglePeer(p) }, p.enabled === false ? 'Enable' : 'Disable'),
                  React.createElement('button', { className: 'st-btn danger', disabled: this.state.busy, onClick: () => this.removePeer(p) }, 'Remove')
                ))
                : React.createElement('div', { style: { color: 'var(--muted)', fontSize: 12.5, padding: '4px 0 10px' } }, 'no peers configured'),
              React.createElement('div', { className: 'st-row', style: { marginTop: 8 } },
                React.createElement('input', {
                  type: 'text', value: this.state.newPeerUrl, placeholder: 'https://goon.vc',
                  style: { flex: 2, background: 'var(--bg)', border: '1px solid var(--line)', color: 'var(--text)', borderRadius: 7, padding: '7px 10px', fontSize: 12.5 },
                  onChange: (e) => this.setState({ newPeerUrl: e.target.value })
                }),
                React.createElement('input', {
                  type: 'text', value: this.state.newPeerLabel, placeholder: 'label (optional)',
                  style: { flex: 1, background: 'var(--bg)', border: '1px solid var(--line)', color: 'var(--text)', borderRadius: 7, padding: '7px 10px', fontSize: 12.5 },
                  onChange: (e) => this.setState({ newPeerLabel: e.target.value })
                }),
                React.createElement('button', {
                  className: 'st-btn',
                  disabled: !/^https?:\/\//.test(this.state.newPeerUrl.trim()) || this.state.busy,
                  onClick: () => this.addPeer()
                }, 'Add peer')
              )
            ),

            // --- Runtime ---
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
