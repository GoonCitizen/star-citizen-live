'use strict';

/**
 * Compact activity timeline for a mission or group page.
 * Data comes from GET …/inbox?missionId=… or ?groupId=…
 */

const React = require('react');

const CSS = `
  .rel-empty{color:var(--muted);font-style:italic;font-size:12.5px;padding:4px 0}
  .rel-item{display:grid;gap:3px;padding:9px 0;border-bottom:1px solid #20262f}
  .rel-item:last-child{border-bottom:none}
  .rel-head{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
  .rel-title{font-size:13px;font-weight:600;flex:1;min-width:120px}
  .rel-meta{color:var(--muted);font-size:11px;font-family:'Cascadia Code',Consolas,monospace;word-break:break-all}
  .rel-body{font-size:12.5px;color:var(--text);line-height:1.4}
  .rel-tag{font-size:10px;font-weight:700;padding:2px 7px;border-radius:5px}
  .rel-tag.pending{background:rgba(59,130,246,.18);color:var(--accent)}
  .rel-tag.accepted{background:rgba(63,185,80,.15);color:var(--good)}
  .rel-tag.rejected{background:rgba(248,81,73,.15);color:var(--kill)}
  .rel-tag.ignored,.rel-tag.info{background:rgba(110,118,129,.18);color:var(--muted)}
  .rel-tag.kind{background:rgba(56,139,253,.12);color:var(--accent)}
`;

function shortKey (pk) {
  return pk ? pk.slice(0, 8) + '…' : null;
}

function fmtTime (ts) {
  if (!ts) return '';
  try {
    return new Date(ts).toLocaleString(undefined, {
      month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
    });
  } catch (_) {
    return String(ts).slice(0, 16);
  }
}

function kindLabel (kind) {
  const map = {
    MissionBroadcast: 'offer',
    MissionApplication: 'apply',
    MissionApplicationDecision: 'decision',
    MissionClaim: 'completion',
    MissionClaimDecision: 'completion decision',
    MissionCreated: 'created',
    MissionCancelled: 'cancelled',
    GroupApplication: 'join apply',
    GroupApplicationDecision: 'join decision',
    GroupOffer: 'group offer',
    FederationInvite: 'invite',
    FederationInviteDecision: 'invite decision',
    GroupChange: 'membership',
    GroupIngest: 'received',
    GroupCreated: 'created'
  };
  return map[kind] || (kind || 'event');
}

class RegisterEventLog extends React.Component {
  render () {
    const items = this.props.items || [];
    const empty = this.props.empty || 'No activity recorded yet.';
    if (!items.length) {
      return React.createElement('div', { className: 'rel-empty' }, empty);
    }
    return React.createElement('div', { className: 'rel-list' },
      items.map((item) => React.createElement('div', { className: 'rel-item', key: item.id },
        React.createElement('div', { className: 'rel-head' },
          React.createElement('span', { className: 'rel-tag kind' }, kindLabel(item.kind)),
          React.createElement('span', { className: 'rel-tag ' + (item.status || 'info') }, item.status || 'info'),
          React.createElement('span', { className: 'rel-title' }, item.title)
        ),
        item.body && item.body !== item.title
          ? React.createElement('div', { className: 'rel-body' }, String(item.body).slice(0, 200))
          : null,
        React.createElement('div', { className: 'rel-meta' },
          [fmtTime(item.ts), item.handle || shortKey(item.source), item.resolvedAt ? 'resolved ' + fmtTime(item.resolvedAt) : null]
            .filter(Boolean)
            .join(' · ')
        )
      ))
    );
  }
}

RegisterEventLog.CSS = CSS;

module.exports = RegisterEventLog;
