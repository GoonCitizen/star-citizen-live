'use strict';

/**
 * Dashboard Map tab — in-game starmap plus local location reports.
 * Click a point or search row to open `/locations/:slug`.
 */

const React = require('react');
const StarMap = require('./StarMap');

const BASE = '/services/star-citizen';

function locationHref (slug) {
  const s = String(slug || '').trim();
  if (!s) return null;
  return '/locations/' + encodeURIComponent(s);
}

const CSS = `
  .mmap{padding:12px 14px;display:grid;gap:14px}
  .mmap-hero{background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:18px 20px}
  .mmap-hero h1{margin:0 0 6px;font-size:18px}
  .mmap-hero .sub{color:var(--muted);font-size:13px;line-height:1.55;max-width:62em}
  .mmap-grid{display:grid;grid-template-columns:minmax(0,1.4fr) minmax(240px,0.8fr);gap:12px;align-items:start}
  @media(max-width:900px){.mmap-grid{grid-template-columns:1fr}}
  .mmap-panel{background:var(--panel);border:1px solid var(--line);border-radius:12px;overflow:hidden}
  .mmap-panel h2{font-size:13px;margin:0;padding:12px 14px;border-bottom:1px solid var(--line);font-weight:600}
  .mmap-panel .body{padding:12px 14px;display:grid;gap:10px}
  .mmap-search{width:100%;background:var(--bg);border:1px solid var(--line);color:var(--text);
    border-radius:8px;padding:7px 10px;font-size:13px;font-family:inherit;box-sizing:border-box}
  .mmap-search:focus{outline:none;border-color:var(--accent)}
  .mmap-list{list-style:none;margin:0;padding:0;display:grid;gap:4px;max-height:42vh;overflow:auto}
  .mmap-row{display:flex;gap:8px;align-items:baseline;width:100%;text-align:left;background:var(--bg);
    border:1px solid var(--line);border-radius:8px;padding:8px 10px;color:var(--text);cursor:pointer;font:inherit}
  .mmap-row:hover{border-color:var(--accent)}
  .mmap-row .n{font-size:13px;font-weight:600;flex:1;min-width:0}
  .mmap-row .meta{color:var(--muted);font-size:11.5px}
  .mmap-empty{color:var(--muted);font-size:12.5px;line-height:1.5}
  .mmap-err{background:rgba(248,81,73,.12);color:var(--kill);border-radius:7px;padding:8px 10px;font-size:13px}
`;

function openLocation (pt) {
  if (typeof window === 'undefined') return;
  const token = (pt && (pt.slug || pt.token || pt.name)) || pt;
  const href = locationHref(token) ||
    (token ? '/locations/' + encodeURIComponent(String(token)) : null);
  if (href) window.location.href = href;
}

class MapPage extends React.Component {
  constructor (props) {
    super(props);
    this.state = {
      query: '',
      locations: [],
      reports: [],
      error: null
    };
    this._searchTimer = null;
  }

  componentDidMount () {
    this.loadBrowse('');
    this.loadReports();
  }

  componentWillUnmount () {
    if (this._searchTimer) clearTimeout(this._searchTimer);
  }

  onQuery (value) {
    this.setState({ query: value });
    if (this._searchTimer) clearTimeout(this._searchTimer);
    this._searchTimer = setTimeout(() => this.loadBrowse(value), 180);
  }

  async loadBrowse (query) {
    try {
      const params = new URLSearchParams();
      params.set('limit', '48');
      if (query) params.set('q', query);
      const res = await fetch(`${BASE}/locations?${params}`, { cache: 'no-store' });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error || res.statusText);
      const rows = Array.isArray(j.data) ? j.data : [];
      this.setState({ locations: rows, error: null });
    } catch (e) {
      this.setState({ error: e.message || String(e) });
    }
  }

  async loadReports () {
    try {
      const res = await fetch(`${BASE}/locations/reports?limit=24`, { cache: 'no-store' });
      if (res.status === 401) {
        this.setState({ reports: [] });
        return;
      }
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error || res.statusText);
      const rows = Array.isArray(j.data) ? j.data : [];
      this.setState({ reports: rows });
    } catch (_) {
      this.setState({ reports: [] });
    }
  }

  render () {
    const q = this.state.query;
    return React.createElement('div', { className: 'mmap' },
      React.createElement('section', { className: 'mmap-hero' },
        React.createElement('h1', null, 'Map'),
        React.createElement('div', { className: 'sub' },
          'Browse Stanton / Pyro / Nyx from the in-game starmap (landing zones, outposts, stations). Click a body or search a name to open its page. This node accumulates recent players from your Game.log QT hops and from presence your peers share — reports stay local until more data arrives.')
      ),
      this.state.error
        ? React.createElement('div', { className: 'mmap-err' }, this.state.error)
        : null,
      React.createElement('div', { className: 'mmap-grid' },
        React.createElement('section', { className: 'mmap-panel' },
          React.createElement('h2', null, 'System map'),
          React.createElement('div', { className: 'body' },
            React.createElement(StarMap, {
              system: 'STANTON',
              includeHotspots: true,
              height: 360,
              onSelect: (pt) => openLocation(pt)
            })
          )
        ),
        React.createElement('div', { style: { display: 'grid', gap: 12 } },
          React.createElement('section', { className: 'mmap-panel' },
            React.createElement('h2', null, 'Find a location'),
            React.createElement('div', { className: 'body' },
              React.createElement('input', {
                className: 'mmap-search',
                type: 'search',
                placeholder: 'Area18, CRU-L1, Daymar…',
                value: q,
                onChange: (e) => this.onQuery(e.target.value)
              }),
              this.state.locations.length
                ? React.createElement('ul', { className: 'mmap-list' },
                  this.state.locations.map((loc) => React.createElement('li', { key: loc.slug },
                    React.createElement('button', {
                      type: 'button',
                      className: 'mmap-row',
                      onClick: () => openLocation(loc)
                    },
                    React.createElement('span', { className: 'n' }, loc.name || loc.slug),
                    React.createElement('span', { className: 'meta' },
                      [loc.system, loc.type].filter(Boolean).join(' · '))
                    )
                  )))
                : React.createElement('div', { className: 'mmap-empty' },
                  q ? 'No catalog matches.' : 'Loading catalog…')
            )
          ),
          React.createElement('section', { className: 'mmap-panel' },
            React.createElement('h2', null, 'Recent on this node'),
            React.createElement('div', { className: 'body' },
              this.state.reports.length
                ? React.createElement('ul', { className: 'mmap-list' },
                  this.state.reports.map((row) => React.createElement('li', { key: row.slug },
                    React.createElement('button', {
                      type: 'button',
                      className: 'mmap-row',
                      onClick: () => openLocation(row)
                    },
                    React.createElement('span', { className: 'n' }, row.name || row.slug),
                    React.createElement('span', { className: 'meta' },
                      (row.playerCount || 0) + ' player' + (row.playerCount === 1 ? '' : 's'))
                    )
                  )))
                : React.createElement('div', { className: 'mmap-empty' },
                  'No location reports yet. QT in-game or share presence with peers — this node keeps a local log of who was where.')
            )
          )
        )
      )
    );
  }
}

MapPage.CSS = CSS;
MapPage.openLocation = openLocation;

module.exports = MapPage;
