'use strict';

/**
 * Dedicated collection record page — `/collections/:kind/:id`.
 * Search hits that are not first-class `/profiles`, `/groups`, or `/missions`
 * land here (notes, guilds, channels, messages, fleets, inbox, Fabric AMP, …).
 */

const React = require('react');
const { kindLabel } = require('../functions/collectionRecords');
const { applySearchHit } = require('../functions/appSearch');

const BASE = '/services/star-citizen';

const CSS = `
  .cpage{width:100%;max-width:none;margin:0;padding:12px 14px;display:grid;gap:16px;box-sizing:border-box}
  .cpage-back{color:var(--muted);font-size:13px;text-decoration:none;cursor:pointer;background:none;border:none;padding:0;font:inherit;text-align:left}
  .cpage-back:hover{color:var(--accent)}
  .cpage-hero{background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:22px 24px}
  .cpage-hero h1{margin:0 0 8px;font-size:20px;display:flex;flex-wrap:wrap;gap:8px;align-items:center}
  .cpage-hero .sub{color:var(--muted);font-size:12.5px;line-height:1.5;word-break:break-all}
  .cpage-tag{font-size:10.5px;font-weight:700;padding:2px 8px;border-radius:5px;letter-spacing:.02em;
    background:rgba(56,139,253,.15);color:var(--accent)}
  .cpage-panel{background:var(--panel);border:1px solid var(--line);border-radius:12px;overflow:hidden}
  .cpage-panel h2{font-size:13px;margin:0;padding:12px 16px;border-bottom:1px solid var(--line);font-weight:600}
  .cpage-panel .body{padding:14px 16px;display:grid;gap:10px}
  .cpage-err{background:rgba(248,81,73,.12);color:var(--kill);border-radius:7px;padding:9px 12px;font-size:13px}
  .cpage-hint{color:var(--muted);font-size:12.5px;line-height:1.55}
  .cpage-btn{background:var(--panel2);border:1px solid var(--line);color:var(--text);border-radius:7px;
    padding:6px 12px;font-size:12px;font-weight:600;cursor:pointer;text-decoration:none;display:inline-block}
  .cpage-btn:hover{border-color:var(--accent);color:var(--accent)}
  .cpage-row{display:flex;flex-wrap:wrap;gap:8px;align-items:center}
  .cpage-json{margin:0;padding:10px 12px;background:var(--bg);border:1px solid var(--line);border-radius:8px;
    font-family:'Cascadia Code',Consolas,monospace;font-size:11px;overflow:auto;max-height:420px;
    white-space:pre-wrap;word-break:break-all}
  .cpage-img{max-width:100%;border-radius:8px;border:1px solid var(--line)}
  .cpage-link{color:var(--accent);font-size:13px}
`;

class CollectionRecord extends React.Component {
  constructor (props) {
    super(props);
    this.state = {
      loading: true,
      error: null,
      detail: null
    };
  }

  get kind () {
    const parsed = CollectionRecord.fromLocation();
    return (parsed && parsed.kind) || this.props.kind || null;
  }

  get recordId () {
    const parsed = CollectionRecord.fromLocation();
    return (parsed && parsed.id) || this.props.recordId || this.props.id || null;
  }

  componentDidMount () {
    this.load();
  }

  async load () {
    const kind = this.kind;
    const id = this.recordId;
    if (!kind || !id) {
      this.setState({ loading: false, error: 'Missing collection record' });
      return;
    }
    this.setState({ loading: true, error: null });
    try {
      const res = await fetch(
        `${BASE}/collections/${encodeURIComponent(kind)}/${encodeURIComponent(id)}`
      );
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((j && j.error) || 'Record unavailable');
      this.setState({ loading: false, detail: j.data || j, error: null });
    } catch (e) {
      this.setState({ loading: false, error: e.message || String(e) });
    }
  }

  goBack () {
    if (typeof window === 'undefined') return;
    if (window.history.length > 1) window.history.back();
    else window.location.href = '/';
  }

  openAction (action) {
    if (!action) return;
    applySearchHit({
      href: null,
      hash: action.hash || '',
      tab: action.tab || null,
      channel: action.channel || null,
      peopleQuery: action.peopleQuery || null,
      rosterMode: action.rosterMode || null
    });
    const dest = action.href || (action.hash ? ('/#' + String(action.hash).replace(/^#/, '')) : '/');
    window.location.href = dest;
  }

  render () {
    if (this.state.loading) {
      return React.createElement('div', { className: 'cpage' },
        React.createElement('div', { className: 'cpage-hint' }, 'Loading…'));
    }
    if (this.state.error && !this.state.detail) {
      return React.createElement('div', { className: 'cpage' },
        React.createElement('button', { type: 'button', className: 'cpage-back', onClick: () => this.goBack() }, '← Back'),
        React.createElement('div', { className: 'cpage-err' }, this.state.error)
      );
    }
    const d = this.state.detail || {};
    const kind = d.kind || this.kind;
    const rec = d.record || {};
    const imageSrc = kind === 'snapshot' && rec.id
      ? `${BASE}/snapshots/${encodeURIComponent(rec.id)}/image`
      : null;
    return React.createElement('div', { className: 'cpage' },
      React.createElement('button', { type: 'button', className: 'cpage-back', onClick: () => this.goBack() }, '← Back'),
      React.createElement('div', { className: 'cpage-hero' },
        React.createElement('h1', null,
          d.title || d.id || 'Record',
          React.createElement('span', { className: 'cpage-tag' }, kindLabel(kind))
        ),
        React.createElement('div', { className: 'sub' }, d.subtitle || d.href || d.id)
      ),
      d.missing
        ? React.createElement('div', { className: 'cpage-hint' },
          'This Fabric message is not in this node’s live AMP log (ring buffer). The hash is still a stable collection id.')
        : null,
      React.createElement('div', { className: 'cpage-row' },
        (d.actions || []).map((action, i) => React.createElement('button', {
          key: action.rel + '-' + i,
          type: 'button',
          className: 'cpage-btn',
          onClick: () => this.openAction(action)
        }, action.title || action.rel)),
        (d.links || []).map((link, i) => React.createElement('a', {
          key: (link.href || i) + '-l',
          className: 'cpage-btn',
          href: link.href
        }, link.title || 'Open'))
      ),
      imageSrc
        ? React.createElement('div', { className: 'cpage-panel' },
          React.createElement('h2', null, 'Image'),
          React.createElement('div', { className: 'body' },
            React.createElement('img', { className: 'cpage-img', src: imageSrc, alt: d.title || 'Snapshot' })))
        : null,
      React.createElement('div', { className: 'cpage-panel' },
        React.createElement('h2', null, 'Record'),
        React.createElement('div', { className: 'body' },
          React.createElement('pre', { className: 'cpage-json' }, JSON.stringify(rec, null, 2))))
    );
  }
}

CollectionRecord.CSS = CSS;
CollectionRecord.fromLocation = function () {
  const m = String((typeof window !== 'undefined' && window.location.pathname) || '')
    .match(/^\/collections\/([^/]+)\/([^/]+)/);
  if (!m) return null;
  return {
    kind: decodeURIComponent(m[1]),
    id: decodeURIComponent(m[2])
  };
};

module.exports = CollectionRecord;
