'use strict';

/**
 * Searchable location catalog picker — Identity / Dashboard presence.
 * Same `/locations?q=` typeahead as the ship picker.
 *
 * Clear publishes no location (suppresses QT autodetect). Autodetect restores
 * Game.log origin / destination detection.
 */

const React = require('react');

const BASE = '/services/star-citizen';
/** Must match `locationCatalog.NONE_SLUG` / `presence.PLACE_NONE_SLUG`. */
const PLACE_NONE_SLUG = '__none__';

function isClearedOverride (place) {
  if (!place) return false;
  if (place.cleared === true) return true;
  const slug = String(place.slug || '').trim().toLowerCase();
  return slug === PLACE_NONE_SLUG || slug === 'none' || slug === 'clear';
}

const CSS = `
  .lp-wrap{display:grid;gap:6px;position:relative}
  .lp-wrap label{font-size:11.5px;color:var(--muted)}
  .lp-current{font-size:12px;color:var(--text);line-height:1.4}
  .lp-current b{font-weight:600}
  .lp-current .muted{color:var(--muted);font-weight:500}
  .lp-row{display:flex;gap:6px;align-items:center;flex-wrap:wrap}
  .lp-row input{flex:1;min-width:0;background:var(--bg);border:1px solid var(--line);color:var(--text);
    border-radius:7px;padding:7px 9px;font-size:12.5px;box-sizing:border-box}
  .lp-row input:disabled{opacity:.45}
  .lp-btn{background:var(--panel2);border:1px solid var(--line);color:var(--text);border-radius:7px;
    padding:6px 10px;font-size:11.5px;font-weight:600;cursor:pointer;white-space:nowrap}
  .lp-btn:disabled{opacity:.45;cursor:default}
  .lp-hits{max-height:168px;overflow:auto;border:1px solid var(--line);border-radius:8px;background:var(--bg)}
  .lp-hit{display:flex;justify-content:space-between;gap:8px;align-items:center;padding:7px 10px;
    border-bottom:1px solid #20262f;font-size:12px;cursor:pointer}
  .lp-hit:last-child{border-bottom:none}
  .lp-hit:hover,.lp-hit.on{background:rgba(56,139,253,.08)}
  .lp-hit .n{font-weight:600}
  .lp-hit .meta{color:var(--muted);font-size:11px;font-family:'Cascadia Code',Consolas,monospace}
  .lp-hint{font-size:11.5px;color:var(--muted);line-height:1.4}
  .lp-warn{font-size:11px;color:var(--warn)}
`;

class LocationPicker extends React.Component {
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
        if (this.props.system) params.set('system', this.props.system);
        const res = await fetch(`${BASE}/locations?${params}`);
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

  pick (place) {
    if (!place || !place.slug) return;
    this.setState({ query: '', hits: [], open: false });
    if (typeof this.props.onSelect === 'function') this.props.onSelect(place.slug, place);
  }

  useAutodetect () {
    this.setState({ query: '', hits: [], open: false });
    if (typeof this.props.onSelect === 'function') this.props.onSelect(null, null);
  }

  clearPlace () {
    this.setState({ query: '', hits: [], open: false });
    if (typeof this.props.onSelect === 'function') {
      this.props.onSelect(PLACE_NONE_SLUG, {
        slug: PLACE_NONE_SLUG,
        name: null,
        cleared: true
      });
    }
  }

  render () {
    const disabled = !!this.props.disabled;
    const override = this.props.overridePlace || null;
    const detected = this.props.detectedPlace || null;
    const cleared = isClearedOverride(override);
    const published = (!cleared && (override || detected)) || null;
    const publishedLabel = published && (published.name || published.slug)
      ? (published.name || published.slug)
      : null;
    const compact = !!this.props.compact;
    const hasManual = !!override;
    const canClear = !cleared && !!(publishedLabel || detected);
    const noun = this.props.noun || 'Location';

    const searchPlaceholder = compact
      ? (publishedLabel
        ? (cleared ? `No ${noun.toLowerCase()} — search…` : publishedLabel + (override ? ' · manual' : ' · auto'))
        : `${noun} — search…`)
      : 'Search — crusader, area18, pyro…';

    return React.createElement('div', { className: 'lp-wrap' + (compact ? ' compact' : ''), ref: this._rootRef },
      this.props.label !== false
        ? React.createElement('label', null, this.props.label || noun)
        : null,
      !compact
        ? React.createElement('div', { className: 'lp-current' },
          cleared
            ? React.createElement(React.Fragment, null,
              React.createElement('span', { className: 'muted' }, 'None'),
              React.createElement('span', { className: 'muted' }, ' · cleared'))
            : (override
              ? React.createElement(React.Fragment, null,
                React.createElement('b', null, publishedLabel),
                React.createElement('span', { className: 'muted' }, ' · manual'))
              : (publishedLabel
                ? React.createElement(React.Fragment, null,
                  React.createElement('span', { className: 'muted' }, 'Autodetect · '),
                  React.createElement('b', null, publishedLabel))
                : React.createElement('span', { className: 'muted' }, 'No location yet — search to set one'))
            )
        )
        : null,
      React.createElement('div', { className: 'lp-row' },
        React.createElement('input', {
          type: 'text',
          value: this.state.query,
          disabled,
          placeholder: searchPlaceholder,
          title: publishedLabel
            ? (cleared ? `${noun} cleared` : ((override ? 'Manual · ' : 'Autodetect · ') + publishedLabel))
            : undefined,
          onFocus: () => {
            if (!this.state.hits.length) this.search(this.state.query);
            else this.setState({ open: true });
          },
          onChange: (e) => this.search(e.target.value)
        }),
        canClear
          ? React.createElement('button', {
            type: 'button',
            className: 'lp-btn',
            disabled,
            title: `Clear published ${noun.toLowerCase()}`,
            onClick: () => this.clearPlace()
          }, 'Clear')
          : null,
        hasManual
          ? React.createElement('button', {
            type: 'button',
            className: 'lp-btn',
            disabled,
            title: 'Use Game.log autodetection',
            onClick: () => this.useAutodetect()
          }, compact ? 'Auto' : 'Autodetect')
          : null
      ),
      this.state.open && !disabled
        ? React.createElement('div', { className: 'lp-hits' },
          this.state.searching && !this.state.hits.length
            ? React.createElement('div', { className: 'lp-hint', style: { padding: '10px' } }, 'Searching…')
            : (this.state.hits.length
              ? this.state.hits.map((s) => React.createElement('div', {
                key: s.slug,
                className: 'lp-hit' + (override && !cleared && override.slug === s.slug ? ' on' : ''),
                onClick: () => this.pick(s)
              },
              React.createElement('div', null,
                React.createElement('div', { className: 'n' },
                  s.name,
                  s.hotspot
                    ? React.createElement('span', {
                      style: {
                        marginLeft: 8, fontSize: 10.5, fontWeight: 700,
                        color: 'var(--warn)', letterSpacing: '.02em'
                      }
                    }, 'hotspot')
                    : (s.type
                      ? React.createElement('span', {
                        style: {
                          marginLeft: 8, fontSize: 10.5, fontWeight: 700,
                          color: 'var(--muted)', letterSpacing: '.02em'
                        }
                      }, s.type)
                      : null)
                ),
                React.createElement('div', { className: 'meta' },
                  [s.slug, s.system || null, s.parent || null].filter(Boolean).join(' · '))
              )))
              : React.createElement('div', { className: 'lp-hint', style: { padding: '10px' } },
                this.state.query.trim() ? 'No catalog matches' : 'Type to filter the catalog')
            )
        )
        : null,
      !compact && override && !cleared
        ? React.createElement('div', { className: 'lp-warn' },
          'Override active — peers see ', override.name || override.slug, ' instead of autodetect.')
        : null,
      !compact && cleared
        ? React.createElement('div', { className: 'lp-warn' },
          noun, ' cleared — peers see none until you pick one or switch back to Autodetect.')
        : null
    );
  }
}

LocationPicker.CSS = CSS;
LocationPicker.PLACE_NONE_SLUG = PLACE_NONE_SLUG;

module.exports = LocationPicker;
