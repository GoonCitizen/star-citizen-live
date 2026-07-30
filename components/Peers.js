'use strict';

/**
 * Peers — Fabric Network peer management (top-level feature).
 *
 * Peers are Fabric `host:port` addresses (AMP/Message over TCP/NOISE). The
 * default seeds are `hub.fabric.pub:7777` and `relay.goon.vc:7777`. Local
 * dashboard HTTP on :3041 is UI only — not the peering transport.
 *
 * Log sharing is opt-in (D-017): per-peer "Share logs" and/or Settings
 * "Share logs to global". Connection status mirrors Hub PeerList (connected /
 * offline badges). Browser WebRTC mesh (`RegisterWebRTCPeer`) lives on Hub
 * HTTP/WS only — observed here via Hub `/services/peering` counts, not dialed.
 */

const React = require('react');
const ActivityHeatmap = require('./ActivityHeatmap');

const FABRIC_ADDR = /^[a-zA-Z0-9._-]+:\d{1,5}$/;

const CSS = `
  .pr-wrap{max-width:920px;margin:0 auto;padding:18px;display:grid;gap:16px}
  .pr-panel{background:var(--panel);border:1px solid var(--line);border-radius:12px;overflow:hidden}
  .pr-panel h2{font-size:13px;margin:0;padding:12px 16px;border-bottom:1px solid var(--line);font-weight:600}
  .pr-panel .body{padding:14px 16px}
  .pr-hint{color:var(--muted);font-size:12.5px;line-height:1.55}
  .pr-err{background:rgba(248,81,73,.12);color:var(--kill);border-radius:7px;padding:9px 12px;font-size:13px;margin-bottom:10px}
  .pr-peer{display:grid;grid-template-columns:1fr auto;gap:10px 14px;align-items:start;padding:14px 0;border-bottom:1px solid #20262f}
  .pr-peer:last-child{border-bottom:none}
  .pr-peer .u{min-width:0;cursor:pointer}
  .pr-peer .u:hover .url{color:var(--accent)}
  .pr-peer .url{font-family:'Cascadia Code',Consolas,monospace;font-size:12.5px;word-break:break-all}
  .pr-peer .meta{color:var(--muted);font-size:11.5px;margin-top:4px;display:flex;flex-wrap:wrap;gap:6px;align-items:center}
  .pr-peer .actions{display:flex;flex-direction:column;gap:6px;align-items:stretch}
  .pr-peer .share-row{display:flex;align-items:center;gap:8px;font-size:12px;color:var(--text);cursor:pointer;user-select:none;margin-top:8px}
  .pr-peer .share-row input{margin:0}
  .pr-btn{background:var(--accent);border:none;color:#fff;border-radius:7px;padding:7px 14px;
    font-size:12.5px;font-weight:600;cursor:pointer;white-space:nowrap}
  .pr-btn:disabled{opacity:.45;cursor:default}
  .pr-btn.ghost{background:var(--panel2);border:1px solid var(--line);color:var(--text)}
  .pr-btn.danger{background:transparent;border:1px solid var(--line);color:var(--kill);padding:4px 10px;font-size:11px;font-weight:500}
  .pr-row{display:flex;gap:8px;align-items:center;margin-top:12px;flex-wrap:wrap}
  .pr-row input[type=text]{background:var(--bg);border:1px solid var(--line);color:var(--text);
    border-radius:7px;padding:8px 10px;font-size:12.5px;box-sizing:border-box;
    font-family:'Cascadia Code',Consolas,monospace}
  .pr-row label.share-new{display:flex;align-items:center;gap:6px;font-size:12px;color:var(--muted);cursor:pointer}
  .pr-id{display:flex;gap:10px;align-items:center;flex-wrap:wrap;font-size:12.5px;color:var(--muted)}
  .pr-id code{font-size:11.5px;word-break:break-all;color:var(--text)}
  .pr-tag{font-size:10.5px;font-weight:700;padding:2px 8px;border-radius:5px;letter-spacing:.02em}
  .pr-tag.on{background:rgba(63,185,80,.15);color:var(--good)}
  .pr-tag.off{background:rgba(110,118,129,.18);color:var(--muted)}
  .pr-tag.warn{background:rgba(210,153,34,.18);color:#d29922}
  .pr-tag.primary{background:rgba(56,139,253,.18);color:#58a6ff}
  .pr-conns{margin-top:10px;font-size:11.5px;color:var(--muted)}
  .pr-conns code{color:var(--text);font-size:11px}
  .pr-hubs{display:grid;gap:8px;margin-top:10px}
  .pr-hub{display:flex;flex-wrap:wrap;gap:8px;align-items:center;font-size:12px;color:var(--muted)}
  .pr-hub code{color:var(--text);font-size:11.5px}
  .pr-detail{display:grid;gap:10px}
  .pr-kv{font-family:'Cascadia Code',Consolas,monospace;font-size:11.5px;word-break:break-all;
    background:var(--bg);border:1px solid var(--line);border-radius:7px;padding:8px 10px}
  .pr-kv b{color:var(--muted);font-weight:600;font-family:'Segoe UI',system-ui,sans-serif;font-size:11px}
  .pr-bio{font-size:13px;line-height:1.5;color:var(--text);white-space:pre-wrap}
`;

function statusTag (peer) {
  if (peer.enabled === false || peer.status === 'disabled') {
    return React.createElement('span', { className: 'pr-tag off' }, 'disabled');
  }
  if (peer.connected || peer.status === 'connected') {
    return React.createElement('span', { className: 'pr-tag on' }, 'connected');
  }
  return React.createElement('span', { className: 'pr-tag warn' }, 'offline');
}

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
      newPeerShareLogs: false,
      busy: false,
      inspectId: null,
      detail: null,
      detailLoading: false,
      observe: null
    };
    this._timer = null;
  }

  componentDidMount () {
    this.load();
    this._timer = setInterval(() => this.load(), 5000);
  }

  componentWillUnmount () {
    if (this._timer) clearInterval(this._timer);
  }

  async load () {
    try {
      const [peersRes, settingsRes, observeRes] = await Promise.all([
        fetch('/peers').then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`)))),
        fetch('/settings').then((r) => (r.ok ? r.json() : { runtime: {} })),
        fetch('/network/observe').then((r) => (r.ok ? r.json() : null)).catch(() => null)
      ]);
      const next = {
        loading: false,
        error: null,
        peers: peersRes.data || [],
        runtime: settingsRes.runtime || {},
        editable: settingsRes.editable !== false,
        observe: (observeRes && observeRes.data) || (settingsRes.runtime && settingsRes.runtime.networkObserve) || this.state.observe
      };
      this.setState(next);
      if (this.state.inspectId) this.loadDetail(this.state.inspectId, { quiet: true });
    } catch (e) {
      this.setState({ loading: false, error: 'Peer management is available on the local relay only: ' + e.message });
    }
  }

  async loadDetail (peerId, opts = {}) {
    if (!peerId) return;
    if (!opts.quiet) this.setState({ detailLoading: true, error: null });
    try {
      const res = await fetch(`/peers/${peerId}`);
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
      this.setState({
        inspectId: peerId,
        detail: json.data || null,
        detailLoading: false
      });
    } catch (e) {
      this.setState({ detailLoading: false, error: e.message });
    }
  }

  async restoreNetworkSeeds () {
    if (this.state.busy) return;
    this.setState({ busy: true, error: null });
    try {
      const res = await fetch('/peers/restore-seeds', { method: 'POST' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((data && data.error) || `HTTP ${res.status}`);
      this.setState({
        busy: false,
        peers: (data.data && data.data.peers) || this.state.peers
      });
      await this.load();
    } catch (e) {
      this.setState({ busy: false, error: e.message });
    }
  }

  async addPeer () {
    const address = this.state.newPeerUrl.trim();
    if (!FABRIC_ADDR.test(address) || this.state.busy) return;
    this.setState({ busy: true, error: null });
    try {
      const res = await fetch('/peers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          address,
          label: this.state.newPeerLabel.trim() || null,
          shareLogs: !!this.state.newPeerShareLogs
        })
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
      this.setState({ busy: false, newPeerUrl: '', newPeerLabel: '', newPeerShareLogs: false });
      await this.load();
    } catch (e) {
      this.setState({ busy: false, error: e.message });
    }
  }

  async patchPeer (peer, patch) {
    if (this.state.busy) return;
    this.setState({ busy: true, error: null });
    try {
      const res = await fetch(`/peers/${peer.id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch)
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
      this.setState({ busy: false });
      await this.load();
    } catch (e) {
      this.setState({ busy: false, error: e.message });
    }
  }

  async togglePeer (peer) {
    return this.patchPeer(peer, { enabled: !(peer.enabled !== false) });
  }

  async toggleShareLogs (peer) {
    return this.patchPeer(peer, { shareLogs: !peer.shareLogs });
  }

  async removePeer (peer) {
    if (this.state.busy) return;
    this.setState({ busy: true, error: null });
    try {
      await fetch(`/peers/${peer.id}`, { method: 'DELETE' });
      this.setState({
        busy: false,
        inspectId: this.state.inspectId === peer.id ? null : this.state.inspectId,
        detail: this.state.inspectId === peer.id ? null : this.state.detail
      });
      await this.load();
    } catch (e) {
      this.setState({ busy: false, error: e.message });
    }
  }

  renderObserve () {
    const observe = this.state.observe;
    const hubs = (observe && observe.hubs) || [];
    const summary = (observe && observe.summary) || {};
    return React.createElement('div', { className: 'pr-panel' },
      React.createElement('h2', null, 'Network hubs (observe)'),
      React.createElement('div', { className: 'body' },
        React.createElement('div', { className: 'pr-hint' },
          'Hub TCP peers and browser WebRTC registrations on hub.fabric.pub / relay.goon.vc. ',
          'Desktop dials Fabric TCP only; WebRTC counts show clients reachable through the hubs so gossip can fill open slots.'),
        React.createElement('div', { className: 'pr-id', style: { marginTop: 10 } },
          React.createElement('span', { className: 'pr-tag ' + (summary.online ? 'on' : 'off') },
            `${summary.online || 0}/${summary.observed || hubs.length || 0} hubs online`),
          React.createElement('span', { className: 'pr-tag primary' },
            `hub TCP · ${summary.p2pConnections || 0}`),
          React.createElement('span', { className: 'pr-tag primary' },
            `WebRTC · ${summary.webrtcRegistered || 0}`)
        ),
        hubs.length
          ? React.createElement('div', { className: 'pr-hubs' },
            hubs.map((h) => React.createElement('div', { className: 'pr-hub', key: h.origin },
              React.createElement('span', { className: 'pr-tag ' + (h.ok ? 'on' : 'off') }, h.ok ? 'up' : 'down'),
              React.createElement('code', null, h.origin),
              h.ok
                ? React.createElement(React.Fragment, null,
                  React.createElement('span', null, `TCP ${h.p2pConnections || 0}` + (h.p2pMaxPeers != null ? `/${h.p2pMaxPeers}` : '')),
                  React.createElement('span', null, `WebRTC ${h.webrtcRegistered || 0}`),
                  h.hubAlias ? React.createElement('span', null, h.hubAlias) : null)
                : React.createElement('span', { style: { color: 'var(--kill)' } }, h.error || 'unreachable')
            )))
          : React.createElement('div', { className: 'pr-hint', style: { marginTop: 8 } }, 'Observing hubs…')
      )
    );
  }

  renderDetail () {
    const d = this.state.detail;
    if (!this.state.inspectId) return null;
    const peer = d && d.peer;
    const profile = d && d.profile;
    return React.createElement('div', { className: 'pr-panel' },
      React.createElement('h2', null, 'Peer profile'),
      React.createElement('div', { className: 'body' },
        React.createElement('div', { className: 'pr-row', style: { marginTop: 0, marginBottom: 8 } },
          React.createElement('button', {
            className: 'pr-btn ghost',
            onClick: () => this.setState({ inspectId: null, detail: null })
          }, '← Back to roster')
        ),
        this.state.detailLoading || !d
          ? React.createElement('div', { className: 'pr-hint' }, 'loading profile…')
          : React.createElement('div', { className: 'pr-detail' },
            React.createElement('div', { className: 'pr-id' },
              statusTag(peer),
              peer.primary ? React.createElement('span', { className: 'pr-tag primary' }, 'network hub') : null,
              peer.discovered ? React.createElement('span', { className: 'pr-tag warn' }, 'discovered') : null,
              d.self ? React.createElement('span', { className: 'pr-tag on' }, 'you') : null
            ),
            React.createElement('div', { className: 'pr-kv' },
              React.createElement('b', null, 'address '), React.createElement('br'), peer.address || '—'),
            React.createElement('div', { className: 'pr-kv' },
              React.createElement('b', null, 'nickname '), React.createElement('br'),
              (profile && profile.nickname) || peer.alias || '—'),
            React.createElement('div', { className: 'pr-kv' },
              React.createElement('b', null, 'Star Citizen handle '), React.createElement('br'),
              (profile && profile.scHandle) || '—'),
            React.createElement('div', { className: 'pr-kv' },
              React.createElement('b', null, 'pubkey '), React.createElement('br'),
              (profile && profile.pubkey) || peer.pubkey || '— (seen after handshake)'),
            (profile && profile.bio)
              ? React.createElement('div', null,
                React.createElement('div', { className: 'pr-hint', style: { marginBottom: 4 } }, 'Bio'),
                React.createElement('div', { className: 'pr-bio' }, profile.bio))
              : React.createElement('div', { className: 'pr-hint' }, 'No bio published yet.'),
            (() => {
              const p = d.presence;
              if (!p) {
                return React.createElement('div', { className: 'pr-hint' },
                  'No online status shared (opt-in PeerPresence).');
              }
              const ship = p.ship && (p.ship.name || p.ship.slug);
              return React.createElement('div', { className: 'pr-kv' },
                React.createElement('b', null, 'online status '), React.createElement('br'),
                React.createElement('span', { className: 'pr-tag ' + (p.online ? 'on' : 'off') },
                  p.online ? 'online' : 'offline'),
                ship ? React.createElement('span', null, ' · ship ', ship,
                  p.ship.source === 'override' ? ' (manual)' : '') : null,
                p.lastEventAt
                  ? React.createElement('div', { style: { marginTop: 4, color: 'var(--muted)' } },
                    'last log activity ', p.lastEventAt)
                  : null);
            })(),
            d.linkedDevice
              ? React.createElement('div', { className: 'pr-hint' },
                'Linked device: ', d.linkedDevice.label || d.linkedDevice.peerFabricId)
              : null,
            this.renderProfileActivity(d)
          )
      )
    );
  }

  renderProfileActivity (d) {
    const show = this.props.showProfileActivity !== false &&
      ActivityHeatmap.readShowProfileActivity();
    if (!show || !d) return null;
    const handle = (d.profile && d.profile.scHandle) || null;
    if (!d.self && !handle) {
      return React.createElement('div', { className: 'pr-hint' },
        'No Star Citizen handle on this profile — activity graph needs a handle match in local history.');
    }
    return React.createElement(ActivityHeatmap, {
      title: d.self ? 'When you fly' : 'When they fly (local history)',
      subtitle: d.self
        ? 'Your cumulative activity heatmap (Home → When you fly).'
        : `Filtered to handle ${handle} from this machine’s cumulative logs — not remote telemetry.`,
      analytics: this.props.analytics || null,
      // Self: aggregate local heat. Peers: rebuild from events matching their SC handle.
      player: d.self ? null : handle
    });
  }

  render () {
    const rt = this.state.runtime;
    const unlocked = !!rt.identity;
    const fabricReady = !!rt.fabricReady;
    const listenPort = rt.fabricListenPort || 7777;
    const shareGlobal = rt.shareLogsGlobal === true;
    const shareActive = rt.shareLogsActive === true;
    const connections = Array.isArray(rt.fabricConnections) ? rt.fabricConnections : [];
    const connectedCount = this.state.peers.filter((p) => p.connected).length;
    const local = rt.localProfile || {};

    if (this.state.inspectId) {
      return React.createElement('div', { className: 'pr-wrap' },
        this.state.error ? React.createElement('div', { className: 'pr-err' }, this.state.error) : null,
        this.renderDetail()
      );
    }

    return React.createElement('div', { className: 'pr-wrap' },
      React.createElement('div', { className: 'pr-panel' },
        React.createElement('h2', null, 'Fabric Network'),
        React.createElement('div', { className: 'body' },
          React.createElement('div', { className: 'pr-hint' },
            'GoonCitizen peers over the Fabric Protocol (TCP/NOISE on port ',
            String(listenPort),
            '). Default star seeds are hub.fabric.pub:7777 and relay.goon.vc:7777 — both should show connected when unlocked. ',
            'Peer gossip and peering offers fill open connection slots; click a peer to inspect their local profile. ',
            'Parsed game logs only leave this machine when you authorize sharing.'),
          React.createElement('div', { className: 'pr-id', style: { marginTop: 10 } },
            React.createElement('span', { className: 'pr-tag ' + (unlocked ? 'on' : 'off') }, unlocked ? 'identity unlocked' : 'identity locked'),
            unlocked ? React.createElement('code', null, rt.fabricPeerId || rt.identity) : React.createElement('span', null, 'unlock your identity to start the Fabric peer'),
            React.createElement('span', { className: 'pr-tag ' + (fabricReady ? 'on' : 'off') },
              fabricReady
                ? `listening :${listenPort} · ${rt.fabricConnected || 0} socket${(rt.fabricConnected || 0) === 1 ? '' : 's'}`
                : 'peer idle'),
            React.createElement('span', { className: 'pr-tag ' + (connectedCount ? 'on' : 'off') },
              `${connectedCount} roster connected`),
            React.createElement('span', { className: 'pr-tag ' + (shareActive ? 'on' : 'off') },
              shareGlobal ? 'logs → all peers' : (shareActive ? 'logs → authorized peers' : 'logs private')),
            React.createElement('span', { className: 'pr-tag ' + (rt.uplinkActive ? 'on' : 'off') },
              rt.uplinkActive ? `event queue · ${rt.uplinkQueued || 0}` : 'event queue idle')
          ),
          (local.nickname || local.bio || local.scHandle)
            ? React.createElement('div', { className: 'pr-conns' },
              'Your profile: ',
              React.createElement('code', null, local.nickname || '(no nickname)'),
              local.scHandle ? React.createElement('span', null, ' · SC ', React.createElement('code', null, local.scHandle)) : null,
              ' — edit in Identity')
            : React.createElement('div', { className: 'pr-conns' },
              'Set a nickname / bio in Identity so peers can see your local profile when they inspect you.'),
          connections.length
            ? React.createElement('div', { className: 'pr-conns' },
              'Live sockets: ',
              connections.map((c, i) => React.createElement('span', { key: c + i },
                i ? ', ' : null,
                React.createElement('code', null, c)
              )))
            : (unlocked && fabricReady
              ? React.createElement('div', { className: 'pr-conns', style: { color: 'var(--kill)' } },
                'No live Fabric sockets — chat cannot leave this machine. Use “Restore network seeds” below, then wait for hub.fabric.pub / relay.goon.vc to show connected.')
              : null),
          Array.isArray(rt.meshAliases) && rt.meshAliases.length
            ? React.createElement('div', { className: 'pr-conns' },
              'Mesh nicknames seen: ',
              rt.meshAliases.map((a, i) => React.createElement('span', { key: a.pubkey },
                i ? ', ' : null,
                React.createElement('code', { title: a.pubkey }, a.alias || a.pubkey.slice(0, 12) + '…')
              )))
            : null
        )
      ),
      this.renderObserve(),
      React.createElement('div', { className: 'pr-panel' },
        React.createElement('h2', null, `Connected peers (${this.state.peers.length})`),
        React.createElement('div', { className: 'body' },
          this.state.error ? React.createElement('div', { className: 'pr-err' }, this.state.error) : null,
          this.state.loading
            ? React.createElement('div', { className: 'pr-hint' }, 'loading…')
            : (this.state.peers.length
              ? this.state.peers.map((p) => React.createElement('div', { className: 'pr-peer', key: p.id },
                React.createElement('div', {
                  className: 'u',
                  onClick: () => this.loadDetail(p.id),
                  title: 'Inspect peer profile'
                },
                  React.createElement('div', { className: 'url' },
                    (p.alias ? p.alias + ' — ' : (p.label ? p.label + ' — ' : '')) + (p.address || p.url)),
                  React.createElement('div', { className: 'meta' },
                    statusTag(p),
                    React.createElement('span', { className: 'pr-tag off' }, p.transport || 'fabric-tcp'),
                    p.primary ? React.createElement('span', { className: 'pr-tag primary' }, 'network hub') : null,
                    p.discovered ? React.createElement('span', { className: 'pr-tag warn' }, 'discovered') : null,
                    p.shareLogs || shareGlobal
                      ? React.createElement('span', { className: 'pr-tag on' }, shareGlobal ? 'logs (global)' : 'logs authorized')
                      : React.createElement('span', { className: 'pr-tag off' }, 'logs not shared'),
                    p.enabled === false
                      ? null
                      : (p.lastError
                        ? React.createElement('span', { style: { color: 'var(--kill)' } }, 'error: ' + p.lastError)
                        : (p.lastSeen
                          ? React.createElement('span', null, 'last activity ' + String(p.lastSeen).slice(11, 19))
                          : null))
                  ),
                  React.createElement('label', {
                    className: 'share-row',
                    onClick: (e) => e.stopPropagation()
                  },
                    React.createElement('input', {
                      type: 'checkbox',
                      checked: !!p.shareLogs,
                      disabled: this.state.busy || shareGlobal || p.enabled === false,
                      onChange: () => this.toggleShareLogs(p)
                    }),
                    shareGlobal
                      ? 'Share logs (covered by global setting)'
                      : 'Share my parsed game logs with this peer')
                ),
                React.createElement('div', { className: 'actions' },
                  React.createElement('button', {
                    className: 'pr-btn ghost',
                    style: { padding: '4px 10px', fontSize: 11 },
                    disabled: this.state.busy,
                    onClick: () => this.loadDetail(p.id)
                  }, 'Inspect'),
                  React.createElement('button', {
                    className: 'pr-btn ghost',
                    style: { padding: '4px 10px', fontSize: 11 },
                    disabled: this.state.busy,
                    onClick: () => this.togglePeer(p)
                  }, p.enabled === false ? 'Enable' : 'Disable'),
                  React.createElement('button', {
                    className: 'pr-btn danger',
                    disabled: this.state.busy,
                    onClick: () => this.removePeer(p)
                  }, 'Remove')
                )
              ))
              : React.createElement('div', { className: 'pr-hint' },
                'No peers configured — restore network seeds or add a Fabric address (e.g. hub.fabric.pub:7777).')),
          React.createElement('div', { className: 'pr-row' },
            React.createElement('button', {
              className: 'pr-btn ghost',
              disabled: this.state.busy,
              onClick: () => this.restoreNetworkSeeds()
            }, 'Restore network seeds'),
            React.createElement('input', {
              type: 'text', value: this.state.newPeerUrl, placeholder: 'hub.fabric.pub:7777',
              style: { flex: '2 1 200px' },
              onChange: (e) => this.setState({ newPeerUrl: e.target.value })
            }),
            React.createElement('input', {
              type: 'text', value: this.state.newPeerLabel, placeholder: 'label (optional)',
              style: { flex: '1 1 120px' },
              onChange: (e) => this.setState({ newPeerLabel: e.target.value })
            }),
            React.createElement('label', { className: 'share-new' },
              React.createElement('input', {
                type: 'checkbox',
                checked: this.state.newPeerShareLogs,
                onChange: (e) => this.setState({ newPeerShareLogs: e.target.checked })
              }),
              'Share logs'
            ),
            React.createElement('button', {
              className: 'pr-btn',
              disabled: !FABRIC_ADDR.test(this.state.newPeerUrl.trim()) || this.state.busy,
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
