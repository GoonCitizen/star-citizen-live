'use strict';

/**
 * Reusable "When you fly" activity heatmap — Home stats, Identity, peer profiles.
 */

const React = require('react');
const activityHeat = require('../functions/activityHeat');
const { androidSurface } = require('../functions/androidSurface');

const CSS = `
  .ah-wrap{margin-top:10px}
  .ah-wrap h4{margin:0 0 4px;font-size:12.5px;font-weight:600}
  .ah-wrap .ah-sub{color:var(--muted);font-size:11.5px;margin:0 0 8px;line-height:1.45}
  .ah-wrap .ah-body{overflow:auto;padding:2px 0}
  .ah-wrap .empty{padding:14px;text-align:center;color:var(--muted);font-size:12.5px}
`;

class ActivityHeatmap extends React.Component {
  constructor (props) {
    super(props);
    const skipLocal = !props.analytics && !props.heatcells && !androidSurface('heatmap');
    this.state = {
      loading: !props.analytics && !props.heatcells && !skipLocal,
      error: null,
      analytics: props.analytics || null
    };
  }

  componentDidMount () {
    if (this.props.analytics || this.props.heatcells) return;
    if (!androidSurface('heatmap')) return;
    this.fetchAnalytics();
  }

  componentDidUpdate (prev) {
    if (prev.analytics !== this.props.analytics && this.props.analytics) {
      this.setState({ analytics: this.props.analytics, loading: false });
    }
  }

  async fetchAnalytics () {
    this.setState({ loading: true, error: null });
    try {
      const res = await fetch('/services/star-citizen/analytics');
      const j = await res.json();
      if (!res.ok) throw new Error((j && j.error) || res.statusText);
      this.setState({ loading: false, analytics: j });
    } catch (e) {
      this.setState({ loading: false, error: e.message || String(e) });
    }
  }

  render () {
    if (!androidSurface('heatmap') && !this.props.analytics && !this.props.heatcells) {
      return null;
    }
    const title = this.props.title || 'When you fly';
    const subtitle = this.props.subtitle || 'Day & hour (local); darker = busier';
    const analytics = this.props.analytics || this.state.analytics;
    const months = this.props.months || null;
    const player = this.props.player || null;
    const cells = this.props.heatcells ||
      activityHeat.resolveHeatcells(analytics, { player, months });
    const html = this.state.loading
      ? '<div class="empty">Loading activity…</div>'
      : (this.state.error
        ? '<div class="empty">' + String(this.state.error).replace(/</g, '&lt;') + '</div>'
        : activityHeat.renderHeatSvg(cells));

    return React.createElement('div', { className: 'ah-wrap' },
      title ? React.createElement('h4', null, title) : null,
      subtitle ? React.createElement('p', { className: 'ah-sub' }, subtitle) : null,
      React.createElement('div', {
        className: 'ah-body',
        dangerouslySetInnerHTML: { __html: html }
      })
    );
  }
}

ActivityHeatmap.CSS = CSS;

module.exports = ActivityHeatmap;
