'use strict';

/**
 * Wiki-backed system map (Stanton / Pyro / Nyx).
 * Plots catalog bodies + optional QT visit hotspots, mining hotspots, and members.
 * Fetches `GET /locations/map` — does not load the catalog via fs in the browser.
 */

const React = require('react');
const groupPresence = require('../functions/groupPresence');
const proceduralStarfield = require('../functions/proceduralStarfield');

const BASE = '/services/star-citizen';
const MAP_ASSET = '/assets/map';

const CSS = `
  .smap{display:grid;gap:10px}
  .smap-tools{display:flex;flex-wrap:wrap;gap:8px;align-items:center}
  .smap-tools label{font-size:12px;color:var(--muted);display:flex;gap:6px;align-items:center}
  .smap-sys-count{font-size:12px;color:var(--muted)}
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
  .smap-attr{font-size:11px;color:var(--muted);line-height:1.4}
`;

let _manifestCache = null;
let _manifestPromise = null;

function loadManifest () {
  if (_manifestCache) return Promise.resolve(_manifestCache);
  if (_manifestPromise) return _manifestPromise;
  _manifestPromise = fetch(MAP_ASSET + '/manifest.json', { cache: 'force-cache' })
    .then((res) => (res.ok ? res.json() : null))
    .then((j) => {
      _manifestCache = j || {};
      return _manifestCache;
    })
    .catch(() => {
      _manifestCache = {};
      return _manifestCache;
    });
  return _manifestPromise;
}

function assetUrl (rel) {
  if (!rel) return null;
  const s = String(rel).replace(/^\/+/, '');
  if (s.includes('..')) return null;
  return MAP_ASSET + '/' + s;
}

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
      includeHotspots: props.includeHotspots !== false,
      manifest: null,
      tileStarfieldOk: false,
      tileNebulaOk: false,
      proceduralUrl: null,
      surfaceOk: {},
      viewBox: '0 0 100 100',
      zooming: false
    };
    this._zoomTimer = null;
    this._zoomRaf = null;
  }

  componentDidMount () {
    this.refreshBackground();
    this.fetchLayout();
  }

  componentWillUnmount () {
    if (this._zoomTimer) clearTimeout(this._zoomTimer);
    if (this._zoomRaf) cancelAnimationFrame(this._zoomRaf);
  }

  componentDidUpdate (prev) {
    if (prev.system !== this.props.system && this.props.system) {
      this.setState({ system: this.props.system }, () => {
        this.refreshBackground();
        this.fetchLayout();
      });
      return;
    }
    if (this.state.system !== prev.system && !this.props.system) {
      this.refreshBackground();
    }
    if (prev.includeHotspots !== this.props.includeHotspots &&
        this.props.includeHotspots != null) {
      this.setState({ includeHotspots: this.props.includeHotspots !== false }, () => this.fetchLayout());
    }
  }

  async refreshBackground () {
    const system = this.state.system || 'STANTON';
    const manifest = await loadManifest();
    const colours = proceduralStarfield.coloursForSystem(system, manifest);
    const proceduralUrl = proceduralStarfield.buildStarfieldDataUrl({
      seed: system,
      tint: colours.tint,
      nebula: colours.nebula,
      width: 480,
      height: 480,
      stars: 180
    });
    this.setState({
      manifest,
      proceduralUrl,
      tileStarfieldOk: false,
      tileNebulaOk: false
    });
    const sf = assetUrl(colours.starfield);
    const nb = assetUrl(colours.nebulaPath);
    if (sf) {
      const img = typeof Image !== 'undefined' ? new Image() : null;
      if (img) {
        img.onload = () => this.setState({ tileStarfieldOk: true });
        img.onerror = () => this.setState({ tileStarfieldOk: false });
        img.src = sf;
      }
    }
    if (nb) {
      const img = typeof Image !== 'undefined' ? new Image() : null;
      if (img) {
        img.onload = () => this.setState({ tileNebulaOk: true });
        img.onerror = () => this.setState({ tileNebulaOk: false });
        img.src = nb;
      }
    }
  }

  backgroundLayers () {
    const system = this.state.system || 'STANTON';
    const colours = proceduralStarfield.coloursForSystem(system, this.state.manifest);
    const layers = [];
    layers.push(React.createElement('rect', {
      key: 'bg-tint',
      x: 0,
      y: 0,
      width: 100,
      height: 100,
      fill: colours.tint || '#0b0e14'
    }));
    if (this.state.proceduralUrl) {
      layers.push(React.createElement('image', {
        key: 'bg-proc',
        href: this.state.proceduralUrl,
        x: 0,
        y: 0,
        width: 100,
        height: 100,
        preserveAspectRatio: 'xMidYMid slice',
        opacity: 0.95
      }));
    }
    const sf = assetUrl(colours.starfield);
    if (sf && this.state.tileStarfieldOk) {
      layers.push(React.createElement('image', {
        key: 'bg-sf',
        href: sf,
        x: 0,
        y: 0,
        width: 100,
        height: 100,
        preserveAspectRatio: 'xMidYMid slice',
        opacity: 0.55
      }));
    }
    const nb = assetUrl(colours.nebulaPath);
    if (nb && this.state.tileNebulaOk) {
      layers.push(React.createElement('image', {
        key: 'bg-nb',
        href: nb,
        x: 0,
        y: 0,
        width: 100,
        height: 100,
        preserveAspectRatio: 'xMidYMid slice',
        opacity: 0.45
      }));
    }
    return layers;
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
      const layout = j.data || j;
      this.setState({
        layout,
        error: null,
        viewBox: '0 0 100 100',
        zooming: false,
        surfaceOk: {}
      });
      this.preloadSurfaceTiles(layout);
    } catch (e) {
      this.setState({ error: e.message || String(e), layout: null });
    }
  }

  preloadSurfaceTiles (layout) {
    if (typeof Image === 'undefined') return;
    const bodies = (layout && layout.bodies) || [];
    for (const b of bodies) {
      const tile = b.surfaceTile || null;
      const url = assetUrl(tile);
      if (!url) continue;
      const key = String(tile);
      if (this.state.surfaceOk[key]) continue;
      const img = new Image();
      img.onload = () => {
        this.setState((prev) => ({
          surfaceOk: Object.assign({}, prev.surfaceOk, { [key]: true })
        }));
      };
      img.onerror = () => {
        this.setState((prev) => ({
          surfaceOk: Object.assign({}, prev.surfaceOk, { [key]: false })
        }));
      };
      img.src = url;
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
      code: pt.code || null,
      type: pt.type || null,
      kind: pt.kind || 'location',
      surfaceStyle: pt.surfaceStyle || null,
      surfaceTile: pt.surfaceTile || null
    });
  }

  isOrbital (pt) {
    const t = String((pt && pt.type) || '').toUpperCase();
    return t === 'STAR' || t === 'PLANET' || t === 'SATELLITE' || t === 'MOON';
  }

  zoomToBodyThenSelect (pt) {
    if (!pt || this.state.zooming) return;
    const cx = toPct(pt.nx);
    const cy = toPct(pt.ny);
    const size = 28;
    const x = Math.max(0, Math.min(100 - size, cx - size / 2));
    const y = Math.max(0, Math.min(100 - size, cy - size / 2));
    const target = x + ' ' + y + ' ' + size + ' ' + size;
    const start = performance.now();
    const duration = 320;
    const from = this.state.viewBox || '0 0 100 100';
    const parseVb = (s) => String(s).trim().split(/\s+/).map(Number);
    const a = parseVb(from);
    const b = parseVb(target);
    this.setState({ zooming: true });
    const step = (now) => {
      const t = Math.min(1, (now - start) / duration);
      const e = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
      const cur = a.map((v, i) => v + (b[i] - v) * e);
      this.setState({ viewBox: cur.join(' ') });
      if (t < 1) {
        this._zoomRaf = requestAnimationFrame(step);
      } else {
        this.emitSelect(Object.assign({ kind: 'body' }, pt));
        this._zoomTimer = setTimeout(() => {
          this.setState({ viewBox: '0 0 100 100', zooming: false });
        }, 40);
      }
    };
    if (typeof requestAnimationFrame === 'function') {
      this._zoomRaf = requestAnimationFrame(step);
    } else {
      this.setState({ viewBox: target });
      this.emitSelect(Object.assign({ kind: 'body' }, pt));
      this.setState({ viewBox: '0 0 100 100', zooming: false });
    }
  }

  isSelected (pt) {
    const want = String(this.props.selectedSlug || '').trim().toLowerCase();
    if (!want || !pt) return false;
    const keys = [pt.slug, pt.token, pt.name, pt.code, pt.label]
      .filter(Boolean)
      .map((v) => String(v).toLowerCase());
    return keys.includes(want);
  }

  fillForBody (b) {
    const style = String(b.surfaceStyle || '').toLowerCase();
    if (b.type === 'STAR' || style === 'star') return '#f5d76e';
    if (style === 'ice') return '#a8c4d8';
    if (style === 'gas') return '#c87840';
    if (style === 'volcanic') return '#5a2018';
    if (style === 'industrial') return '#6a7080';
    if (style === 'arid') return '#c4a46a';
    if (String(b.type).toUpperCase() === 'PLANET') return '#6ea8fe';
    return '#9aa3b2';
  }

  bodyOrb (key, b) {
    const selectable = typeof this.props.onSelect === 'function' &&
      (b.slug || b.token || b.name || b.code);
    const selected = this.isSelected(b);
    const orbital = this.isOrbital(b);
    const r = orbital
      ? Math.max(1.6, Math.min(5.2, (b.r || 3) / 1.9))
      : Math.max(1.0, Math.min(2.4, (b.r || 3) / 2.6));
    const cx = toPct(b.nx);
    const cy = toPct(b.ny);
    const clipId = 'smap-body-' + String(key).replace(/[^a-zA-Z0-9_-]/g, '');
    const tileUrl = assetUrl(b.surfaceTile);
    const styleKey = String(b.surfaceTile || b.surfaceStyle || '');
    const textured = orbital && tileUrl && this.state.surfaceOk[styleKey];
    const onClick = selectable
      ? (e) => {
        if (e && e.stopPropagation) e.stopPropagation();
        if (orbital) this.zoomToBodyThenSelect(b);
        else this.emitSelect(Object.assign({ kind: 'body' }, b));
      }
      : undefined;

    const kids = [
      React.createElement('defs', { key: 'd' },
        React.createElement('clipPath', { id: clipId },
          React.createElement('circle', { cx, cy, r })
        )
      ),
      React.createElement('circle', {
        key: 'fill',
        cx,
        cy,
        r,
        fill: this.fillForBody(b),
        opacity: textured ? 0.35 : 0.92
      }),
      textured
        ? React.createElement('image', {
          key: 'tex',
          href: tileUrl,
          x: cx - r,
          y: cy - r,
          width: r * 2,
          height: r * 2,
          preserveAspectRatio: 'xMidYMid slice',
          clipPath: 'url(#' + clipId + ')',
          opacity: 0.95,
          style: { pointerEvents: 'none' }
        })
        : null,
      React.createElement('circle', {
        key: 'ring',
        cx,
        cy,
        r,
        fill: 'none',
        stroke: selected ? '#fff' : 'rgba(255,255,255,0.28)',
        strokeWidth: selected ? 0.55 : 0.25,
        style: { pointerEvents: 'none' }
      }, React.createElement('title', null, b.name || b.code))
    ];
    return React.createElement('g', {
      key,
      className: selectable ? 'smap-hit' : undefined,
      onClick,
      style: selectable ? { cursor: 'pointer' } : undefined
    }, kids);
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
        const payload = Object.assign({ kind: style.kind }, pt);
        if (this.isOrbital(pt) || /^(Planet|Moon|Star)$/i.test(pt.type || '')) {
          this.zoomToBodyThenSelect(Object.assign({}, pt, {
            type: /moon/i.test(pt.type || '') ? 'SATELLITE' : pt.type,
            kind: 'body'
          }));
          return;
        }
        this.emitSelect(payload);
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
      viewBox: this.state.viewBox || '0 0 100 100',
      preserveAspectRatio: 'xMidYMid meet',
      style: { height: h, display: 'block' },
      role: 'img',
      'aria-label': (layout.system && layout.system.name) || 'Star map'
    },
    this.backgroundLayers(),
    bodies.map((b, i) => this.bodyOrb('b-' + (b.code || b.name || i), b)),
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

  renderSystemCounts (systems) {
    const members = this.props.members;
    if (!members || !members.length) return null;
    const summary = groupPresence.formatSystemCounts(members, systems);
    if (!summary) return null;
    return React.createElement('span', {
      className: 'smap-sys-count',
      title: 'Online players per system'
    }, summary);
  }

  render () {
    const systems = (this.state.layout && this.state.layout.systems) || [
      { code: 'STANTON', name: 'Stanton' },
      { code: 'PYRO', name: 'Pyro' },
      { code: 'NYX', name: 'Nyx' }
    ];
    const hideTools = this.props.hideTools === true || this.props.embedded === true;
    const hideLegend = this.props.embedded === true;
    return React.createElement('div', { className: 'smap' },
      hideTools
        ? null
        : React.createElement('div', { className: 'smap-tools' },
          React.createElement('select', {
            value: this.state.system,
            onChange: (e) => {
              const system = e.target.value;
              this.setState({ system }, () => {
                this.refreshBackground();
                this.fetchLayout();
              });
              if (typeof this.props.onSystemChange === 'function') {
                this.props.onSystemChange(system);
              }
            }
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
          ),
          this.renderSystemCounts(systems)
        ),
      this.renderSvg(),
      hideLegend
        ? null
        : React.createElement('div', { className: 'smap-legend' },
          React.createElement('span', null, React.createElement('i', { className: 'smap-swatch', style: { background: '#f5d76e' } }), 'star'),
          React.createElement('span', null, React.createElement('i', { className: 'smap-swatch', style: { background: '#6ea8fe' } }), 'planet / moon (textured)'),
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
