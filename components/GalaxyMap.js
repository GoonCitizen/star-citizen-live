'use strict';

/**
 * 2D galaxy overview — systems + jump edges from GET /locations/map?view=galaxy.
 */

const React = require('react');
const proceduralStarfield = require('../functions/proceduralStarfield');

const BASE = '/services/star-citizen';
const MAP_ASSET = '/assets/map';

const CSS = `
  .gmap{display:grid;gap:10px}
  .gmap-canvas{position:relative;width:100%;background:#0b0e14;border:1px solid var(--line);
    border-radius:10px;overflow:hidden}
  .gmap-hit{cursor:pointer}
  .gmap-empty{color:var(--muted);font-size:12.5px;padding:8px 0}
  .gmap-legend{display:flex;flex-wrap:wrap;gap:10px;font-size:11px;color:var(--muted)}
`;

function toPct (n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return 50;
  return Math.min(96, Math.max(4, v * 100));
}

class GalaxyMap extends React.Component {
  constructor (props) {
    super(props);
    this.state = {
      layout: null,
      error: null,
      proceduralUrl: proceduralStarfield.buildStarfieldDataUrl({
        seed: 'galaxy',
        tint: '#080a12',
        nebula: '#1a2040',
        width: 480,
        height: 480,
        stars: 220
      }),
      tileOk: false
    };
  }

  componentDidMount () {
    this.fetchLayout();
    const img = typeof Image !== 'undefined' ? new Image() : null;
    if (img) {
      img.onload = () => this.setState({ tileOk: true });
      img.onerror = () => this.setState({ tileOk: false });
      img.src = MAP_ASSET + '/tiles/starfield-02.png';
    }
  }

  async fetchLayout () {
    try {
      const res = await fetch(`${BASE}/locations/map?view=galaxy`, { cache: 'no-store' });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error || res.statusText);
      this.setState({ layout: j.data || j, error: null });
    } catch (e) {
      this.setState({ error: e.message || String(e), layout: null });
    }
  }

  onSystemClick (sys) {
    if (typeof this.props.onSelectSystem !== 'function' || !sys) return;
    this.props.onSelectSystem({
      code: sys.code,
      name: sys.name || sys.code
    });
  }

  render () {
    const layout = this.state.layout;
    const h = Number(this.props.height) || 360;
    if (!layout) {
      return React.createElement('div', { className: 'gmap' },
        React.createElement('div', { className: 'gmap-empty' },
          this.state.error || 'Loading galaxy…'));
    }
    const systems = layout.systems || [];
    const edges = layout.edges || [];
    const selected = String(this.props.selectedSystem || '').toUpperCase();

    return React.createElement('div', { className: 'gmap' },
      React.createElement('svg', {
        className: 'gmap-canvas',
        viewBox: '0 0 100 100',
        preserveAspectRatio: 'xMidYMid meet',
        style: { height: h, display: 'block' },
        role: 'img',
        'aria-label': 'Galaxy map'
      },
      React.createElement('rect', { x: 0, y: 0, width: 100, height: 100, fill: '#080a12' }),
      this.state.proceduralUrl
        ? React.createElement('image', {
          href: this.state.proceduralUrl,
          x: 0,
          y: 0,
          width: 100,
          height: 100,
          preserveAspectRatio: 'xMidYMid slice',
          opacity: 0.9
        })
        : null,
      this.state.tileOk
        ? React.createElement('image', {
          href: MAP_ASSET + '/tiles/starfield-02.png',
          x: 0,
          y: 0,
          width: 100,
          height: 100,
          preserveAspectRatio: 'xMidYMid slice',
          opacity: 0.4
        })
        : null,
      edges.map((e, i) => React.createElement('line', {
        key: 'e-' + i,
        x1: toPct(e.x1),
        y1: toPct(e.y1),
        x2: toPct(e.x2),
        y2: toPct(e.y2),
        stroke: 'rgba(120,160,220,0.45)',
        strokeWidth: 0.35
      }, React.createElement('title', null, e.label || (e.from + ' – ' + e.to)))),
      systems.map((s) => {
        const sel = String(s.code || '').toUpperCase() === selected;
        return React.createElement('g', {
          key: s.code,
          className: 'gmap-hit',
          onClick: (ev) => {
            if (ev && ev.stopPropagation) ev.stopPropagation();
            this.onSystemClick(s);
          }
        },
        React.createElement('circle', {
          cx: toPct(s.nx),
          cy: toPct(s.ny),
          r: sel ? 2.8 : 2.2,
          fill: sel ? '#f5d76e' : '#6ea8fe',
          stroke: sel ? '#fff' : 'rgba(255,255,255,0.35)',
          strokeWidth: sel ? 0.5 : 0.25
        }, React.createElement('title', null, s.name || s.code)),
        React.createElement('text', {
          x: toPct(s.nx),
          y: toPct(s.ny) + 5.2,
          fill: '#c8d0e0',
          fontSize: 2.6,
          textAnchor: 'middle',
          style: { pointerEvents: 'none' }
        }, s.name || s.code));
      })
      ),
      this.props.embedded
        ? null
        : React.createElement('div', { className: 'gmap-legend' },
          'Jump lines connect systems named on JUMPPOINT bodies. Click a system to open its map.')
    );
  }
}

GalaxyMap.CSS = CSS;

module.exports = GalaxyMap;
