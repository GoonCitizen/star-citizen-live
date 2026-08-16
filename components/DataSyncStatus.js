'use strict';

/**
 * Data sync status — cluster DeviceDataShare + Fabric peer health.
 *
 * Compact: header chip (dot + icon) with a flyout.
 * Panel: Identity / Settings section with the same facts and a Sync now action.
 */

const React = require('react');
const { summarizeSyncStatus } = require('../functions/clusterSync');
const { fetchClusterSync, publishClusterSync } = require('../functions/clusterSyncClient');

const CSS = `
  .syncstat-wrap{position:relative;flex:none}
  .syncstat{background:var(--panel2);border:1px solid var(--line);color:var(--text);
    border-radius:7px;padding:5px 9px;cursor:pointer;display:inline-flex;align-items:center;
    justify-content:center;gap:6px;line-height:0;font-family:inherit}
  .syncstat:hover,.syncstat.open{border-color:var(--accent)}
  .syncstat svg{display:block}
  .syncstat .sync-dot{width:7px;height:7px;border-radius:50%;flex:none;background:var(--muted)}
  .syncstat .sync-dot.good{background:var(--good);box-shadow:0 0 0 2px rgba(63,185,80,.25)}
  .syncstat .sync-dot.warn{background:var(--warn);box-shadow:0 0 0 2px rgba(210,153,34,.25)}
  .syncstat .sync-dot.kill{background:var(--kill)}
  .syncstat-fly{position:absolute;right:0;top:calc(100% + 6px);z-index:32;width:min(280px,94vw);
    background:var(--panel);border:1px solid var(--line);border-radius:10px;padding:10px 12px;
    box-shadow:0 12px 32px rgba(0,0,0,.45);display:grid;gap:7px;text-align:left;line-height:1.4}
  .syncstat-fly h3{margin:0;font-size:13px;font-weight:650}
  .syncstat-fly .hint{margin:0;font-size:11.5px;color:var(--muted)}
  .syncstat-fly .meta{margin:0;font-size:12px;color:var(--text)}
  .syncstat-fly .actions{display:flex;flex-wrap:wrap;gap:6px;margin-top:2px}
  .syncstat-fly .btn{background:var(--panel2);border:1px solid var(--line);color:var(--text);
    border-radius:6px;padding:5px 9px;font-size:11.5px;cursor:pointer;font-weight:600;font-family:inherit}
  .syncstat-fly .btn.primary{background:var(--accent);border-color:var(--accent);color:#fff}
  .syncstat-fly .btn:disabled{opacity:.45;cursor:default}
  .syncstat-panel{display:grid;gap:8px;margin:8px 0 4px}
  .syncstat-panel .row{display:flex;align-items:center;gap:8px}
  .syncstat-panel .sync-dot{width:8px;height:8px;border-radius:50%;flex:none;background:var(--muted)}
  .syncstat-panel .sync-dot.good{background:var(--good)}
  .syncstat-panel .sync-dot.warn{background:var(--warn)}
  .syncstat-panel .sync-dot.kill{background:var(--kill)}
  .syncstat-panel .title{font-size:13px;font-weight:650}
  .syncstat-panel .hint{margin:0;font-size:12px;color:var(--muted);line-height:1.45}
  .syncstat-panel .kv{font-size:11.5px;color:var(--muted);font-family:'Cascadia Code',Consolas,monospace}
  @media(max-width:720px){
    .syncstat{padding:5px 8px}
  }
`;

function originOf () {
  try {
    return (typeof window !== 'undefined' && window.location && window.location.origin) || '';
  } catch (_) {
    return '';
  }
}

class DataSyncStatus extends React.Component {
  constructor (props) {
    super(props);
    this.state = {
      open: false,
      busy: false,
      error: null,
      snapshot: null
    };
    this._onDocClick = this._onDocClick.bind(this);
  }

  componentDidMount () {
    this.refresh();
    const ms = Number(this.props.pollMs);
    const interval = Number.isFinite(ms) && ms > 0 ? ms : 15000;
    this._timer = setInterval(() => this.refresh(), interval);
    if (typeof document !== 'undefined') {
      document.addEventListener('click', this._onDocClick);
    }
  }

  componentWillUnmount () {
    if (this._timer) clearInterval(this._timer);
    if (typeof document !== 'undefined') {
      document.removeEventListener('click', this._onDocClick);
    }
  }

  _onDocClick () {
    if (this.state.open) this.setState({ open: false });
  }

  summary () {
    const snap = this.state.snapshot;
    if (this.state.error && !snap) {
      return summarizeSyncStatus({ unauthorized: /sign in/i.test(this.state.error) });
    }
    return summarizeSyncStatus(snap || {});
  }

  async refresh () {
    const origin = this.props.origin || originOf();
    const out = await fetchClusterSync(origin, { authToken: this.props.authToken });
    if (out && out.ok) {
      this.setState({ snapshot: out.data, error: null });
      return out;
    }
    this.setState({
      snapshot: out && out.unauthorized ? { unauthorized: true } : this.state.snapshot,
      error: (out && out.error) || 'sync unavailable'
    });
    return out;
  }

  async publishNow () {
    this.setState({ busy: true, error: null });
    const origin = this.props.origin || originOf();
    const out = await publishClusterSync(origin, { authToken: this.props.authToken });
    if (out && out.ok && out.data && !Array.isArray(out.data)) {
      this.setState({ snapshot: out.data, busy: false, error: null });
      return;
    }
    await this.refresh();
    this.setState({
      busy: false,
      error: (out && out.ok) ? null : ((out && out.error) || 'could not publish')
    });
  }

  toggleOpen (e) {
    if (e && typeof e.stopPropagation === 'function') e.stopPropagation();
    this.setState((s) => ({ open: !s.open }));
    if (!this.state.open) this.refresh();
  }

  facts (sum) {
    const snap = this.state.snapshot || {};
    const local = snap.local || {};
    const lines = [];
    if (sum.members) lines.push(sum.members + ' device' + (sum.members === 1 ? '' : 's') + ' in this identity');
    if (sum.connected) lines.push(sum.connected + ' Fabric TCP peer' + (sum.connected === 1 ? '' : 's') + ' connected');
    if (sum.lan) lines.push(sum.lan + ' LAN address' + (sum.lan === 1 ? '' : 'es') + ' advertised');
    if (Array.isArray(local.candidates) && local.candidates.length) {
      lines.push(local.candidates.slice(0, 3).join(' · '));
    }
    if (sum.frames) lines.push('Last share: ' + sum.frames + ' Fabric frame' + (sum.frames === 1 ? '' : 's'));
    if (sum.localChat || sum.inboundChat) {
      lines.push(
        (sum.localChat ? (sum.localChat + ' chat on this device') : 'No local chat yet') +
          (sum.inboundChat ? (' · ' + sum.inboundChat + ' received from siblings') : ' · waiting for sibling chat')
      );
    }
    const inv = snap.inventory && snap.inventory.local;
    if (inv) {
      const bits = [];
      if (inv.notes != null) bits.push(inv.notes + ' notes');
      if (inv.logs != null) bits.push(inv.logs + ' log' + (inv.logs === 1 ? '' : 's'));
      if (inv.missions != null) bits.push(inv.missions + ' mission' + (inv.missions === 1 ? '' : 's'));
      if (inv.chat != null) bits.push(inv.chat + ' chat');
      if (inv.files != null) bits.push(inv.files + ' file' + (inv.files === 1 ? '' : 's'));
      if (bits.length) lines.push('This device: ' + bits.join(' · '));
    }
    return lines;
  }

  actions (sum) {
    const manage = typeof this.props.onManageDevices === 'function'
      ? React.createElement('button', {
        type: 'button',
        className: 'btn',
        onClick: (e) => {
          if (e && e.stopPropagation) e.stopPropagation();
          this.setState({ open: false });
          this.props.onManageDevices();
        }
      }, 'Manage devices')
      : null;
    const add = typeof this.props.onAddDevice === 'function'
      ? React.createElement('button', {
        type: 'button',
        className: 'btn',
        onClick: (e) => {
          if (e && e.stopPropagation) e.stopPropagation();
          this.setState({ open: false });
          this.props.onAddDevice();
        }
      }, 'Add a device')
      : null;
    const sync = React.createElement('button', {
      type: 'button',
      className: 'btn primary',
      disabled: this.state.busy || sum.state === 'auth',
      onClick: (e) => {
        if (e && e.stopPropagation) e.stopPropagation();
        void this.publishNow();
      }
    }, this.state.busy ? 'Syncing…' : 'Sync now');
    return React.createElement('div', { className: 'actions' }, sync, manage, add);
  }

  renderPanel () {
    const sum = this.summary();
    return React.createElement('div', { className: 'syncstat-panel', 'data-sync-state': sum.state },
      React.createElement('div', { className: 'row' },
        React.createElement('span', { className: 'sync-dot ' + sum.tone, 'aria-hidden': true }),
        React.createElement('span', { className: 'title' }, sum.label)
      ),
      React.createElement('p', { className: 'hint' }, sum.detail),
      this.facts(sum).map((line, i) =>
        React.createElement('div', { className: 'kv', key: 'f' + i }, line)
      ),
      this.state.error && sum.state !== 'auth'
        ? React.createElement('p', { className: 'hint' }, this.state.error)
        : null,
      this.actions(sum)
    );
  }

  renderCompact () {
    const sum = this.summary();
    return React.createElement('div', {
      className: 'syncstat-wrap',
      onClick: (e) => { if (e && e.stopPropagation) e.stopPropagation(); }
    },
    React.createElement('button', {
      type: 'button',
      className: 'syncstat' + (this.state.open ? ' open' : ''),
      title: sum.label + ' — ' + sum.detail,
      'aria-label': 'Data sync status',
      'aria-expanded': this.state.open ? 'true' : 'false',
      'data-sync-state': sum.state,
      onClick: (e) => this.toggleOpen(e)
    },
    React.createElement('span', { className: 'sync-dot ' + sum.tone, 'aria-hidden': true }),
    React.createElement('svg', {
      width: 16,
      height: 16,
      viewBox: '0 0 16 16',
      fill: 'none',
      stroke: 'currentColor',
      strokeWidth: 1.6,
      'aria-hidden': true
    },
    React.createElement('path', { d: 'M4 6.5A4 4 0 0 1 11.5 5L13 3.5V7H9.5' }),
    React.createElement('path', { d: 'M12 9.5A4 4 0 0 1 4.5 11L3 12.5V9H6.5' })
    )
    ),
    this.state.open
      ? React.createElement('div', { className: 'syncstat-fly', role: 'dialog', 'aria-label': 'Data sync' },
        React.createElement('h3', null, sum.label),
        React.createElement('p', { className: 'hint' }, sum.detail),
        this.facts(sum).map((line, i) =>
          React.createElement('p', { className: 'meta', key: 'm' + i }, line)
        ),
        this.state.error && sum.state !== 'auth'
          ? React.createElement('p', { className: 'hint' }, this.state.error)
          : null,
        this.actions(sum),
        React.createElement('p', { className: 'hint' },
          'Same-WiFi devices dial Fabric TCP first. This node advertises LAN hints on the Hub WebRTC coordinator; hubs relay when NAT blocks LAN. Passport uses Hub signaling.')
      )
      : null
    );
  }

  render () {
    if (this.props.variant === 'panel') return this.renderPanel();
    return this.renderCompact();
  }
}

DataSyncStatus.CSS = CSS;

module.exports = DataSyncStatus;
