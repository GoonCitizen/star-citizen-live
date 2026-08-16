'use strict';

/**
 * Wiki-backed system map (Stanton / Pyro / Nyx).
 * Plots catalog bodies + optional QT visit hotspots, mining hotspots, and members.
 * Fetches `GET /locations/map` — does not load the catalog via fs in the browser.
 */

const React = require('react');

const BASE = '/services/star-citizen';

const CSS = `
  .smap{display:grid;gap:10px}
  .smap-tools{display:flex;flex-wrap:wrap;gap:8px;align-items:center}
  .smap-tools label{font-size:12px;color:var(--muted);display:flex;gap:6px;align-items:center}
  .smap-tools select{background:var(--bg);border:1px solid var(--line);color:var(--text);
    border-radius:7px;padding:5px 8px;font-size:12px}
  .smap-canvas{position:relative;width:100%;background:#0b0e14;border:1px solid var(--line);
    border-radius:10px;overflow:hidden}
  .smap-legend{display:flex;flex-wrap:wrap;gap:10px;font-size:11px;color:var(--muted)}
  .smap-legend span{display:inline-flex;align-items:center;gap:5px}
  .smap-swatch{width:8px;height:8px;border-radius:50%;display:inline-block}
  .smap-list{display:grid;gap:0}
  .smap-row{display:flex;gap:10px;font-size:12px;padding:3px 0;border-bottom:1px solid var(--line);
    width:100%;background:none;border-left:0;border-right:0;border-top:0;color:inherit;font:inherit;text-align:left}
  .smap-row.hit{cursor:pointer}
  .smap-row.hit:hover{color:var(--accent)}
  .smap-row .n{flex:1;min-width:0}
  .smap-row .sub{color:var(--muted);font-size:11px}
  .smap-row .chip{font-size:11px;font-weight:700;padding:1px 7px;border-radius:5px;
    background:rgba(63,185,80,.15);color:var(--good)}
  .smap-empty{color:var(--muted);font-size:12.5px;padding:8px 0}
  .smap-hit{cursor:pointer}
`;

function slugish (value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function tokenKeys (token) {
  const raw = String(token || '').trim();
  if (!raw) return [];
  const out = new Set();
  out.add(raw.toLowerCase());
  out.add(slugish(raw));
  const ext = raw.match(/^rs_ext_([a-z0-9]+)-leo(\d+)$/i) ||
    raw.match(/^rs_ext_([a-z0-9]+)_leo(\d+)$/i);
  if (ext) {
    const code = ext[1].toLowerCase();
    const n = ext[2];
    out.add(`${code}-l${n}`);
    out.add(`${code}_l${n}`);
    out.add(`${code} l${n}`);
  }
  return [...out];
}

function pointKeys (pt) {
  const out = new Set();
  const add = (v) => {
    if (v) {
      out.add(String(v).toLowerCase());
      out.add(slugish(v));
    }
  };
  add(pt.slug);
  add(pt.name);
  add(pt.code);
  add(pt.token);
  add(pt.label);
  (pt.aliases || []).forEach(add);
  return out;
}

function matchPoint (lookup, token) {
  const keys = tokenKeys(token);
  if (!keys.length) return null;
  for (const pt of lookup || []) {
    const have = pointKeys(pt);
    for (const k of keys) {
      if (have.has(k)) return pt;
    }
  }
  return null;
}

function lookupFromLayout (layout) {
  if (!layout) return [];
  return []
    .concat(layout.locations || [])
    .concat(layout.hotspots || [])
    .concat(layout.bodies || [])
    .concat(layout.destinations || [])
    .concat(layout.members || []);
}

function toPct (n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return 50;
  return Math.min(96, Math.max(4, v * 100));
}

class StarMap extends React.Component {
  constructor (props) {
    super(props);
    this.state = {
      layout: null,
      error: null,
      system: props.system || 'STANTON',
      includeHotspots: props.includeHotspots !== false
    };
  }

  componentDidMount () {
    this.fetchLayout();
  }

  componentDidUpdate (prev) {
    if (prev.system !== this.props.system && this.props.system) {
      this.setState({ system: this.props.system }, () => this.fetchLayout());
      return;
    }
    if (prev.includeHotspots !== this.props.includeHotspots &&
        this.props.includeHotspots != null) {
      this.setState({ includeHotspots: this.props.includeHotspots !== false }, () => this.fetchLayout());
    }
  }

  async fetchLayout () {
    const system = this.state.system || 'STANTON';
    const hotspots = this.state.includeHotspots !== false;
    try {
      const params = new URLSearchParams();
      params.set('system', system);
      params.set('hotspots', hotspots ? '1' : '0');
      const res = await fetch(`${BASE}/locations/map?${params}`, { cache: 'no-store' });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error || res.statusText);
      this.setState({ layout: j.data || j, error: null });
    } catch (e) {
      this.setState({ error: e.message || String(e), layout: null });
    }
  }

  emitSelect (pt) {
    if (typeof this.props.onSelect !== 'function' || !pt) return;
    const slug = pt.slug || pt.token || pt.name || pt.code || null;
    if (!slug) return;
    this.props.onSelect({
      slug: pt.slug || null,
      name: pt.name || pt.label || pt.token || pt.code || slug,
      token: pt.token || pt.slug || pt.code || slug,
      kind: pt.kind || 'location'
    });
  }

  isSelected (pt) {
    const want = String(this.props.selectedSlug || '').trim().toLowerCase();
    if (!want || !pt) return false;
    const keys = [pt.slug, pt.token, pt.name, pt.code, pt.label]
      .filter(Boolean)
      .map((v) => String(v).toLowerCase());
    return keys.includes(want);
  }

  circle (key, pt, style) {
    const selectable = typeof this.props.onSelect === 'function' &&
      (pt.slug || pt.token || pt.name || pt.code);
    const selected = this.isSelected(pt);
    const props = {
      key,
      cx: toPct(pt.nx),
      cy: toPct(pt.ny),
      r: style.r,
      fill: style.fill,
      opacity: style.opacity,
      className: selectable ? 'smap-hit' : undefined,
      stroke: selected ? '#fff' : style.stroke,
      strokeWidth: selected ? 0.65 : (style.strokeWidth || 0)
    };
    if (selectable) {
      props.onClick = (e) => {
        if (e && e.stopPropagation) e.stopPropagation();
        this.emitSelect(Object.assign({ kind: style.kind }, pt));
      };
    }
    return React.createElement('circle', props,
      React.createElement('title', null, style.title));
  }

  renderSvg () {
    const layout = this.state.layout;
    if (!layout) {
      return React.createElement('div', { className: 'smap-empty' },
        this.state.error || 'Loading map…');
    }
    const bodies = layout.bodies || [];
    const locations = layout.locations || [];
    const hotspots = this.state.includeHotspots !== false ? (layout.hotspots || []) : [];
    const lookup = lookupFromLayout(layout);
    const destMarks = [];
    for (const row of this.props.destinations || []) {
      const token = row.n || row.name || row.slug;
      const hit = matchPoint(lookup, token);
      if (!hit) continue;
      destMarks.push({
        nx: hit.nx,
        ny: hit.ny,
        slug: hit.slug || null,
        label: hit.name || token,
        name: hit.name || token,
        count: Number(row.c != null ? row.c : row.count) || 1,
        token
      });
    }
    const memberMarks = [];
    for (const m of this.props.members || []) {
      const token = (m.location && (m.location.slug || m.location.name || m.location.token)) ||
        m.slug || m.locationSlug;
      const hit = matchPoint(lookup, token);
      if (!hit) continue;
      memberMarks.push({
        nx: hit.nx,
        ny: hit.ny,
        slug: hit.slug || null,
        label: m.label || m.nickname || hit.name,
        name: hit.name,
        ship: m.ship && (m.ship.name || m.ship.slug)
      });
    }
    const h = Number(this.props.height) || 280;
    return React.createElement('svg', {
      className: 'smap-canvas',
      viewBox: '0 0 100 100',
      preserveAspectRatio: 'xMidYMid meet',
      style: { height: h, display: 'block' },
      role: 'img',
      'aria-label': (layout.system && layout.system.name) || 'Star map'
    },
    React.createElement('rect', { x: 0, y: 0, width: 100, height: 100, fill: '#0b0e14' }),
    bodies.map((b, i) => this.circle('b-' + (b.code || b.name || i), b, {
      r: Math.max(1.2, Math.min(4, (b.r || 3) / 2.2)),
      fill: b.type === 'STAR' ? '#f5d76e' : (b.type === 'PLANET' ? '#6ea8fe' : '#9aa3b2'),
      opacity: 0.9,
      kind: 'body',
      title: b.name || b.code
    })),
    locations.map((p, i) => this.circle('l-' + (p.slug || i), p, {
      r: 0.9,
      fill: '#58a6ff',
      opacity: 0.55,
      kind: 'location',
      title: p.name || p.slug
    })),
    hotspots.map((p, i) => this.circle('h-' + (p.slug || i), p, {
      r: 1.15,
      fill: '#d29922',
      opacity: 0.85,
      kind: 'hotspot',
      title: (p.name || p.slug) + ' (hotspot)'
    })),
    destMarks.map((p, i) => this.circle('d-' + (p.token || i), Object.assign({
      slug: p.slug,
      name: p.label
    }, p), {
      r: Math.min(3.2, 1.3 + Math.log2(p.count + 1)),
      fill: '#3fb950',
      stroke: '#1a7f37',
      strokeWidth: 0.3,
      kind: 'destination',
      title: p.label + ' · ' + p.count + ' QT'
    })),
    memberMarks.map((p, i) => this.circle('m-' + i, p, {
      r: 1.8,
      fill: '#f78166',
      stroke: '#fff',
      strokeWidth: 0.25,
      kind: 'member',
      title: [p.label, p.ship].filter(Boolean).join(' · ')
    }))
    );
  }

  renderList () {
    if (!this.props.showList) return null;
    const rows = this.props.destinations || [];
    const lookup = lookupFromLayout(this.state.layout);
    if (!rows.length) {
      return React.createElement('div', { className: 'smap-empty' },
        this.props.emptyList || 'no QT hops in the filtered period');
    }
    return React.createElement('div', { className: 'smap-list' },
      rows.map((r) => {
        const hit = matchPoint(lookup, r.n || r.name || r.slug);
        const name = (hit && hit.name) || r.n;
        const token = r.n;
        const selectable = typeof this.props.onSelect === 'function';
        const rowProps = {
          className: 'smap-row' + (selectable ? ' hit' : ''),
          key: token
        };
        if (selectable) {
          rowProps.type = 'button';
          rowProps.onClick = () => this.emitSelect({
            slug: (hit && hit.slug) || null,
            name,
            token,
            kind: 'destination'
          });
        }
        return React.createElement(selectable ? 'button' : 'div', rowProps,
          React.createElement('span', { className: 'n' },
            name,
            hit && token && hit.name && hit.name !== token
              ? React.createElement('div', { className: 'sub' }, token)
              : null
          ),
          React.createElement('span', { className: 'chip' }, r.c)
        );
      })
    );
  }

  render () {
    const systems = (this.state.layout && this.state.layout.systems) || [
      { code: 'STANTON', name: 'Stanton' },
      { code: 'PYRO', name: 'Pyro' },
      { code: 'NYX', name: 'Nyx' }
    ];
    return React.createElement('div', { className: 'smap' },
      React.createElement('div', { className: 'smap-tools' },
        React.createElement('select', {
          value: this.state.system,
          onChange: (e) => this.setState({ system: e.target.value }, () => this.fetchLayout())
        }, systems.map((s) => React.createElement('option', {
          key: s.code || s.name,
          value: s.code || s.name
        }, s.name || s.code))),
        React.createElement('label', null,
          React.createElement('input', {
            type: 'checkbox',
            checked: this.state.includeHotspots !== false,
            onChange: (e) => this.setState({ includeHotspots: e.target.checked }, () => this.fetchLayout())
          }),
          'Hotspots'
        )
      ),
      this.renderSvg(),
      React.createElement('div', { className: 'smap-legend' },
        React.createElement('span', null, React.createElement('i', { className: 'smap-swatch', style: { background: '#f5d76e' } }), 'star / planet'),
        React.createElement('span', null, React.createElement('i', { className: 'smap-swatch', style: { background: '#3fb950' } }), 'QT visits'),
        React.createElement('span', null, React.createElement('i', { className: 'smap-swatch', style: { background: '#d29922' } }), 'wiki hotspots'),
        this.props.members && this.props.members.length
          ? React.createElement('span', null, React.createElement('i', { className: 'smap-swatch', style: { background: '#f78166' } }), 'online members')
          : null
      ),
      this.renderList()
    );
  }
}

StarMap.CSS = CSS;
StarMap.matchPoint = matchPoint;
StarMap.lookupFromLayout = lookupFromLayout;

module.exports = StarMap;
