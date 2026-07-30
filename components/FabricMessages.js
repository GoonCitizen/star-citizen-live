'use strict';

/**
 * Advanced-mode Fabric AMP Message log viewer.
 * Shows signed wire Messages only (not Game.log lines).
 */

const React = require('react');

const BASE = '/services/star-citizen';

const CSS = `
  .fm-wrap{max-width:1100px;margin:0 auto;padding:18px;display:grid;gap:14px}
  .fm-panel{background:var(--panel);border:1px solid var(--line);border-radius:12px;overflow:hidden}
  .fm-panel h2{font-size:13px;margin:0;padding:12px 16px;border-bottom:1px solid var(--line);font-weight:600;display:flex;flex-wrap:wrap;gap:8px;align-items:center}
  .fm-panel h2 .sub{font-weight:500;color:var(--muted);font-size:12px}
  .fm-panel .body{padding:12px 16px}
  .fm-hint{color:var(--muted);font-size:12.5px;line-height:1.55;margin:0 0 10px}
  .fm-err{background:rgba(248,81,73,.12);color:var(--kill);border-radius:7px;padding:9px 12px;font-size:13px;margin-bottom:10px}
  .fm-bar{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-bottom:10px}
  .fm-bar input[type=text]{background:var(--bg);border:1px solid var(--line);color:var(--text);
    border-radius:7px;padding:7px 10px;font-size:12.5px;min-width:180px;flex:1}
  .fm-bar label{display:flex;align-items:center;gap:6px;font-size:12px;color:var(--muted);cursor:pointer;user-select:none}
  .fm-chips{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:10px}
  .fm-chip{background:var(--panel2);border:1px solid var(--line);color:var(--muted);border-radius:999px;
    padding:3px 10px;font-size:11.5px;cursor:pointer}
  .fm-chip.on{background:rgba(56,139,253,.15);border-color:var(--accent);color:var(--accent)}
  .fm-btn{background:var(--panel2);border:1px solid var(--line);color:var(--text);border-radius:7px;
    padding:6px 12px;font-size:12px;font-weight:600;cursor:pointer}
  .fm-btn:hover{border-color:var(--accent)}
  .fm-btn.danger{color:var(--kill)}
  .fm-btn.primary{background:var(--accent);border-color:var(--accent);color:#fff}
  .fm-meta{font-size:11.5px;color:var(--muted)}
  .fm-feed{max-height:min(70vh,720px);overflow:auto;font-family:'Cascadia Code',Consolas,monospace;font-size:12px;
    border:1px solid var(--line);border-radius:8px;background:var(--bg)}
  .fm-row{padding:8px 12px;border-bottom:1px solid #20262f;cursor:pointer}
  .fm-row:hover{background:rgba(56,139,253,.06)}
  .fm-row.open{background:rgba(56,139,253,.08)}
  .fm-row .top{display:flex;flex-wrap:wrap;gap:8px;align-items:baseline}
  .fm-dir{font-weight:700;min-width:1.2em}
  .fm-dir.in{color:var(--good)}
  .fm-dir.out{color:var(--accent)}
  .fm-type{color:var(--text);font-weight:600}
  .fm-app{color:var(--muted)}
  .fm-ts{color:var(--muted);margin-left:auto;font-size:11px}
  .fm-peer{color:var(--muted);font-size:11px;margin-top:3px;word-break:break-all}
  .fm-detail{margin-top:8px;padding:8px 10px;background:var(--panel);border:1px solid var(--line);border-radius:6px;
    white-space:pre-wrap;word-break:break-word;max-height:280px;overflow:auto;font-size:11.5px;color:var(--text)}
  .fm-empty{padding:28px 16px;text-align:center;color:var(--muted);font-size:13px}
`;

function shortTime (iso) {
  if (!iso) return '—';
  try {
    const d = new Date(iso);
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  } catch (_) {
    return String(iso);
  }
}

function bodyText (entry) {
  if (!entry) return '';
  if (entry.body != null && typeof entry.body === 'object') {
    try { return JSON.stringify(entry.body, null, 2); } catch (_) { /* fall through */ }
  }
  return entry.bodyPreview || '';
}

class FabricMessages extends React.Component {
  constructor (props) {
    super(props);
    this.state = {
      loading: true,
      error: null,
      messages: [],
      meta: null,
      dir: 'all',
      type: props.defaultType || null,
      q: '',
      showKeepalive: false,
      auto: true,
      openId: null,
      busy: false
    };
    this._timer = null;
    this._feedRef = React.createRef();
  }

  componentDidMount () {
    this.refresh();
    this._timer = setInterval(() => {
      if (this.state.auto) this.refresh({ quiet: true });
    }, 2000);
  }

  componentDidUpdate (prev) {
    if (prev.contract !== this.props.contract) this.refresh();
  }

  componentWillUnmount () {
    if (this._timer) clearInterval(this._timer);
  }

  async refresh ({ quiet = false } = {}) {
    if (!quiet) this.setState({ loading: true, error: null });
    try {
      const params = new URLSearchParams();
      params.set('limit', this.props.embedded ? '200' : '400');
      if (this.state.dir === 'in' || this.state.dir === 'out') params.set('dir', this.state.dir);
      if (this.state.type) params.set('type', this.state.type);
      if (this.state.q.trim()) params.set('q', this.state.q.trim());
      if (this.state.showKeepalive) params.set('keepalive', '1');
      if (this.props.contract) params.set('contract', this.props.contract);
      const res = await fetch(`${BASE}/fabric/messages?${params}`);
      const j = await res.json();
      if (!res.ok) throw new Error((j && j.error) || res.statusText);
      const el = this._feedRef.current;
      const stickBottom = el && (el.scrollTop + el.clientHeight >= el.scrollHeight - 40);
      this.setState({
        loading: false,
        messages: Array.isArray(j.data) ? j.data : [],
        meta: j.meta || null,
        error: null
      }, () => {
        if (stickBottom && this._feedRef.current) {
          this._feedRef.current.scrollTop = this._feedRef.current.scrollHeight;
        }
      });
    } catch (e) {
      this.setState({ loading: false, error: e.message || String(e) });
    }
  }

  async clear () {
    if (!window.confirm('Clear the in-memory Fabric message log?')) return;
    this.setState({ busy: true });
    try {
      await fetch(`${BASE}/fabric/messages/clear`, { method: 'POST' });
      await this.refresh();
    } catch (e) {
      this.setState({ error: e.message });
    } finally {
      this.setState({ busy: false });
    }
  }

  async setPaused (paused) {
    this.setState({ busy: true });
    try {
      await fetch(`${BASE}/fabric/messages/${paused ? 'pause' : 'resume'}`, { method: 'POST' });
      await this.refresh();
    } catch (e) {
      this.setState({ error: e.message });
    } finally {
      this.setState({ busy: false });
    }
  }

  setDir (dir) {
    this.setState({ dir }, () => this.refresh());
  }

  setType (type) {
    this.setState({ type: this.state.type === type ? null : type }, () => this.refresh());
  }

  render () {
    const meta = this.state.meta || {};
    const types = (meta.types || []).slice(0, 12);
    const paused = !!meta.paused;
    const embedded = !!this.props.embedded;
    const hideCapture = !!this.props.hideCaptureControls;
    const title = this.props.title || 'Fabric messages';
    const subtitle = this.props.subtitle ||
      (this.props.contract
        ? `— contract ${String(this.props.contract).slice(0, 16)}…`
        : '— AMP wire Messages only (chat, contracts, peering). Not Game.log.');

    const body = React.createElement('div', { className: 'body' },
      !embedded
        ? React.createElement('p', { className: 'fm-hint' },
          'Live ring buffer of signed Fabric Messages your peer sends and receives. ',
          'Session keepalive frames are hidden by default. Buffer is in-memory and clears on restart.')
        : (this.props.contract
          ? React.createElement('p', { className: 'fm-hint' },
            'Wire Messages whose contract field matches this group (GroupChat, GroupShare, GroupActivityTree, …).')
          : null),
      this.state.error
        ? React.createElement('div', { className: 'fm-err' }, this.state.error)
        : null,
      React.createElement('div', { className: 'fm-bar' },
        React.createElement('button', {
          type: 'button', className: 'fm-chip' + (this.state.dir === 'all' ? ' on' : ''),
          onClick: () => this.setDir('all')
        }, 'All'),
        React.createElement('button', {
          type: 'button', className: 'fm-chip' + (this.state.dir === 'in' ? ' on' : ''),
          onClick: () => this.setDir('in')
        }, '← In'),
        React.createElement('button', {
          type: 'button', className: 'fm-chip' + (this.state.dir === 'out' ? ' on' : ''),
          onClick: () => this.setDir('out')
        }, '→ Out'),
        React.createElement('input', {
          type: 'text',
          value: this.state.q,
          placeholder: 'filter type, peer, body…',
          onChange: (e) => this.setState({ q: e.target.value }),
          onKeyDown: (e) => { if (e.key === 'Enter') this.refresh(); }
        }),
        React.createElement('button', {
          type: 'button', className: 'fm-btn',
          onClick: () => this.refresh()
        }, 'Refresh'),
        React.createElement('label', null,
          React.createElement('input', {
            type: 'checkbox',
            checked: this.state.auto,
            onChange: (e) => this.setState({ auto: e.target.checked })
          }),
          'Auto-refresh'
        ),
        !hideCapture
          ? React.createElement('label', null,
            React.createElement('input', {
              type: 'checkbox',
              checked: this.state.showKeepalive,
              onChange: (e) => this.setState({ showKeepalive: e.target.checked }, () => this.refresh())
            }),
            'Show keepalive'
          )
          : null,
        !hideCapture
          ? React.createElement('button', {
            type: 'button',
            className: 'fm-btn' + (paused ? ' primary' : ''),
            disabled: this.state.busy,
            onClick: () => this.setPaused(!paused)
          }, paused ? 'Resume capture' : 'Pause capture')
          : null,
        !hideCapture
          ? React.createElement('button', {
            type: 'button', className: 'fm-btn danger',
            disabled: this.state.busy,
            onClick: () => this.clear()
          }, 'Clear')
          : null
      ),
      types.length
        ? React.createElement('div', { className: 'fm-chips' },
          types.map((t) => React.createElement('button', {
            key: t.type,
            type: 'button',
            className: 'fm-chip' + (this.state.type === t.type ? ' on' : ''),
            onClick: () => this.setType(t.type),
            title: `${t.n} in buffer`
          }, `${t.type} ${t.n}`))
        )
        : null,
      React.createElement('div', { className: 'fm-meta' },
        this.state.loading && !this.state.messages.length
          ? 'Loading…'
          : `${this.state.messages.length} shown · ${meta.count || 0}/${meta.capacity || 500} buffered` +
            (this.props.contract ? ' · contract filter' : '') +
            (paused ? ' · capture paused' : '')),
      React.createElement('div', {
        className: 'fm-feed',
        ref: this._feedRef,
        style: embedded ? { maxHeight: 'min(40vh, 360px)' } : undefined
      },
      !this.state.messages.length
        ? React.createElement('div', { className: 'fm-empty' },
          this.props.contract
            ? 'No Fabric Messages for this group contract in the buffer yet.'
            : 'No Fabric Messages yet. Unlock identity, connect peers, chat, or Import a fabric:<hex> share.')
        : this.state.messages.map((m) => {
          const open = this.state.openId === m.id;
          return React.createElement('div', {
            key: m.id,
            className: 'fm-row' + (open ? ' open' : ''),
            onClick: () => this.setState({ openId: open ? null : m.id })
          },
          React.createElement('div', { className: 'top' },
            React.createElement('span', {
              className: 'fm-dir ' + (m.direction === 'out' ? 'out' : 'in')
            }, m.direction === 'out' ? '→' : '←'),
            React.createElement('span', { className: 'fm-type' }, m.type || '?'),
            m.appType
              ? React.createElement('span', { className: 'fm-app' }, m.appType)
              : null,
            m.via
              ? React.createElement('span', { className: 'fm-app' }, `via ${m.via}`)
              : null,
            React.createElement('span', { className: 'fm-ts' }, shortTime(m.ts))
          ),
          (m.peer || m.actor || m.hash || m.contract)
            ? React.createElement('div', { className: 'fm-peer' },
              [
                m.peer ? `peer ${m.peer}` : null,
                m.actor ? `actor ${String(m.actor).slice(0, 16)}…` : null,
                m.contract ? `contract ${String(m.contract).slice(0, 12)}…` : null,
                m.hash ? `hash ${String(m.hash).slice(0, 16)}…` : null,
                m.bodyBytes != null ? `${m.bodyBytes} B` : null
              ].filter(Boolean).join(' · '))
            : null,
          open
            ? React.createElement('pre', { className: 'fm-detail' }, bodyText(m) || '(empty body)')
            : null
          );
        })
      )
    );

    if (embedded) {
      return React.createElement('div', null, body);
    }

    return React.createElement('div', { className: 'fm-wrap' },
      React.createElement('section', { className: 'fm-panel' },
        React.createElement('h2', null, title + ' ',
          React.createElement('span', { className: 'sub' }, subtitle)),
        body
      )
    );
  }
}

FabricMessages.CSS = CSS;

module.exports = FabricMessages;
