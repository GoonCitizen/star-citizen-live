'use strict';

/**
 * Lazy-loaded Three.js explorer (galaxy / system / body).
 * Main SPA stays free of three — loads /assets/scripts/universe-explorer.js on demand.
 */

const React = require('react');

const BASE = '/services/star-citizen';
const SCRIPT_SRC = '/assets/scripts/universe-explorer.js';

const CSS = `
  .uex{display:grid;gap:8px}
  .uex-wrap{position:relative;width:100%;background:#05070c;border:1px solid var(--line);
    border-radius:10px;overflow:hidden;min-height:280px}
  .uex-wrap canvas{display:block;width:100%;height:100%}
  .uex-status{font-size:12px;color:var(--muted);padding:4px 2px}
  .uex-err{color:var(--kill);font-size:13px}
  .uex-hint{font-size:11px;color:var(--muted)}
`;

let _scriptPromise = null;

function loadExplorerScript () {
  if (typeof window === 'undefined') {
    return Promise.reject(new Error('no window'));
  }
  if (window.GoonUniverseExplorer && typeof window.GoonUniverseExplorer.mount === 'function') {
    return Promise.resolve(window.GoonUniverseExplorer);
  }
  if (_scriptPromise) return _scriptPromise;
  _scriptPromise = new Promise((resolve, reject) => {
    const existing = document.querySelector('script[data-goon-universe-explorer]');
    if (existing) {
      existing.addEventListener('load', () => {
        if (window.GoonUniverseExplorer) resolve(window.GoonUniverseExplorer);
        else reject(new Error('explorer script missing export'));
      });
      existing.addEventListener('error', () => reject(new Error('explorer script failed')));
      return;
    }
    const el = document.createElement('script');
    el.src = SCRIPT_SRC;
    el.async = true;
    el.dataset.goonUniverseExplorer = '1';
    el.onload = () => {
      if (window.GoonUniverseExplorer) resolve(window.GoonUniverseExplorer);
      else reject(new Error('explorer script missing export'));
    };
    el.onerror = () => reject(new Error('failed to load universe explorer'));
    document.head.appendChild(el);
  });
  return _scriptPromise;
}

class UniverseExplorer extends React.Component {
  constructor (props) {
    super(props);
    this.state = {
      status: 'idle',
      error: null
    };
    this._wrap = null;
    this._handle = null;
  }

  componentDidMount () {
    this.mountExplorer();
  }

  componentDidUpdate (prev) {
    if (!this._handle || !this._handle.setScale) return;
    const changed =
      prev.system !== this.props.system ||
      prev.body !== this.props.body ||
      prev.scale !== this.props.scale;
    if (!changed) return;
    this._handle.setScale({
      scale: this.props.scale || (this.props.body ? 'body' : 'system'),
      system: this.props.system || 'STANTON',
      body: this.props.body || null
    }).catch(() => {});
  }

  componentWillUnmount () {
    if (this._handle && typeof this._handle.dispose === 'function') {
      try { this._handle.dispose(); } catch (_) {}
    }
    this._handle = null;
  }

  async mountExplorer () {
    if (!this._wrap) return;
    this.setState({ status: 'loading', error: null });
    try {
      const api = await loadExplorerScript();
      const system = this.props.system || 'STANTON';
      const scale = this.props.scale || (this.props.body ? 'body' : 'system');
      this._handle = api.mount(this._wrap, {
        system,
        body: this.props.body || null,
        scale,
        height: Number(this.props.height) || 360,
        mapBase: BASE,
        assetBase: '/assets/map',
        onSelect: (pt) => {
          if (typeof this.props.onSelect === 'function') this.props.onSelect(pt);
        }
      });
      this.setState({ status: 'ready', error: null });
    } catch (e) {
      this.setState({ status: 'error', error: e.message || String(e) });
    }
  }

  render () {
    const scale = this.props.scale || 'system';
    const hint = scale === 'body'
      ? 'Drag to orbit · scroll to zoom · green markers are POIs · click a moon to zoom.'
      : (scale === 'galaxy'
        ? 'Click a system star to zoom in.'
        : 'Click a star or planet to zoom to its surface.');
    return React.createElement('div', { className: 'uex' },
      React.createElement('div', {
        className: 'uex-wrap',
        style: { height: Number(this.props.height) || 360 },
        ref: (el) => { this._wrap = el; }
      }),
      this.state.status === 'loading'
        ? React.createElement('div', { className: 'uex-status' }, 'Loading 3D explorer…')
        : null,
      this.state.error
        ? React.createElement('div', { className: 'uex-err' }, this.state.error)
        : null,
      React.createElement('div', { className: 'uex-hint' },
        hint + ' Surfaces are procedural / CC0 — not RSI art.')
    );
  }
}

UniverseExplorer.CSS = CSS;
UniverseExplorer.loadExplorerScript = loadExplorerScript;

module.exports = UniverseExplorer;
