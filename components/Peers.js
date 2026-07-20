'use strict';

/**
 * Peers — Fabric Network peer management (top-level feature).
 *
 * Brought forward from the Hub's PeerList: list, add, enable/disable, and
 * remove peers. Peers are remote hubs (e.g. https://goon.vc) that receive
 * this relay's Schnorr-signed event batches over the Fabric Protocol while
 * the local identity is unlocked. Uses the relay's Hub-compatible REST
 * surface (`GET|POST /peers`, `POST|DELETE /peers/:id`).
 */

const React = require('react');

const CSS = `
  .pr-wrap{max-width:860px;margin:0 auto;padding:18px;display:grid;gap:16px}
  .pr-panel{background:var(--panel);border:1px solid var(--line);border-radius:12px;overflow:hidden}
  .pr-panel h2{font-size:13px;margin:0;padding:12px 16px;border-bottom:1px solid var(--line);font-weight:600}
  .pr-panel .body{padding:14px 16px}
  .pr-hint{color:var(--muted);font-size:12.5px;line-height:1.55}
  .pr-err{background:rgba(248,81,73,.12);color:var(--kill);border-radius:7px;padding:9px 12px;font-size:13px;margin-bottom:10px}
  .pr-peer{display:flex;gap:12px;align-items:center;padding:10px 0;border-bottom:1px solid #20262f}
  .pr-peer:last-child{border-bottom:none}
  .pr-peer .u{flex:1;min-width:0}
  .pr-peer .url{font-family:'Cascadia Code',Consolas,monospace;font-size:12.5px;word-break:break-all}
  .pr-peer .meta{color:var(--muted);font-size:11.5px;margin-top:2px}
  .pr-peer .meta .err{color:var(--kill)}
  .pr-peer .meta .ok{color:var(--good)}
  .pr-btn{background:var(--accent);border:none;color:#fff;border-radius:7px;padding:7px 14px;
    font-size:12.5px;font-weight:600;cursor:pointer;white-space:nowrap}
  .pr-btn:disabled{opacity:.45;cursor:default}
  .pr-btn.ghost{background:var(--panel2);border:1px solid var(--line);color:var(--text)}
  .pr-btn.danger{background:transparent;border:1px solid var(--line);color:var(--kill);padding:4px 10px;font-size:11px;font-weight:500}
  .pr-row{display:flex;gap:8px;align-items:center;margin-top:12px}
  .pr-row input{background:var(--bg);border:1px solid var(--line);color:var(--text);
    border-radius:7px;padding:8px 10px;font-size:12.5px;box-sizing:border-box;
    font-family:'Cascadia Code',Consolas,monospace}
  .pr-id{display:flex;gap:10px;align-items:center;flex-wrap:wrap;font-size:12.5px;color:var(--muted)}
  .pr-id code{font-size:11.5px;word-break:break-all;color:var(--text)}
  .pr-tag{font-size:10.5px;font-weight:700;padding:2px 8px;border-radius:5px}
  .pr-tag.on{background:rgba(63,185,80,.15);color:var(--good)}
  .pr-tag.off{background:rgba(110,118,129,.18);color:var(--muted)}
`;

class Peers extends React.Component {
  constructor (props) {
    super(props);
    this.state = {
      loading: true,
      error: null,
      editable: true,
      peers: [],
      runtime: {},
      newPeerUrl: '',
      newPeerLabel: '',
      busy: false
    };
    this._timer = null;
  }

  componentDidMount () {
    this.load();
    this._timer = setInterval(() => this.load(), 10000);
  }

  componentWillUnmount () {
    if (this._timer) clearInterval(this._timer);
  }

  async load () {
    try {
      const [peersRes, settingsRes] = await Promise.all([
        fetch('/peers').then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`)))),
        fetch('/settings').then((r) => (r.ok ? r.json() : { runtime: {} }))
      ]);
      this.setState({
        loading: false,
        error: null,
        peers: peersRes.data || [],
        runtime: settingsRes.runtime || {},
        editable: settingsRes.editable !== false
      });
    } catch (e) {
      this.setState({ loading: false, error: 'Peer management is available on the local relay only: ' + e.message });
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

  render () {
    const rt = this.state.runtime;
    const unlocked = !!rt.identity;
    return React.createElement('div', { className: 'pr-wrap' },
      React.createElement('div', { className: 'pr-panel' },
        React.createElement('h2', null, 'Fabric Network'),
        React.createElement('div', { className: 'body' },
          React.createElement('div', { className: 'pr-hint' },
            'GoonCitizen integrates with the Fabric Network using the Fabric Protocol. ',
            'Peers below receive this relay\'s Schnorr-signed event batches; delivery is ',
            'idempotent, so multiple peers are safe.'),
          React.createElement('div', { className: 'pr-id', style: { marginTop: 10 } },
            React.createElement('span', { className: 'pr-tag ' + (unlocked ? 'on' : 'off') }, unlocked ? 'identity unlocked' : 'identity locked'),
            unlocked ? React.createElement('code', null, rt.identity) : React.createElement('span', null, 'unlock your identity to start pushing'),
            React.createElement('span', { className: 'pr-tag ' + (rt.uplinkActive ? 'on' : 'off') },
              rt.uplinkActive ? `uplink active · ${rt.uplinkQueued || 0} queued` : 'uplink idle')
          )
        )
      ),
      React.createElement('div', { className: 'pr-panel' },
        React.createElement('h2', null, `Peers (${this.state.peers.length})`),
        React.createElement('div', { className: 'body' },
          this.state.error ? React.createElement('div', { className: 'pr-err' }, this.state.error) : null,
          this.state.loading
            ? React.createElement('div', { className: 'pr-hint' }, 'loading…')
            : (this.state.peers.length
              ? this.state.peers.map((p) => React.createElement('div', { className: 'pr-peer', key: p.id },
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
                React.createElement('button', { className: 'pr-btn ghost', style: { padding: '4px 10px', fontSize: 11 }, disabled: this.state.busy, onClick: () => this.togglePeer(p) }, p.enabled === false ? 'Enable' : 'Disable'),
                React.createElement('button', { className: 'pr-btn danger', disabled: this.state.busy, onClick: () => this.removePeer(p) }, 'Remove')
              ))
              : React.createElement('div', { className: 'pr-hint' }, 'No peers configured — add a hub below (e.g. https://goon.vc) to share your events with the org.')),
          React.createElement('div', { className: 'pr-row' },
            React.createElement('input', {
              type: 'text', value: this.state.newPeerUrl, placeholder: 'https://goon.vc',
              style: { flex: 2 },
              onChange: (e) => this.setState({ newPeerUrl: e.target.value })
            }),
            React.createElement('input', {
              type: 'text', value: this.state.newPeerLabel, placeholder: 'label (optional)',
              style: { flex: 1 },
              onChange: (e) => this.setState({ newPeerLabel: e.target.value })
            }),
            React.createElement('button', {
              className: 'pr-btn',
              disabled: !/^https?:\/\//.test(this.state.newPeerUrl.trim()) || this.state.busy,
              onClick: () => this.addPeer()
            }, 'Add peer')
          )
        )
      )
    );
  }
}

Peers.CSS = CSS;

module.exports = Peers;
