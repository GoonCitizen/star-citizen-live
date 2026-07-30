'use strict';

/**
 * Searchable ship catalog picker — used by Identity flyout / modal presence.
 * Same `/ships?q=` typeahead as Fleet’s add-ship search.
 */

const React = require('react');

const BASE = '/services/star-citizen';

const CSS = `
  .sp-wrap{display:grid;gap:6px;position:relative}
  .sp-wrap label{font-size:11.5px;color:var(--muted)}
  .sp-current{font-size:12px;color:var(--text);line-height:1.4}
  .sp-current b{font-weight:600}
  .sp-current .muted{color:var(--muted);font-weight:500}
  .sp-row{display:flex;gap:6px;align-items:center}
  .sp-row input{flex:1;min-width:0;background:var(--bg);border:1px solid var(--line);color:var(--text);
    border-radius:7px;padding:7px 9px;font-size:12.5px;box-sizing:border-box}
  .sp-row input:disabled{opacity:.45}
  .sp-btn{background:var(--panel2);border:1px solid var(--line);color:var(--text);border-radius:7px;
    padding:6px 10px;font-size:11.5px;font-weight:600;cursor:pointer;white-space:nowrap}
  .sp-btn:disabled{opacity:.45;cursor:default}
  .sp-btn.primary{background:var(--accent);border-color:var(--accent);color:#fff}
  .sp-hits{max-height:168px;overflow:auto;border:1px solid var(--line);border-radius:8px;background:var(--bg)}
  .sp-hit{display:flex;justify-content:space-between;gap:8px;align-items:center;padding:7px 10px;
    border-bottom:1px solid #20262f;font-size:12px;cursor:pointer}
  .sp-hit:last-child{border-bottom:none}
  .sp-hit:hover,.sp-hit.on{background:rgba(56,139,253,.08)}
  .sp-hit .n{font-weight:600}
  .sp-hit .meta{color:var(--muted);font-size:11px;font-family:'Cascadia Code',Consolas,monospace}
  .sp-hint{font-size:11.5px;color:var(--muted);line-height:1.4}
  .sp-warn{font-size:11px;color:var(--warn)}
`;

class ShipPicker extends React.Component {
  constructor (props) {
    super(props);
    this.state = {
      query: '',
      hits: [],
      open: false,
      searching: false
    };
    this._timer = null;
    this._rootRef = React.createRef();
    this._onDocDown = (e) => {
      const el = this._rootRef.current;
      if (el && e.target && !el.contains(e.target)) {
        this.setState({ open: false });
      }
    };
  }

  componentDidMount () {
    if (typeof document !== 'undefined') {
      document.addEventListener('mousedown', this._onDocDown);
    }
  }

  componentWillUnmount () {
    if (this._timer) clearTimeout(this._timer);
    if (typeof document !== 'undefined') {
      document.removeEventListener('mousedown', this._onDocDown);
    }
  }

  search (q) {
    this.setState({ query: q, open: true, searching: true });
    if (this._timer) clearTimeout(this._timer);
    this._timer = setTimeout(async () => {
      try {
        const params = new URLSearchParams();
        if (q.trim()) params.set('q', q.trim());
        params.set('limit', '24');
        const res = await fetch(`${BASE}/ships?${params}`);
        const j = await res.json();
        if (!res.ok) throw new Error(j.error || res.statusText);
        this.setState({
          hits: Array.isArray(j.data) ? j.data : [],
          searching: false
        });
      } catch (_) {
        this.setState({ hits: [], searching: false });
      }
    }, 160);
  }

  pick (ship) {
    if (!ship || !ship.slug) return;
    this.setState({ query: '', hits: [], open: false });
    if (typeof this.props.onSelect === 'function') this.props.onSelect(ship.slug, ship);
  }

  clearOverride () {
    this.setState({ query: '', hits: [], open: false });
    if (typeof this.props.onSelect === 'function') this.props.onSelect(null, null);
  }

  render () {
    const disabled = !!this.props.disabled;
    const override = this.props.overrideShip || null;
    const detected = this.props.detectedShip || null;
    const published = override || detected;
    const publishedLabel = published && (published.name || published.slug)
      ? (published.name || published.slug)
      : null;
    const compact = !!this.props.compact;

    return React.createElement('div', { className: 'sp-wrap', ref: this._rootRef },
      this.props.label !== false
        ? React.createElement('label', null, this.props.label || 'Ship')
        : null,
      React.createElement('div', { className: 'sp-current' },
        override
          ? React.createElement(React.Fragment, null,
            React.createElement('b', null, publishedLabel),
            React.createElement('span', { className: 'muted' }, ' · manual'))
          : (publishedLabel
            ? React.createElement(React.Fragment, null,
              React.createElement('span', { className: 'muted' }, 'Autodetect · '),
              React.createElement('b', null, publishedLabel))
            : React.createElement('span', { className: 'muted' }, 'No ship yet — search to set one'))
      ),
      React.createElement('div', { className: 'sp-row' },
        React.createElement('input', {
          type: 'text',
          value: this.state.query,
          disabled,
          placeholder: 'Search — polaris, cutlass, anvil…',
          onFocus: () => {
            if (!this.state.hits.length) this.search(this.state.query);
            else this.setState({ open: true });
          },
          onChange: (e) => this.search(e.target.value)
        }),
        override
          ? React.createElement('button', {
            type: 'button',
            className: 'sp-btn',
            disabled,
            title: 'Clear manual override',
            onClick: () => this.clearOverride()
          }, compact ? 'Auto' : 'Autodetect')
          : null
      ),
      this.state.open && !disabled
        ? React.createElement('div', { className: 'sp-hits' },
          this.state.searching && !this.state.hits.length
            ? React.createElement('div', { className: 'sp-hint', style: { padding: '10px' } }, 'Searching…')
            : (this.state.hits.length
              ? this.state.hits.map((s) => React.createElement('div', {
                key: s.slug,
                className: 'sp-hit' + (override && override.slug === s.slug ? ' on' : ''),
                onClick: () => this.pick(s)
              },
              React.createElement('div', null,
                React.createElement('div', { className: 'n' },
                  s.name,
                  s.type
                    ? React.createElement('span', {
                      style: {
                        marginLeft: 8, fontSize: 10.5, fontWeight: 700,
                        color: 'var(--muted)', letterSpacing: '.02em'
                      }
                    }, s.type)
                    : null
                ),
                React.createElement('div', { className: 'meta' },
                  [
                    s.slug,
                    s.size || null,
                    s.manufacturer || null
                  ].filter(Boolean).join(' · '))
              )
              ))
              : React.createElement('div', { className: 'sp-hint', style: { padding: '10px' } },
                this.state.query.trim() ? 'No catalog matches' : 'Type to filter the catalog')
            )
        )
        : null,
      !compact && override
        ? React.createElement('div', { className: 'sp-warn' },
          'Override active — peers see ', override.name || override.slug, ' instead of autodetect.')
        : null
    );
  }
}

ShipPicker.CSS = CSS;

module.exports = ShipPicker;
