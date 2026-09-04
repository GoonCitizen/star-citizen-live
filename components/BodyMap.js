'use strict';

/**
 * Body-scale map: per-body equirectangular terrain + POI / member markers.
 * Default is a flat lon/lat map (starmap.space Eureka 2D style) so terrain
 * context lines up with real coordinates. Optional globe disk for overview.
 */

const React = require('react');

const BASE = '/services/star-citizen';
const MAP_ASSET = '/assets/map';

const CSS = `
  .bmap{display:grid;gap:10px}
  .bmap-canvas{position:relative;width:100%;background:#05070c;border:1px solid var(--line);
    border-radius:10px;overflow:hidden;touch-action:none;cursor:grab}
  .bmap-canvas.is-dragging{cursor:grabbing}
  .bmap-hit{cursor:pointer}
  .bmap-empty{color:var(--muted);font-size:12.5px;padding:8px 0}
  .bmap-legend{display:flex;flex-wrap:wrap;gap:10px;font-size:11px;color:var(--muted)}
  .bmap-meta{font-size:12px;color:var(--muted)}
  .bmap-modes{display:inline-flex;gap:6px}
  .bmap-modes button{font:inherit;font-size:11px;padding:3px 8px;border-radius:6px;
    border:1px solid var(--line);background:var(--bg);color:var(--muted);cursor:pointer}
  .bmap-modes button.on{border-color:var(--accent);color:var(--text);background:rgba(88,166,255,.12)}
`;

function toPct (n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return 50;
  return Math.min(96, Math.max(4, v * 100));
}

function wrapLon (lon) {
  let v = Number(lon) || 0;
  while (v > 180) v -= 360;
  while (v <= -180) v += 360;
  return v;
}

/** Equirect: lon −180…180 → x 0…1, lat −90…90 → y 1…0 */
function projectEquirect (lat, lon, viewLongitude) {
  const lonV = wrapLon((Number(lon) || 0) - (Number(viewLongitude) || 0));
  const latV = Math.max(-90, Math.min(90, Number(lat) || 0));
  return {
    nx: (lonV + 180) / 360,
    ny: (90 - latV) / 180,
    visible: true,
    farSide: false
  };
}

function projectGlobe (lat, lon, viewLongitude) {
  const latR = (Number(lat) || 0) * Math.PI / 180;
  const lonR = ((Number(lon) || 0) - (Number(viewLongitude) || 0)) * Math.PI / 180;
  const x = Math.cos(latR) * Math.sin(lonR);
  const y = Math.sin(latR);
  const z = Math.cos(latR) * Math.cos(lonR);
  const visible = z >= -0.05;
  const scale = 0.42;
  let nx = 0.5 + x * scale;
  let ny = 0.5 - y * scale;
  let farSide = false;
  if (!visible) {
    farSide = true;
    const lon2 = ((Number(lon) || 0) + 180);
    const lonR2 = (lon2 - (Number(viewLongitude) || 0)) * Math.PI / 180;
    nx = 0.5 + Math.cos(latR) * Math.sin(lonR2) * scale;
    ny = 0.5 - y * scale;
  }
  return { nx, ny, visible, farSide };
}

class BodyMap extends React.Component {
  constructor (props) {
    super(props);
    this.state = {
      layout: null,
      error: null,
      surfaceOk: false,
      viewLongitude: 0,
      dragging: false,
      mode: props.mode || 'map'
    };
    this._drag = null;
    this._onPointerMove = this._onPointerMove.bind(this);
    this._onPointerUp = this._onPointerUp.bind(this);
  }

  componentDidMount () {
    this.fetchLayout();
  }

  componentDidUpdate (prev) {
    if (prev.system !== this.props.system || prev.body !== this.props.body) {
      this.setState({ viewLongitude: 0, surfaceOk: false });
      this.fetchLayout();
    }
  }

  componentWillUnmount () {
    this._unbindDrag();
  }

  _unbindDrag () {
    if (typeof window === 'undefined') return;
    window.removeEventListener('pointermove', this._onPointerMove);
    window.removeEventListener('pointerup', this._onPointerUp);
    window.removeEventListener('pointercancel', this._onPointerUp);
  }

  _onPointerDown (ev) {
    if (!ev || ev.button != null && ev.button !== 0) return;
    this._drag = {
      x: ev.clientX,
      lon: this.state.viewLongitude,
      moved: false
    };
    this.setState({ dragging: true });
    if (typeof window !== 'undefined') {
      window.addEventListener('pointermove', this._onPointerMove);
      window.addEventListener('pointerup', this._onPointerUp);
      window.addEventListener('pointercancel', this._onPointerUp);
    }
  }

  _onPointerMove (ev) {
    if (!this._drag) return;
    const dx = ev.clientX - this._drag.x;
    if (Math.abs(dx) > 3) this._drag.moved = true;
    const rate = this.state.mode === 'map' ? 0.55 : 0.45;
    let lon = this._drag.lon - dx * rate;
    lon = wrapLon(lon);
    this.setState({ viewLongitude: lon });
  }

  _onPointerUp () {
    this._unbindDrag();
    this.setState({ dragging: false });
    const drag = this._drag;
    setTimeout(() => {
      if (this._drag === drag) this._drag = null;
    }, 0);
  }

  async fetchLayout () {
    const system = this.props.system || 'STANTON';
    const body = this.props.body;
    if (!body) {
      this.setState({ layout: null, error: 'No body selected' });
      return;
    }
    try {
      const params = new URLSearchParams();
      params.set('view', 'body');
      params.set('system', system);
      params.set('body', body);
      const res = await fetch(`${BASE}/locations/map?${params}`, { cache: 'no-store' });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error || res.statusText);
      const layout = j.data || j;
      this.setState({ layout, error: null, surfaceOk: false });
      const tile = layout.surfaceTile
        ? MAP_ASSET + '/' + String(layout.surfaceTile).replace(/^\/+/, '')
        : null;
      if (tile && typeof Image !== 'undefined') {
        const img = new Image();
        img.onload = () => this.setState({ surfaceOk: true });
        img.onerror = () => this.setState({ surfaceOk: false });
        img.src = tile;
      }
    } catch (e) {
      this.setState({ error: e.message || String(e), layout: null });
    }
  }

  emitPoi (pt) {
    if (this._drag && this._drag.moved) return;
    if (typeof this.props.onSelectPoi === 'function') this.props.onSelectPoi(pt);
  }

  emitSatellite (sat) {
    if (this._drag && this._drag.moved) return;
    if (typeof this.props.onSelectBody === 'function') {
      this.props.onSelectBody({
        code: sat.code,
        name: sat.name,
        type: sat.type || 'SATELLITE'
      });
    }
  }

  projectPoint (p) {
    const viewLongitude = this.state.viewLongitude;
    if (this.state.mode === 'globe') return projectGlobe(p.latitude, p.longitude, viewLongitude);
    return projectEquirect(p.latitude, p.longitude, viewLongitude);
  }

  renderMapSvg () {
    const layout = this.state.layout;
    const body = layout.body;
    const h = Number(this.props.height) || 360;
    const viewLongitude = this.state.viewLongitude;
    const tile = layout.surfaceTile
      ? MAP_ASSET + '/' + String(layout.surfaceTile).replace(/^\/+/, '')
      : null;
    const fillFallback = body.type === 'STAR'
      ? '#f5d76e'
      : (layout.surfaceStyle === 'ice' ? '#a8c4d8'
        : layout.surfaceStyle === 'gas' ? '#c87840'
          : layout.surfaceStyle === 'volcanic' ? '#5a2018'
            : layout.surfaceStyle === 'industrial' ? '#6a7080'
              : '#6a4a32');

    const pois = (layout.pois || []).map((p) => {
      const proj = this.projectPoint(p);
      return Object.assign({}, p, proj);
    }).filter((p) => this.state.mode !== 'globe' || !p.farSide);

    const members = (this.props.members || []).map((m, i) => {
      const lat = Number(m.latitude != null ? m.latitude : (m.location && m.location.latitude));
      const lon = Number(m.longitude != null ? m.longitude : (m.location && m.location.longitude));
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
      const proj = this.projectPoint({ latitude: lat, longitude: lon });
      if (this.state.mode === 'globe' && proj.farSide) return null;
      return {
        key: 'm-' + (m.id || m.label || i),
        label: m.label || m.nickname || m.name || 'member',
        nx: proj.nx,
        ny: proj.ny
      };
    }).filter(Boolean);

    if (this.state.mode === 'globe') {
      return this.renderGlobeSvg({
        h, tile, fillFallback, body, pois, members, viewLongitude, layout
      });
    }

    // Flat equirect: viewBox 0..360 x 0..180 (lon×lat degrees space)
    const shift = ((viewLongitude % 360) + 360) % 360;
    return React.createElement('svg', {
      className: 'bmap-canvas' + (this.state.dragging ? ' is-dragging' : ''),
      viewBox: '0 0 360 180',
      preserveAspectRatio: 'xMidYMid meet',
      style: { height: h, display: 'block' },
      role: 'img',
      'aria-label': (body.name || 'Body') + ' terrain map',
      onPointerDown: (ev) => this._onPointerDown(ev)
    },
    React.createElement('rect', { x: 0, y: 0, width: 360, height: 180, fill: '#05070c' }),
    React.createElement('defs', null,
      React.createElement('clipPath', { id: 'bmap-eq' },
        React.createElement('rect', { x: 0, y: 0, width: 360, height: 180 })
      )
    ),
    React.createElement('g', { clipPath: 'url(#bmap-eq)' },
      React.createElement('rect', { x: 0, y: 0, width: 360, height: 180, fill: fillFallback }),
      tile && this.state.surfaceOk
        ? React.createElement('g', {
          transform: 'translate(' + (-shift) + ' 0)'
        },
        React.createElement('image', {
          href: tile,
          x: 0,
          y: 0,
          width: 360,
          height: 180,
          preserveAspectRatio: 'none',
          opacity: 0.98
        }),
        React.createElement('image', {
          href: tile,
          x: 360,
          y: 0,
          width: 360,
          height: 180,
          preserveAspectRatio: 'none',
          opacity: 0.98
        })
        )
        : null,
      // graticule
      [-120, -60, 0, 60, 120].map((lon) => React.createElement('line', {
        key: 'v' + lon,
        x1: lon + 180,
        x2: lon + 180,
        y1: 0,
        y2: 180,
        stroke: 'rgba(255,255,255,0.08)',
        strokeWidth: 0.4
      })),
      [-60, -30, 0, 30, 60].map((lat) => React.createElement('line', {
        key: 'h' + lat,
        x1: 0,
        x2: 360,
        y1: 90 - lat,
        y2: 90 - lat,
        stroke: 'rgba(255,255,255,0.08)',
        strokeWidth: 0.4
      }))
    ),
    members.map((m) => React.createElement('g', {
      key: m.key,
      className: 'bmap-hit'
    },
    React.createElement('circle', {
      cx: m.nx * 360,
      cy: m.ny * 180,
      r: 2.2,
      fill: '#f78166',
      stroke: '#fff',
      strokeWidth: 0.35
    }, React.createElement('title', null, m.label + ' (fleet)'))
    )),
    pois.map((p, i) => React.createElement('g', {
      key: 'poi-' + (p.slug || i),
      className: 'bmap-hit',
      onClick: (ev) => {
        if (ev && ev.stopPropagation) ev.stopPropagation();
        this.emitPoi(p);
      }
    },
    React.createElement('circle', {
      cx: p.nx * 360,
      cy: p.ny * 180,
      r: p.hotspot ? 2.0 : (p.quantum ? 1.7 : 1.4),
      fill: p.hotspot ? '#d29922' : (p.quantum ? '#58a6ff' : '#3fb950'),
      stroke: '#0b0e14',
      strokeWidth: 0.3
    }, React.createElement('title', null,
      (p.name || p.slug) + ' · ' + (p.type || 'POI') +
        (Number.isFinite(p.latitude)
          ? ' · ' + p.latitude.toFixed(2) + '°, ' + p.longitude.toFixed(2) + '°'
          : ''))
    )
    )
    )
    );
  }

  renderGlobeSvg ({ h, tile, fillFallback, body, pois, members, viewLongitude, layout }) {
    const satellites = layout.satellites || [];
    return React.createElement('svg', {
      className: 'bmap-canvas' + (this.state.dragging ? ' is-dragging' : ''),
      viewBox: '0 0 100 100',
      preserveAspectRatio: 'xMidYMid meet',
      style: { height: h, display: 'block' },
      role: 'img',
      'aria-label': (body.name || 'Body') + ' globe',
      onPointerDown: (ev) => this._onPointerDown(ev)
    },
    React.createElement('rect', { x: 0, y: 0, width: 100, height: 100, fill: '#05070c' }),
    React.createElement('defs', null,
      React.createElement('clipPath', { id: 'bmap-disk' },
        React.createElement('circle', { cx: 50, cy: 50, r: 42 })
      )
    ),
    React.createElement('g', { clipPath: 'url(#bmap-disk)' },
      React.createElement('circle', { cx: 50, cy: 50, r: 42, fill: fillFallback }),
      tile && this.state.surfaceOk
        ? React.createElement('image', {
          href: tile,
          x: 8,
          y: 8,
          width: 84,
          height: 84,
          preserveAspectRatio: 'xMidYMid slice',
          opacity: 0.95,
          transform: 'rotate(' + (-viewLongitude) + ' 50 50)'
        })
        : null
    ),
    React.createElement('circle', {
      cx: 50,
      cy: 50,
      r: 42,
      fill: 'none',
      stroke: 'rgba(200,220,255,0.35)',
      strokeWidth: 0.5
    }),
    satellites.map((s, i) => React.createElement('g', {
      key: 'sat-' + (s.code || s.name || i),
      className: 'bmap-hit',
      onClick: (ev) => {
        if (ev && ev.stopPropagation) ev.stopPropagation();
        this.emitSatellite(s);
      }
    },
    React.createElement('circle', {
      cx: toPct(s.nx),
      cy: toPct(s.ny),
      r: 1.8,
      fill: '#c8d0e0',
      stroke: '#fff',
      strokeWidth: 0.25
    }, React.createElement('title', null, (s.name || s.code) + ' (moon — zoom)'))
    )),
    members.map((m) => React.createElement('circle', {
      key: m.key,
      cx: toPct(m.nx),
      cy: toPct(m.ny),
      r: 1.6,
      fill: '#f78166',
      stroke: '#fff',
      strokeWidth: 0.25
    }, React.createElement('title', null, m.label))),
    pois.map((p, i) => React.createElement('g', {
      key: 'poi-' + (p.slug || i),
      className: 'bmap-hit',
      onClick: (ev) => {
        if (ev && ev.stopPropagation) ev.stopPropagation();
        this.emitPoi(p);
      }
    },
    React.createElement('circle', {
      cx: toPct(p.nx),
      cy: toPct(p.ny),
      r: p.hotspot ? 1.35 : (p.quantum ? 1.2 : 1.0),
      fill: p.hotspot ? '#d29922' : (p.quantum ? '#58a6ff' : '#3fb950'),
      stroke: '#0b0e14',
      strokeWidth: 0.2
    }, React.createElement('title', null, p.name || p.slug))
    )
    )
    );
  }

  render () {
    const layout = this.state.layout;
    if (!layout || !layout.body) {
      return React.createElement('div', { className: 'bmap' },
        React.createElement('div', { className: 'bmap-empty' },
          this.state.error || 'Loading body…'));
    }
    const body = layout.body;
    const radiusLabel = Number.isFinite(body.radiusMeters)
      ? ' · r ' + Math.round(body.radiusMeters / 1000) + ' km'
      : '';
    const terrain = layout.terrainSlug || layout.surfaceStyle || 'terrain';

    return React.createElement('div', { className: 'bmap' },
      this.props.embedded
        ? null
        : React.createElement('div', { className: 'bmap-meta' },
          (body.name || body.code) +
            (body.designation ? ' · ' + body.designation : '') +
            ' · ' + terrain +
            radiusLabel +
            ' · ' + (layout.pois || []).length + ' POI' +
            ((layout.pois || []).length === 1 ? '' : 's') +
            ' · drag to pan longitude'
        ),
      React.createElement('div', { className: 'bmap-modes' },
        React.createElement('button', {
          type: 'button',
          className: this.state.mode === 'map' ? 'on' : '',
          onClick: () => this.setState({ mode: 'map' })
        }, 'Terrain map'),
        React.createElement('button', {
          type: 'button',
          className: this.state.mode === 'globe' ? 'on' : '',
          onClick: () => this.setState({ mode: 'globe' })
        }, 'Globe')
      ),
      this.renderMapSvg(),
      this.props.embedded
        ? null
        : React.createElement('div', { className: 'bmap-legend' },
          (layout.coordsCredit ? layout.coordsCredit + '. ' : '') +
            'Each body has its own terrain tile (procedural stand-in — not RSI). ' +
            'Green = POI · blue = QT · amber = hotspot · coral = fleet. Drag to scroll longitude.')
    );
  }
}

BodyMap.CSS = CSS;
BodyMap.projectEquirect = projectEquirect;

module.exports = BodyMap;
