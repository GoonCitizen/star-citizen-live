'use strict';

/**
 * One continuous map browser: universe (galaxy) → star system → planetary surface.
 * Scale lives here; GalaxyMap / StarMap / BodyMap / UniverseExplorer are layers.
 */

const React = require('react');
const GalaxyMap = require('./GalaxyMap');
const StarMap = require('./StarMap');
const BodyMap = require('./BodyMap');
const UniverseExplorer = require('./UniverseExplorer');

const CSS = `
  .umap{display:grid;gap:10px}
  .umap-bar{display:flex;flex-wrap:wrap;gap:8px;align-items:center;justify-content:space-between}
  .umap-path{display:flex;flex-wrap:wrap;gap:4px;align-items:center;font-size:12.5px;color:var(--muted);min-width:0}
  .umap-path button{font:inherit;font-size:12.5px;background:none;border:none;color:var(--accent);
    cursor:pointer;padding:0 2px}
  .umap-path button:hover{text-decoration:underline}
  .umap-path .here{color:var(--text);font-weight:600}
  .umap-path .sep{opacity:.55}
  .umap-actions{display:inline-flex;flex-wrap:wrap;gap:6px;align-items:center}
  .umap-btn{font:inherit;font-size:11.5px;padding:4px 9px;border-radius:6px;border:1px solid var(--line);
    background:var(--bg);color:var(--muted);cursor:pointer}
  .umap-btn:hover{border-color:var(--accent);color:var(--text)}
  .umap-btn.on{border-color:var(--accent);color:var(--text);background:rgba(88,166,255,.12)}
  .umap-btn:disabled{opacity:.45;cursor:default}
  .umap-stage{min-height:280px}
  .umap-hint{font-size:11.5px;color:var(--muted);line-height:1.45}
`;

function isZoomableBody (pt) {
  const t = String((pt && (pt.type || pt.kind)) || '').toUpperCase();
  return t === 'STAR' || t === 'PLANET' || t === 'SATELLITE' || t === 'MOON' || t === 'BODY';
}

function focusKey (focus) {
  if (!focus || typeof focus !== 'object') return '';
  return [focus.scale || '', focus.system || '', focus.body || '', focus.bodyName || ''].join('|');
}

class UniverseMap extends React.Component {
  constructor (props) {
    super(props);
    const focus = props.focus || {};
    this.state = {
      scale: focus.scale || props.initialScale || 'galaxy',
      system: focus.system || props.initialSystem || 'STANTON',
      body: focus.body || props.initialBody || null,
      bodyName: focus.bodyName || props.initialBodyName || null,
      renderMode: props.initialRenderMode || '2d',
      includeHotspots: true
    };
  }

  componentDidUpdate (prev) {
    const nextKey = focusKey(this.props.focus);
    const prevKey = focusKey(prev.focus);
    if (nextKey && nextKey !== prevKey) {
      const f = this.props.focus;
      this.setState({
        scale: f.scale || this.state.scale,
        system: f.system || this.state.system,
        body: f.body != null ? f.body : this.state.body,
        bodyName: f.bodyName != null ? f.bodyName : this.state.bodyName
      });
    }
  }

  emitNavigate (partial) {
    const next = Object.assign({
      scale: this.state.scale,
      system: this.state.system,
      body: this.state.body,
      bodyName: this.state.bodyName,
      renderMode: this.state.renderMode
    }, partial || {});
    if (typeof this.props.onNavigate === 'function') this.props.onNavigate(next);
  }

  goGalaxy () {
    this.setState({ scale: 'galaxy', body: null, bodyName: null }, () => this.emitNavigate());
  }

  goSystem (code) {
    const system = String(code || this.state.system || 'STANTON').toUpperCase();
    this.setState({
      scale: 'system',
      system,
      body: null,
      bodyName: null
    }, () => this.emitNavigate());
  }

  goBody (body) {
    if (!body) return;
    const name = body.name || body.code || body;
    const code = body.code || body.name || body;
    this.setState({
      scale: 'body',
      body: code,
      bodyName: name,
      system: this.state.system || 'STANTON'
    }, () => this.emitNavigate());
  }

  zoomOut () {
    if (this.state.scale === 'body') {
      this.goSystem(this.state.system);
      return;
    }
    if (this.state.scale === 'system') {
      this.goGalaxy();
    }
  }

  onSelect (pt) {
    if (!pt) return;
    if (pt.kind === 'system' || String(pt.type || '').toUpperCase() === 'SYSTEM') {
      this.goSystem(pt.code || pt.token || pt.name);
      return;
    }
    if (pt.kind === 'poi') {
      if (typeof this.props.onOpenLocation === 'function') this.props.onOpenLocation(pt);
      return;
    }
    if (isZoomableBody(pt) || pt.kind === 'body') {
      this.goBody({
        code: pt.code || pt.token || pt.name,
        name: pt.name || pt.code,
        type: pt.type
      });
      return;
    }
    if (typeof this.props.onOpenLocation === 'function') this.props.onOpenLocation(pt);
  }

  pathLabel () {
    if (this.state.scale === 'galaxy') return 'Universe';
    if (this.state.scale === 'body') return this.state.bodyName || this.state.body || 'Surface';
    return this.state.system || 'System';
  }

  renderPath () {
    const { scale, system, bodyName, body } = this.state;
    const parts = [];
    parts.push(React.createElement(scale === 'galaxy' ? 'span' : 'button',
      scale === 'galaxy'
        ? { key: 'u', className: 'here' }
        : { key: 'u', type: 'button', onClick: () => this.goGalaxy() },
      'Universe'));
    if (scale !== 'galaxy') {
      parts.push(React.createElement('span', { key: 's1', className: 'sep' }, '›'));
      parts.push(React.createElement(scale === 'system' ? 'span' : 'button',
        scale === 'system'
          ? { key: 'sys', className: 'here' }
          : { key: 'sys', type: 'button', onClick: () => this.goSystem(system) },
        system || 'System'));
    }
    if (scale === 'body') {
      parts.push(React.createElement('span', { key: 's2', className: 'sep' }, '›'));
      parts.push(React.createElement('span', {
        key: 'body',
        className: 'here'
      }, bodyName || body || 'Surface'));
    }
    return React.createElement('div', { className: 'umap-path', 'aria-label': 'Map scale' }, parts);
  }

  renderHint () {
    const { scale, renderMode } = this.state;
    if (renderMode === '3d') {
      if (scale === 'galaxy') return 'Click a system to enter it. Drag to orbit.';
      if (scale === 'body') return 'Green markers are POIs · click a moon to zoom further · Zoom out returns to the system.';
      return 'Click a star, planet, or moon to open its surface.';
    }
    if (scale === 'galaxy') return 'Click a system to zoom into its star map.';
    if (scale === 'body') return 'Click a POI for its page · click a moon to zoom · Zoom out returns to the system.';
    return 'Click a star, planet, or moon to zoom to its surface. Each body has its own terrain map for POIs and fleet positions.';
  }

  renderStage () {
    const { scale, renderMode, system, body, includeHotspots } = this.state;
    const h = Number(this.props.height) || 400;
    if (renderMode === '3d') {
      return React.createElement(UniverseExplorer, {
        system,
        body: scale === 'body' ? body : null,
        scale,
        height: h,
        onSelect: (pt) => this.onSelect(pt)
      });
    }
    if (scale === 'galaxy') {
      return React.createElement(GalaxyMap, {
        height: h,
        selectedSystem: system,
        embedded: true,
        onSelectSystem: (sys) => this.goSystem(sys.code || sys.name || 'STANTON')
      });
    }
    if (scale === 'body') {
      return React.createElement(BodyMap, {
        system,
        body,
        height: h,
        embedded: true,
        members: this.props.members || [],
        onSelectPoi: (pt) => this.onSelect(Object.assign({ kind: 'poi' }, pt)),
        onSelectBody: (b) => this.goBody(b)
      });
    }
    return React.createElement(StarMap, {
      system,
      includeHotspots,
      height: h,
      embedded: true,
      hideTools: true,
      onSystemChange: (code) => this.goSystem(code),
      onSelect: (pt) => this.onSelect(pt)
    });
  }

  render () {
    const { scale, renderMode } = this.state;
    const canZoomOut = scale === 'system' || scale === 'body';
    return React.createElement('div', { className: 'umap' },
      React.createElement('div', { className: 'umap-bar' },
        this.renderPath(),
        React.createElement('div', { className: 'umap-actions' },
          React.createElement('button', {
            type: 'button',
            className: 'umap-btn',
            disabled: !canZoomOut,
            title: scale === 'body' ? 'Back to system' : 'Back to universe',
            onClick: () => this.zoomOut()
          }, 'Zoom out'),
          React.createElement('button', {
            type: 'button',
            className: 'umap-btn' + (renderMode === '2d' ? ' on' : ''),
            onClick: () => this.setState({ renderMode: '2d' }, () => this.emitNavigate())
          }, '2D'),
          React.createElement('button', {
            type: 'button',
            className: 'umap-btn' + (renderMode === '3d' ? ' on' : ''),
            onClick: () => this.setState({ renderMode: '3d' }, () => this.emitNavigate())
          }, '3D'),
          scale === 'system' && renderMode === '2d'
            ? React.createElement('label', {
              className: 'umap-btn',
              style: { display: 'inline-flex', gap: 6, alignItems: 'center', cursor: 'pointer' }
            },
            React.createElement('input', {
              type: 'checkbox',
              checked: this.state.includeHotspots !== false,
              onChange: (e) => this.setState({ includeHotspots: e.target.checked })
            }),
            'Hotspots')
            : null
        )
      ),
      React.createElement('div', { className: 'umap-stage' }, this.renderStage()),
      React.createElement('div', { className: 'umap-hint' },
        this.pathLabel() + ' · ' + this.renderHint())
    );
  }
}

UniverseMap.CSS = CSS;
UniverseMap.isZoomableBody = isZoomableBody;

module.exports = UniverseMap;
