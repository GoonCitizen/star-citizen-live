'use strict';

/**
 * Notification history — dedicated page for peer mission broadcasts and
 * other inbox items. Opened from the header bell (hash `#notifications`).
 */

const React = require('react');

const BASE = '/services/star-citizen';

const CSS = `
  .nt-wrap{max-width:860px;margin:0 auto;padding:18px;display:grid;gap:14px}
  .nt-panel{background:var(--panel);border:1px solid var(--line);border-radius:12px;overflow:hidden}
  .nt-panel h2{font-size:13px;margin:0;padding:12px 16px;border-bottom:1px solid var(--line);font-weight:600;
    display:flex;gap:8px;align-items:center}
  .nt-panel h2 .sub{color:var(--muted);font-weight:400;font-size:12px;flex:1}
  .nt-filters{display:flex;gap:6px;flex-wrap:wrap;padding:10px 16px;border-bottom:1px solid var(--line)}
  .nt-chip{font-size:12px;padding:4px 10px;border-radius:999px;border:1px solid var(--line);background:transparent;
    color:var(--muted);cursor:pointer}
  .nt-chip.on{background:rgba(59,130,246,.15);color:var(--accent);border-color:var(--accent)}
  .nt-item{padding:12px 16px;border-bottom:1px solid #20262f;display:grid;gap:6px}
  .nt-item:last-child{border-bottom:none}
  .nt-item.pending{background:rgba(59,130,246,.06)}
  .nt-head{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
  .nt-title{font-weight:600;font-size:13.5px;flex:1;min-width:140px}
  .nt-tag{font-size:10.5px;font-weight:700;padding:2px 8px;border-radius:5px}
  .nt-tag.pending{background:rgba(59,130,246,.18);color:var(--accent)}
  .nt-tag.accepted{background:rgba(63,185,80,.15);color:var(--good)}
  .nt-tag.ignored{background:rgba(110,118,129,.18);color:var(--muted)}
  .nt-tag.self{background:rgba(210,153,34,.15);color:var(--warn)}
  .nt-tag.mission{background:rgba(247,147,26,.14);color:#f7931a}
  .nt-meta{color:var(--muted);font-size:11.5px;font-family:'Cascadia Code',Consolas,monospace;word-break:break-all}
  .nt-body{font-size:13px;line-height:1.45;color:var(--text)}
  .nt-row{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-top:4px}
  .nt-btn{background:var(--accent);border:none;color:#fff;border-radius:7px;padding:6px 12px;
    font-size:12px;font-weight:600;cursor:pointer}
  .nt-btn:disabled{opacity:.45;cursor:default}
  .nt-btn.ghost{background:var(--panel2);border:1px solid var(--line);color:var(--text)}
  .nt-btn.good{background:var(--good)}
  .nt-empty{color:var(--muted);font-style:italic;padding:28px 16px;text-align:center}
  .nt-err{background:rgba(248,81,73,.12);color:var(--kill);margin:12px 16px;padding:8px 11px;
    border-radius:7px;font-size:12.5px}
  .bell{position:relative;background:var(--panel2);border:1px solid var(--line);color:var(--text);
    border-radius:7px;padding:5px 11px;font-size:14px;cursor:pointer;line-height:1}
  .bell:hover{border-color:var(--accent)}
  .bell.on{border-color:var(--accent);color:var(--accent)}
  .bell .dot{position:absolute;top:-4px;right:-4px;background:var(--accent);color:#fff;border-radius:999px;
    font-size:10px;font-weight:700;min-width:16px;padding:0 4px;line-height:16px;text-align:center}
`;

function shortKey (pk) {
  return pk ? pk.slice(0, 8) + '…' : '?';
}

function fmtTime (ts) {
  if (!ts) return '';
  try {
    const d = new Date(ts);
    return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  } catch (_) {
    return String(ts).slice(0, 16);
  }
}

class Notifications extends React.Component {
  constructor (props) {
    super(props);
    this.state = {
      items: [],
      filter: 'all', // all | pending | resolved
      loading: true,
      busyId: null,
      error: null,
      token: null
    };
    this._timer = null;
  }

  componentDidMount () {
    this.ensureSession().then(() => this.refresh());
    this._timer = setInterval(() => this.refresh(), 5000);
  }

  componentWillUnmount () {
    if (this._timer) clearInterval(this._timer);
  }

  headers () {
    const h = { 'Content-Type': 'application/json' };
    if (this.state.token) h.Authorization = `Bearer ${this.state.token}`;
    return h;
  }

  async ensureSession () {
    const b = (typeof window !== 'undefined' && window.electronAPI && window.electronAPI.identity) || null;
    if (!b) return;
    try {
      const info = await b.get();
      if (!info || !info.unlocked || !b.signEnvelope) return;
      const envelope = await b.signEnvelope({ intent: 'login', ts: new Date().toISOString() });
      if (!envelope || envelope.error) return;
      const res = await fetch(`${BASE}/auth`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(envelope)
      });
      if (!res.ok) return;
      const json = await res.json();
      this.setState({ token: json.data.token });
    } catch (_) { /* locked */ }
  }

  async refresh () {
    try {
      const res = await fetch(`${BASE}/missionbroadcasts?pending=0`).then((r) => r.json());
      const items = (res.data || [])
        .filter((b) => b.status !== 'self')
        .map((b) => ({
          id: b.id,
          kind: 'mission',
          status: b.status || 'pending',
          title: (b.mission && b.mission.title) || 'Mission offer',
          body: (b.mission && b.mission.description) || null,
          reward: b.mission && b.mission.reward,
          source: b.source,
          handle: b.handle,
          ts: b.broadcastAt || b.receivedAt,
          resolvedAt: b.resolvedAt || null,
          missionId: b.missionId,
          raw: b
        }))
        .sort((a, b) => String(b.ts || '').localeCompare(String(a.ts || '')));
      this.setState({ items, loading: false, error: null });
      const pending = items.filter((i) => i.status === 'pending').length;
      if (typeof this.props.onPendingCount === 'function') this.props.onPendingCount(pending);
    } catch (e) {
      this.setState({ loading: false, error: e.message });
    }
  }

  async act (id, action) {
    if (this.state.busyId) return;
    this.setState({ busyId: id, error: null });
    try {
      if (!this.state.token) await this.ensureSession();
      const res = await fetch(`${BASE}/missionbroadcasts/${encodeURIComponent(id)}/${action}`, {
        method: 'POST',
        headers: this.headers(),
        body: '{}'
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
      this.setState({ busyId: null });
      await this.refresh();
      if (action === 'accept' && typeof window !== 'undefined') window.location.hash = 'missions';
    } catch (e) {
      this.setState({ busyId: null, error: e.message });
    }
  }

  filtered () {
    const f = this.state.filter;
    if (f === 'pending') return this.state.items.filter((i) => i.status === 'pending');
    if (f === 'resolved') return this.state.items.filter((i) => i.status !== 'pending');
    return this.state.items;
  }

  renderItem (item) {
    return React.createElement('div', {
      className: 'nt-item' + (item.status === 'pending' ? ' pending' : ''),
      key: item.id
    },
    React.createElement('div', { className: 'nt-head' },
      React.createElement('span', { className: 'nt-tag mission' }, 'mission'),
      React.createElement('span', { className: 'nt-tag ' + item.status }, item.status),
      React.createElement('span', { className: 'nt-title' }, item.title),
      item.reward
        ? React.createElement('span', { className: 'nt-tag mission' }, '₿ ' + Number(item.reward).toLocaleString())
        : null
    ),
    item.body
      ? React.createElement('div', { className: 'nt-body' }, String(item.body).slice(0, 280))
      : null,
    React.createElement('div', { className: 'nt-meta' },
      fmtTime(item.ts) +
      ' · ' + (item.handle || shortKey(item.source)) +
      ' · ' + shortKey(item.source) +
      (item.resolvedAt ? ' · resolved ' + fmtTime(item.resolvedAt) : '')
    ),
    item.status === 'pending'
      ? React.createElement('div', { className: 'nt-row' },
        React.createElement('button', {
          className: 'nt-btn good',
          disabled: this.state.busyId === item.id,
          onClick: () => this.act(item.id, 'accept')
        }, this.state.busyId === item.id ? '…' : 'Accept'),
        React.createElement('button', {
          className: 'nt-btn ghost',
          disabled: this.state.busyId === item.id,
          onClick: () => this.act(item.id, 'ignore')
        }, 'Ignore'),
        React.createElement('button', {
          className: 'nt-btn ghost',
          onClick: () => { window.location.hash = 'missions'; }
        }, 'Open Missions')
      )
      : React.createElement('div', { className: 'nt-row' },
        React.createElement('button', {
          className: 'nt-btn ghost',
          onClick: () => { window.location.hash = 'missions'; }
        }, 'Open Missions')
      )
    );
  }

  render () {
    const rows = this.filtered();
    const pending = this.state.items.filter((i) => i.status === 'pending').length;

    return React.createElement('div', { className: 'nt-wrap' },
      React.createElement('div', { className: 'nt-panel' },
        React.createElement('h2', null, '🔔 Notifications',
          React.createElement('span', { className: 'sub' },
            pending
              ? `${pending} pending · mission broadcasts from peers`
              : 'history of mission broadcasts and inbox actions')
        ),
        React.createElement('div', { className: 'nt-filters' },
          [['all', 'All'], ['pending', 'Pending'], ['resolved', 'Resolved']].map(([key, label]) =>
            React.createElement('button', {
              key,
              type: 'button',
              className: 'nt-chip' + (this.state.filter === key ? ' on' : ''),
              onClick: () => this.setState({ filter: key })
            }, label)
          )
        ),
        this.state.error ? React.createElement('div', { className: 'nt-err' }, this.state.error) : null,
        this.state.loading
          ? React.createElement('div', { className: 'nt-empty' }, 'loading…')
          : rows.length
            ? rows.map((item) => this.renderItem(item))
            : React.createElement('div', { className: 'nt-empty' },
              this.state.filter === 'pending'
                ? 'No pending notifications.'
                : 'No notifications yet — when a peer broadcasts a mission, it will show up here.')
      )
    );
  }
}

Notifications.CSS = CSS;

module.exports = Notifications;
