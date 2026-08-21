'use strict';

/**
 * Group-owner summary of online member ships + locations, with optional map.
 */

const React = require('react');
const StarMap = require('./StarMap');
const groupPresence = require('../functions/groupPresence');

const CSS = `
  .gcomp{display:grid;gap:10px;padding:12px 14px;border-bottom:1px solid var(--line);
    background:rgba(59,130,246,.05)}
  .gcomp h3{margin:0;font-size:12px;font-weight:650}
  .gcomp .hint{font-size:11.5px;color:var(--muted);line-height:1.45}
  .gcomp-rows{display:grid;gap:3px}
  .gcomp-row{display:flex;gap:10px;font-size:12px}
  .gcomp-row .n{flex:1}
  .gcomp .chip{font-size:11px;font-weight:700;padding:1px 7px;border-radius:5px;
    background:rgba(63,185,80,.15);color:var(--good)}
`;

function rowsOf (list) {
  return (list || []).slice(0, 8).map((r) => React.createElement('div', {
    className: 'gcomp-row',
    key: r.n
  },
  React.createElement('span', { className: 'n' }, r.n),
  React.createElement('span', { className: 'chip' }, r.c)
  ));
}

class GroupComposition extends React.Component {
  render () {
    const composition = this.props.composition;
    if (!composition) return null;
    const members = (composition.members || []).filter((m) => m.online);
    const system = this.props.system || groupPresence.majoritySystem(members);
    return React.createElement('div', { className: 'gcomp' },
      React.createElement('h3', null, 'Online composition'),
      React.createElement('div', { className: 'hint' },
        composition.online + '/' + composition.total + ' online — ships and locations of members sharing presence.'),
      composition.ships && composition.ships.length
        ? React.createElement('div', null,
          React.createElement('div', { className: 'hint' }, 'Ships'),
          React.createElement('div', { className: 'gcomp-rows' }, rowsOf(composition.ships)))
        : null,
      composition.shipTypes && composition.shipTypes.length
        ? React.createElement('div', null,
          React.createElement('div', { className: 'hint' }, 'Types'),
          React.createElement('div', { className: 'gcomp-rows' }, rowsOf(composition.shipTypes)))
        : null,
      composition.locations && composition.locations.length
        ? React.createElement('div', null,
          React.createElement('div', { className: 'hint' }, 'Locations'),
          React.createElement('div', { className: 'gcomp-rows' }, rowsOf(composition.locations)))
        : null,
      this.props.showMap !== false
        ? React.createElement(StarMap, {
          system,
          members,
          includeHotspots: true,
          height: this.props.mapHeight || 220
        })
        : null
    );
  }
}

GroupComposition.CSS = CSS;

module.exports = GroupComposition;
