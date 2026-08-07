'use strict';

/**
 * Library — historical browser for the periodic activity snapshots.
 *
 * Shows reduced-size screen captures (services/SnapshotManager.js) as a
 * thumbnail grid grouped by day, with a full-size viewer overlay, disk
 * usage stats, and purge controls. Snapshots exist so a future image
 * analyzer can parse gameplay the Game.log does not cover.
 */

const React = require('react');

const BASE = '/services/star-citizen';

const CSS = `
  .lib-wrap{width:100%;max-width:none;margin:0;padding:12px 14px;display:grid;gap:16px;box-sizing:border-box}
  .lib-bar{display:flex;gap:12px;align-items:center;flex-wrap:wrap;background:var(--panel);
    border:1px solid var(--line);border-radius:12px;padding:12px 16px}
  .lib-bar .stat{color:var(--muted);font-size:12.5px}
  .lib-bar .stat b{color:var(--text)}
  .lib-btn{background:var(--panel2);border:1px solid var(--line);color:var(--text);
    border-radius:7px;padding:6px 13px;font-size:12.5px;cursor:pointer}
  .lib-btn:hover{border-color:var(--accent)}
  .lib-btn.danger{color:var(--kill)}
  .lib-btn:disabled{opacity:.45;cursor:default}
  .lib-day h3{font-size:13px;color:var(--muted);margin:8px 0 8px;font-weight:600}
  .lib-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:10px}
  .lib-thumb{position:relative;border:1px solid var(--line);border-radius:8px;overflow:hidden;
    cursor:pointer;background:var(--panel);padding:0}
  .lib-thumb img{display:block;width:100%;aspect-ratio:16/9;object-fit:cover}
  .lib-thumb:hover{border-color:var(--accent)}
  .lib-thumb .t{position:absolute;left:0;right:0;bottom:0;background:rgba(8,10,14,.72);
    color:var(--text);font-size:10.5px;padding:3px 7px;font-variant-numeric:tabular-nums;text-align:left}
  .lib-empty{color:var(--muted);text-align:center;font-style:italic;padding:40px 0;background:var(--panel);
    border:1px solid var(--line);border-radius:12px;font-size:13px;line-height:1.7}
  .lib-view{position:fixed;inset:0;z-index:48;background:rgba(8,10,14,.9);display:flex;
    flex-direction:column;align-items:center;justify-content:center;gap:12px;backdrop-filter:blur(3px)}
  .lib-view img{max-width:92vw;max-height:80vh;border:1px solid var(--line);border-radius:8px}
  .lib-view .meta{color:var(--muted);font-size:12.5px;font-variant-numeric:tabular-nums}
  .lib-view .row{display:flex;gap:10px}
`;

function fmtMB (bytes) {
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

function dayOf (ts) {
  return String(ts).slice(0, 10);
}

function timeOf (ts) {
  const m = String(ts).match(/T(\d{2}:\d{2}:\d{2})/);
  return m ? m[1] : String(ts);
}

class Library extends React.Component {
  constructor (props) {
    super(props);
    this.state = {
      snapshots: [],
      stats: null,
      loading: true,
      error: null,
      viewing: null, // snapshot record in the overlay
      busy: false
    };
    this._timer = null;
  }

  componentDidMount () {
    this.load();
    this._timer = setInterval(() => this.load(), 15000);
    this._onKey = (e) => {
      if (!this.state.viewing) return;
      if (e.key === 'Escape') this.setState({ viewing: null });
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') this.step(e.key === 'ArrowLeft' ? -1 : 1);
    };
    window.addEventListener('keydown', this._onKey);
  }

  componentWillUnmount () {
    if (this._timer) clearInterval(this._timer);
    window.removeEventListener('keydown', this._onKey);
  }

  async load () {
    try {
      const res = await fetch(`${BASE}/snapshots?limit=500`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      this.setState({ snapshots: json.data || [], stats: json.stats || null, loading: false, error: null });
    } catch (e) {
      this.setState({ loading: false, error: e.message });
    }
  }

  /** Move the viewer to the previous/next snapshot (newest-first list). */
  step (direction) {
    const idx = this.state.snapshots.findIndex((s) => s.id === (this.state.viewing && this.state.viewing.id));
    const next = this.state.snapshots[idx - direction]; // list is newest-first
    if (next) this.setState({ viewing: next });
  }

  async purgeAll () {
    if (!window.confirm('Delete ALL snapshots? This cannot be undone.')) return;
    this.setState({ busy: true });
    try {
      await fetch(`${BASE}/snapshots`, { method: 'DELETE' });
      await this.load();
    } finally {
      this.setState({ busy: false, viewing: null });
    }
  }

  renderBar () {
    const s = this.state.stats;
    return React.createElement('div', { className: 'lib-bar' },
      React.createElement('span', { className: 'stat' }, 'snapshots ', React.createElement('b', null, s ? s.count : '—')),
      React.createElement('span', { className: 'stat' }, 'disk ', React.createElement('b', null, s ? fmtMB(s.bytes) : '—'),
        s ? ` / ${fmtMB(s.maxBytes)} cap` : ''),
      s
        ? React.createElement('span', { className: 'stat' },
          s.enabled
            ? (s.available ? `capturing every ${Math.round(s.intervalMs / 1000)}s` : 'enabled — desktop app required to capture')
            : 'capture off — enable in Settings ⚙')
        : null,
      s && s.autoPurge ? React.createElement('span', { className: 'stat' }, 'auto-purge on') : null,
      s && s.lastError ? React.createElement('span', { className: 'stat', style: { color: 'var(--kill)' } }, 'error: ' + s.lastError) : null,
      React.createElement('span', { style: { flex: 1 } }),
      React.createElement('button', { className: 'lib-btn', onClick: () => this.load() }, 'Refresh'),
      React.createElement('button', {
        className: 'lib-btn danger', disabled: this.state.busy || !this.state.snapshots.length,
        onClick: () => this.purgeAll()
      }, 'Purge all')
    );
  }

  renderViewer () {
    const v = this.state.viewing;
    if (!v) return null;
    return React.createElement('div', { className: 'lib-view', onClick: (e) => { if (e.target === e.currentTarget) this.setState({ viewing: null }); } },
      React.createElement('img', { src: `${BASE}/snapshots/${encodeURIComponent(v.id)}/image`, alt: v.ts }),
      React.createElement('div', { className: 'meta' },
        `${v.ts.replace('T', ' ').slice(0, 19)} · ${v.width || '?'}×${v.height || '?'} · ${fmtMB(v.bytes || 0)}`),
      React.createElement('div', { className: 'row' },
        React.createElement('button', { className: 'lib-btn', onClick: () => this.step(-1) }, '← newer'),
        React.createElement('button', { className: 'lib-btn', onClick: () => this.setState({ viewing: null }) }, 'Close (Esc)'),
        React.createElement('button', { className: 'lib-btn', onClick: () => this.step(1) }, 'older →')
      )
    );
  }

  render () {
    const groups = new Map();
    for (const s of this.state.snapshots) {
      const day = dayOf(s.ts);
      if (!groups.has(day)) groups.set(day, []);
      groups.get(day).push(s);
    }

    return React.createElement('div', { className: 'lib-wrap' },
      this.renderBar(),
      this.state.error ? React.createElement('div', { className: 'lib-empty' }, 'Could not load snapshots: ' + this.state.error) : null,
      !this.state.error && !this.state.snapshots.length && !this.state.loading
        ? React.createElement('div', { className: 'lib-empty' },
          'No snapshots yet.', React.createElement('br'),
          'Enable periodic snapshots in Settings ⚙ — the desktop app captures a reduced-size screenshot every few seconds while you play, for later image analysis.')
        : null,
      [...groups.entries()].map(([day, snaps]) => React.createElement('div', { className: 'lib-day', key: day },
        React.createElement('h3', null, `${day} — ${snaps.length} snapshot${snaps.length === 1 ? '' : 's'}`),
        React.createElement('div', { className: 'lib-grid' },
          snaps.map((s) => React.createElement('button', {
            className: 'lib-thumb', key: s.id, title: s.ts,
            onClick: () => this.setState({ viewing: s })
          },
          React.createElement('img', { src: `${BASE}/snapshots/${encodeURIComponent(s.id)}/image`, loading: 'lazy', alt: s.ts }),
          React.createElement('span', { className: 't' }, timeOf(s.ts))
          ))
        )
      )),
      this.renderViewer()
    );
  }
}

Library.CSS = CSS;

module.exports = Library;
