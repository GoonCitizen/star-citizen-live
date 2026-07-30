'use strict';

/**
 * Mission outcomes donut — shared with Home → Missions stats.
 */

const React = require('react');
const missionCharts = require('../functions/missionCharts');

const CSS = `
  .moc-wrap{margin:0}
  .moc-wrap .moc-sub{color:var(--muted);font-size:12px;margin:0 0 8px;line-height:1.45}
  .moc-wrap .empty{padding:14px;text-align:center;color:var(--muted);font-size:12.5px}
`;

class MissionOutcomesChart extends React.Component {
  constructor (props) {
    super(props);
    this.state = {
      loading: !props.analytics && !props.missions,
      analytics: props.analytics || null
    };
  }

  componentDidMount () {
    if (!this.props.analytics && !this.props.missions) this.fetchAnalytics();
  }

  componentDidUpdate (prev) {
    if (prev.analytics !== this.props.analytics && this.props.analytics) {
      this.setState({ analytics: this.props.analytics, loading: false });
    }
  }

  async fetchAnalytics () {
    try {
      const res = await fetch('/services/star-citizen/analytics');
      const j = await res.json();
      if (!res.ok) throw new Error((j && j.error) || res.statusText);
      this.setState({ loading: false, analytics: j });
    } catch (_) {
      this.setState({ loading: false });
    }
  }

  render () {
    const missions = this.props.missions ||
      ((this.props.analytics || this.state.analytics || {}).missions) || [];
    const html = this.state.loading
      ? '<div class="empty">Loading outcomes…</div>'
      : missionCharts.renderOutcomesDonut(missions);
    return React.createElement('div', { className: 'moc-wrap' },
      this.props.subtitle
        ? React.createElement('p', { className: 'moc-sub' }, this.props.subtitle)
        : null,
      React.createElement('div', { dangerouslySetInnerHTML: { __html: html } })
    );
  }
}

MissionOutcomesChart.CSS = CSS;

module.exports = MissionOutcomesChart;
