'use strict';

/**
 * Header search over local data packs and register collections.
 * Lives on the dashboard tabs row, under the identity chip.
 */

const React = require('react');
const { applySearchHit, hrefOfHit } = require('../functions/appSearch');
const { isAndroidCompanion } = require('../functions/isAndroidCompanion');

const BASE = '/services/star-citizen';
const NARROW_MQ = '(max-width: 720px)';

function preferCollapsed () {
  try {
    if (typeof window === 'undefined') return false;
    if (isAndroidCompanion()) return true;
    if (window.matchMedia && window.matchMedia(NARROW_MQ).matches) return true;
  } catch (_) { /* ignore */ }
  return false;
}

const CSS = `
  .app-search{position:relative;flex:0 0 auto;width:min(280px,36vw);min-width:148px;margin-left:auto;z-index:2}
  .app-search.collapsed{width:auto;min-width:0}
  .app-search.expanded{width:min(280px,36vw);min-width:148px}
  .app-search-toggle{background:var(--panel2);border:1px solid var(--line);color:var(--text);
    border-radius:7px;padding:5px 9px;font-size:14px;cursor:pointer;line-height:1;flex:none}
  .app-search-toggle:hover{border-color:var(--accent)}
  .app-search-field{display:flex;align-items:center;gap:6px;min-width:0;width:100%}
  .app-search-field input[type="search"]{flex:1 1 auto;min-width:0}
  .app-search-close{background:transparent;border:0;color:var(--muted);cursor:pointer;font-size:16px;
    line-height:1;padding:2px 4px;flex:none}
  .app-search-close:hover{color:var(--text)}
  .app-search input[type="search"]{width:100%;background:var(--bg);border:1px solid var(--line);color:var(--text);
    border-radius:8px;padding:6px 10px;font-size:12.5px;font-family:inherit;min-width:0;box-sizing:border-box}
  .app-search input[type="search"]:focus{outline:none;border-color:var(--accent)}
  .app-search-drop{position:absolute;right:0;top:calc(100% + 6px);z-index:40;width:min(360px,calc(100vw - 24px));
    background:var(--panel);border:1px solid var(--line);border-radius:10px;padding:6px 0;
    box-shadow:0 12px 32px rgba(0,0,0,.45);max-height:min(420px,70vh);overflow:auto}
  .app-search-hint{color:var(--muted);font-size:11.5px;padding:8px 12px;line-height:1.45}
  .app-search-hit{display:grid;grid-template-columns:auto 1fr;gap:2px 10px;align-items:baseline;
    width:100%;text-align:left;background:transparent;border:none;color:var(--text);
    padding:7px 12px;cursor:pointer;font-family:inherit;text-decoration:none;box-sizing:border-box}
  .app-search-hit:hover,.app-search-hit.on{background:var(--panel2)}
  .app-search-hit .k{font-size:10px;color:var(--muted);text-transform:uppercase;letter-spacing:.3px}
  .app-search-hit .t{font-size:13px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .app-search-hit .s{grid-column:2;font-size:11.5px;color:var(--muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  @media (max-width:720px){
    .app-search.expanded{flex:1 1 auto;width:auto;min-width:0;max-width:100%;margin-left:0}
    .header-nav:has(.app-search.expanded) .row.tabs{display:none}
  }
`;

class AppSearch extends React.Component {
  constructor (props) {
    super(props);
    this._collapsible = (this.props && this.props.startCollapsed != null)
      ? !!this.props.startCollapsed
      : preferCollapsed();
    this.state = {
      query: '',
      open: false,
      loading: false,
      hits: [],
      packs: [],
      error: null,
      active: 0,
      collapsed: this._collapsible
    };
    this._timer = null;
    this._seq = 0;
    this._root = null;
    this._input = null;
  }

  componentDidMount () {
    this._onDoc = (e) => {
      if (this._root && e.target && this._root.contains(e.target)) return;
      const next = {};
      if (this.state.open) next.open = false;
      if (this._collapsible && !String(this.state.query || '').trim()) next.collapsed = true;
      if (Object.keys(next).length) this.setState(next);
    };
    this._onKey = (e) => {
      if ((e.metaKey || e.ctrlKey) && String(e.key || '').toLowerCase() === 'k') {
        const tag = e.target && e.target.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || (e.target && e.target.isContentEditable)) {
          if (this._input && e.target !== this._input) return;
        }
        e.preventDefault();
        this._expand(true);
      }
    };
    document.addEventListener('click', this._onDoc);
    document.addEventListener('keydown', this._onKey);
    if (typeof window !== 'undefined' && window.matchMedia) {
      this._mq = window.matchMedia(NARROW_MQ);
      this._onMq = () => {
        const narrow = !!(this._mq && this._mq.matches) || isAndroidCompanion();
        this._collapsible = this.props.startCollapsed != null ? !!this.props.startCollapsed : narrow;
        if (this._collapsible && !String(this.state.query || '').trim()) {
          this.setState({ collapsed: true, open: false });
        } else if (!this._collapsible) {
          this.setState({ collapsed: false });
        }
      };
      if (this._mq.addEventListener) this._mq.addEventListener('change', this._onMq);
      else if (this._mq.addListener) this._mq.addListener(this._onMq);
    }
  }

  componentWillUnmount () {
    if (this._timer) clearTimeout(this._timer);
    document.removeEventListener('click', this._onDoc);
    document.removeEventListener('keydown', this._onKey);
    if (this._mq) {
      if (this._mq.removeEventListener) this._mq.removeEventListener('change', this._onMq);
      else if (this._mq.removeListener) this._mq.removeListener(this._onMq);
    }
  }

  _expand (open) {
    this.setState({ collapsed: false, open: !!open || this.state.open }, () => {
      try { if (this._input) this._input.focus(); } catch (_) { /* ignore */ }
    });
  }

  _collapseIfEmpty () {
    if (!this._collapsible) return;
    if (String(this.state.query || '').trim()) return;
    this.setState({ collapsed: true, open: false });
  }

  onChange (value) {
    const query = String(value || '');
    this.setState({ query, open: true, active: 0, error: null });
    if (this._timer) clearTimeout(this._timer);
    const trimmed = query.trim();
    if (!trimmed) {
      this._seq += 1;
      this.setState({ hits: [], loading: false });
      return;
    }
    this.setState({ loading: true });
    this._timer = setTimeout(() => this.runSearch(trimmed), 160);
  }

  async runSearch (query) {
    const seq = ++this._seq;
    try {
      const res = await fetch(
        `${BASE}/search?q=${encodeURIComponent(query)}&limit=24`,
        { headers: { Accept: 'application/json' } }
      );
      const json = await res.json().catch(() => ({}));
      if (seq !== this._seq) return;
      if (!res.ok) throw new Error((json && json.error) || 'Search failed');
      const data = (json && json.data) || json || {};
      this.setState({
        hits: Array.isArray(data.hits) ? data.hits : [],
        packs: Array.isArray(data.packs) ? data.packs : [],
        loading: false,
        open: true,
        error: null
      });
    } catch (e) {
      if (seq !== this._seq) return;
      this.setState({ loading: false, error: e.message || String(e), hits: [] });
    }
  }

  openHit (hit) {
    if (!hit) return;
    const dest = applySearchHit(hit);
    this.setState({ open: false, query: '' });
    if (typeof this.props.onNavigate === 'function') {
      this.props.onNavigate(hit, dest);
      return;
    }
    if (dest && dest.charAt(0) === '/') window.location.href = dest;
    else if (dest) window.location.hash = dest.replace(/^#/, '');
  }

  onKeyDown (e) {
    const hits = this.state.hits || [];
    if (e.key === 'Escape') {
      if (this._collapsible) {
        this.setState({ open: false, query: '', hits: [], collapsed: true, active: 0 });
      } else {
        this.setState({ open: false });
      }
      return;
    }
    if (e.key === 'ArrowDown' && hits.length) {
      e.preventDefault();
      this.setState({ active: (this.state.active + 1) % hits.length, open: true });
      return;
    }
    if (e.key === 'ArrowUp' && hits.length) {
      e.preventDefault();
      this.setState({ active: (this.state.active - 1 + hits.length) % hits.length, open: true });
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      const hit = hits[this.state.active] || hits[0];
      if (hit) this.openHit(hit);
    }
  }

  renderDrop () {
    if (!this.state.open) return null;
    const q = String(this.state.query || '').trim();
    const hits = this.state.hits || [];
    if (!q) {
      return React.createElement('div', { className: 'app-search-drop' },
        React.createElement('div', { className: 'app-search-hint' },
          'Search people, notes, Discord servers, Fabric groups, missions, fleets, and chat packs on this node.')
      );
    }
    if (this.state.loading && !hits.length) {
      return React.createElement('div', { className: 'app-search-drop' },
        React.createElement('div', { className: 'app-search-hint' }, 'Searching local data…')
      );
    }
    if (this.state.error) {
      return React.createElement('div', { className: 'app-search-drop' },
        React.createElement('div', { className: 'app-search-hint' }, this.state.error)
      );
    }
    if (!hits.length) {
      return React.createElement('div', { className: 'app-search-drop' },
        React.createElement('div', { className: 'app-search-hint' },
          'No local matches. Notes, Discord catalogs, and group packs appear here once this node has them.')
      );
    }
    return React.createElement('div', { className: 'app-search-drop', role: 'listbox' },
      hits.map((hit, i) => {
        const href = hrefOfHit(hit);
        const kids = [
          React.createElement('span', { className: 'k' }, hit.label || hit.kind),
          React.createElement('span', { className: 't' }, hit.title),
          hit.subtitle
            ? React.createElement('span', { className: 's' }, hit.subtitle)
            : null
        ];
        const shared = {
          key: hit.kind + ':' + hit.id,
          className: 'app-search-hit' + (i === this.state.active ? ' on' : ''),
          role: 'option',
          onMouseEnter: () => this.setState({ active: i }),
          onClick: (e) => {
            if (href && (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button === 1)) return;
            if (href) e.preventDefault();
            this.openHit(hit);
          }
        };
        if (href) return React.createElement('a', Object.assign({ href }, shared), kids);
        return React.createElement('button', Object.assign({ type: 'button' }, shared), kids);
      })
    );
  }

  render () {
    const collapsed = !!this.state.collapsed;
    return React.createElement('div', {
      className: 'app-search' + (collapsed ? ' collapsed' : ' expanded'),
      ref: (el) => { this._root = el; },
      onClick: (e) => e.stopPropagation()
    },
    collapsed
      ? React.createElement('button', {
          type: 'button',
          className: 'app-search-toggle',
          title: 'Search local data',
          'aria-label': 'Search local data',
          onClick: () => this._expand(true)
        }, '🔍')
      : React.createElement('div', { className: 'app-search-field' },
          React.createElement('input', {
            ref: (el) => { this._input = el; },
            type: 'search',
            value: this.state.query,
            placeholder: 'Search local data…',
            'aria-label': 'Search local data',
            autoComplete: 'off',
            spellCheck: false,
            onFocus: () => this.setState({ open: true }),
            onChange: (e) => this.onChange(e.target.value),
            onBlur: () => { setTimeout(() => this._collapseIfEmpty(), 180); },
            onKeyDown: (e) => this.onKeyDown(e)
          }),
          this._collapsible
            ? React.createElement('button', {
                type: 'button',
                className: 'app-search-close',
                title: 'Close search',
                'aria-label': 'Close search',
                onMouseDown: (e) => e.preventDefault(),
                onClick: () => this.setState({
                  collapsed: true, open: false, query: '', hits: [], active: 0
                })
              }, '×')
            : null
        ),
    collapsed ? null : this.renderDrop()
    );
  }
}

AppSearch.CSS = CSS;

module.exports = AppSearch;
