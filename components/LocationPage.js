'use strict';

/**
 * Dedicated location page — `/locations/:slug`.
 * Wiki catalog metadata plus node-local reports (recent players, online now).
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
  .lpage{width:100%;max-width:none;margin:0;padding:12px 14px;display:grid;gap:16px;box-sizing:border-box}
  .lpage-back{color:var(--muted);font-size:13px;text-decoration:none;cursor:pointer;background:none;border:none;
    padding:0;font:inherit;text-align:left}
  .lpage-back:hover{color:var(--accent)}
  .lpage-hero{background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:22px 24px}
  .lpage-hero h1{margin:0 0 6px;font-size:20px}
  .lpage-hero .sub{color:var(--muted);font-size:13px;line-height:1.5}
  .lpage-tags{display:flex;flex-wrap:wrap;gap:6px;margin-top:10px}
  .lpage-tag{font-size:10.5px;font-weight:700;padding:2px 8px;border-radius:5px;letter-spacing:.02em;
    background:rgba(56,139,253,.15);color:var(--accent)}
  .lpage-panel{background:var(--panel);border:1px solid var(--line);border-radius:12px;overflow:hidden}
  .lpage-panel h2{font-size:13px;margin:0;padding:12px 16px;border-bottom:1px solid var(--line);font-weight:600}
  .lpage-panel .body{padding:14px 16px;display:grid;gap:8px}
  .lpage-err{background:rgba(248,81,73,.12);color:var(--kill);border-radius:7px;padding:9px 12px;font-size:13px}
  .lpage-hint{color:var(--muted);font-size:12.5px;line-height:1.55}
  .lpage-row{display:flex;flex-wrap:wrap;gap:8px 14px;align-items:baseline;
    background:var(--bg);border:1px solid var(--line);border-radius:8px;padding:8px 10px}
  .lpage-row a{color:var(--accent);text-decoration:none;font-weight:600}
  .lpage-row a:hover{text-decoration:underline}
  .lpage-row .meta{color:var(--muted);font-size:12px}
  .lpage-kpis{display:flex;flex-wrap:wrap;gap:10px;margin-top:12px}
  .lpage-kpi{background:var(--panel2);border:1px solid var(--line);border-radius:8px;padding:8px 12px;min-width:88px}
  .lpage-kpi .l{font-size:11px;color:var(--muted)}
  .lpage-kpi .v{font-size:16px;font-weight:700}
`;

function formatWhen (iso) {
  if (!iso) return '';
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return String(iso);
    return d.toLocaleString();
  } catch (_) {
    return String(iso);
  }
}

function playerLabel (row) {
  return (row && (row.nickname || row.handle || row.actor)) || 'Unknown pilot';
}

class LocationPage extends React.Component {
  constructor (props) {
    super(props);
    this.state = {
      loading: true,
      error: null,
      detail: null
    };
  }

  get slug () {
    return LocationPage.slugFromLocation() || this.props.slug || this.props.id || null;
  }

  componentDidMount () {
    this.load();
  }

  async load () {
    const slug = this.slug;
    if (!slug) {
      this.setState({ loading: false, error: 'Missing location' });
      return;
    }
    this.setState({ loading: true, error: null });
    try {
      const res = await fetch(`${BASE}/locations/${encodeURIComponent(slug)}`, { cache: 'no-store' });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((j && j.error) || 'Location unavailable');
      this.setState({ loading: false, detail: j.data || j, error: null });
    } catch (e) {
      this.setState({ loading: false, error: e.message || String(e) });
    }
  }

  goBack () {
    if (typeof window === 'undefined') return;
    if (window.history.length > 1) window.history.back();
    else window.location.href = '/#map';
  }

  renderPlayer (row, i) {
    const label = playerLabel(row);
    const ship = row.ship && (row.ship.name || row.ship.slug);
    const when = formatWhen(row.at || row.updatedAt);
    const role = row.enroute ? 'en route' : (row.here ? 'here now' : (row.role === 'destination' ? 'en route' : 'visited'));
    const inner = [
      row.href
        ? React.createElement('a', { href: row.href, key: 'n' }, label)
        : React.createElement('b', { key: 'n' }, label),
      React.createElement('span', { className: 'meta', key: 'm' },
        [role, ship, when].filter(Boolean).join(' · '))
    ];
    return React.createElement('div', { className: 'lpage-row', key: (row.actor || label) + '-' + i }, inner);
  }

  render () {
    const detail = this.state.detail;
    const loc = detail && detail.location;
    const reports = (detail && detail.reports) || {};
    const online = (detail && detail.online) || [];
    const recent = reports.recent || [];
    if (this.state.loading) {
      return React.createElement('div', { className: 'lpage' },
        React.createElement('button', { type: 'button', className: 'lpage-back', onClick: () => this.goBack() },
          '← Back to map'),
        React.createElement('div', { className: 'lpage-hint' }, 'Loading location…')
      );
    }
    if (this.state.error || !loc) {
      return React.createElement('div', { className: 'lpage' },
        React.createElement('button', { type: 'button', className: 'lpage-back', onClick: () => this.goBack() },
          '← Back to map'),
        React.createElement('div', { className: 'lpage-err' }, this.state.error || 'Location not found')
      );
    }
    const system = loc.system || (detail.mapSystem) || 'STANTON';
    return React.createElement('div', { className: 'lpage' },
      React.createElement('button', { type: 'button', className: 'lpage-back', onClick: () => this.goBack() },
        '← Back to map'),
      React.createElement('section', { className: 'lpage-hero' },
        React.createElement('h1', null, loc.name || loc.slug),
        React.createElement('div', { className: 'sub' },
          [loc.system, loc.parent, loc.type, loc.classification].filter(Boolean).join(' · ')),
        React.createElement('div', { className: 'lpage-tags' },
          loc.quantum ? React.createElement('span', { className: 'lpage-tag' }, 'Quantum') : null,
          loc.hotspot ? React.createElement('span', { className: 'lpage-tag' }, 'Hotspot') : null,
          loc.tag ? React.createElement('span', { className: 'lpage-tag' }, loc.tag) : null
        ),
        React.createElement('div', { className: 'lpage-kpis' },
          React.createElement('div', { className: 'lpage-kpi' },
            React.createElement('div', { className: 'l' }, 'Online now'),
            React.createElement('div', { className: 'v' }, String(online.length))),
          React.createElement('div', { className: 'lpage-kpi' },
            React.createElement('div', { className: 'l' }, 'Players seen'),
            React.createElement('div', { className: 'v' }, String(reports.playerCount || 0))),
          React.createElement('div', { className: 'lpage-kpi' },
            React.createElement('div', { className: 'l' }, 'Local visits'),
            React.createElement('div', { className: 'v' }, String(reports.visitCount || 0)))
        )
      ),
      React.createElement('section', { className: 'lpage-panel' },
        React.createElement('h2', null, 'On the map'),
        React.createElement('div', { className: 'body' },
          React.createElement(StarMap, {
            system,
            includeHotspots: true,
            selectedSlug: loc.slug,
            destinations: [{ n: loc.slug, c: Math.max(1, reports.visitCount || 1) }],
            height: 240,
            onSelect: (pt) => {
              const href = locationHref(pt.slug || pt.token || pt.name);
              if (href && typeof window !== 'undefined') window.location.href = href;
            }
          })
        )
      ),
      React.createElement('section', { className: 'lpage-panel' },
        React.createElement('h2', null, 'Online now'),
        React.createElement('div', { className: 'body' },
          online.length
            ? online.map((row, i) => this.renderPlayer(row, i))
            : React.createElement('div', { className: 'lpage-hint' },
              'Nobody on this node’s presence roster is here right now.')
        )
      ),
      React.createElement('section', { className: 'lpage-panel' },
        React.createElement('h2', null, 'Recent players'),
        React.createElement('div', { className: 'body' },
          recent.length
            ? recent.map((row, i) => this.renderPlayer(row, i))
            : React.createElement('div', { className: 'lpage-hint' },
              'No local reports yet. Quantum travel here, or wait for peers who share presence — this node keeps a compact log as data arrives.')
        )
      )
    );
  }
}

LocationPage.CSS = CSS;
LocationPage.locationHref = locationHref;
LocationPage.slugFromLocation = function () {
  const m = String((typeof window !== 'undefined' && window.location.pathname) || '')
    .match(/^\/locations\/([^/]+)/);
  if (!m) return null;
  const slug = decodeURIComponent(m[1]);
  if (slug === 'map' || slug === 'reports') return null;
  return slug;
};

module.exports = LocationPage;
