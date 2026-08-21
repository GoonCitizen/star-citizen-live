'use strict';

/**
 * Compact contract facts for a Federation group — publisher, created date,
 * k-of-n signer count. Used on GroupPage and the Groups dashboard.
 */

const React = require('react');
const { profileHref } = require('../functions/identityActor');
const { pubkeysMatch } = require('@fabric/http/functions/fabricPubkey');
const groupPresence = require('../functions/groupPresence');

const CSS = `
  .gcs{min-width:0}
  .gcs-facts{display:flex;flex-wrap:wrap;gap:4px 16px;align-items:baseline}
  .gcs-fact{display:flex;flex-wrap:wrap;gap:6px;align-items:baseline;min-width:0}
  .gcs-fact .k{font-size:11px;color:var(--muted);font-weight:650}
  .gcs-fact .v{font-size:12.5px;line-height:1.4;word-break:break-word}
  .gcs-actor{display:inline-flex;flex-wrap:wrap;gap:6px;align-items:baseline}
  .gcs-actor a{color:var(--accent);text-decoration:none}
  .gcs-actor a:hover{text-decoration:underline}
  .gcs-tag{font-size:10.5px;font-weight:700;padding:1px 7px;border-radius:5px;white-space:nowrap}
  .gcs-tag.accent{background:rgba(56,139,253,.15);color:var(--accent)}
`;

function signerList (group) {
  if (!group) return [];
  if (Array.isArray(group.validators) && group.validators.length) return group.validators.slice();
  if (group.proposedPolicy && Array.isArray(group.proposedPolicy.validators)
      && group.proposedPolicy.validators.length) {
    return group.proposedPolicy.validators.slice();
  }
  return [];
}

function signerCount (group) {
  if (!group) return 0;
  if (group.signerCount != null && group.signerCount !== '') {
    const n = Number(group.signerCount);
    if (Number.isFinite(n) && n >= 0) return n;
  }
  const list = signerList(group);
  if (list.length) return list.length;
  if (Array.isArray(group.members) && group.members.length) return group.members.length;
  return 0;
}

function memberCount (group) {
  if (!group) return 0;
  if (group.memberCount != null && group.memberCount !== '') {
    const n = Number(group.memberCount);
    if (Number.isFinite(n) && n >= 0) return n;
  }
  if (Array.isArray(group.members)) return group.members.length;
  return 0;
}

function thresholdLabel (group) {
  const n = signerCount(group);
  const k = Math.max(1, Number(group && group.threshold) || 1);
  return n ? (k + '-of-' + n) : (k + '-of-n');
}

function isSignerKey (group, pubkey) {
  return signerList(group).some((v) => pubkeysMatch(v, pubkey));
}

function shortKey (pubkey) {
  const s = String(pubkey || '');
  if (s.length < 18) return s || '—';
  return s.slice(0, 10) + '…' + s.slice(-6);
}

function actorLabel (pubkey, roster) {
  const p = groupPresence.presenceFor(roster, pubkey);
  return (p && p.nickname) || shortKey(pubkey);
}

function renderActor (pubkey, roster, extraTags) {
  if (!pubkey) {
    return React.createElement('span', { className: 'v' }, '—');
  }
  const href = profileHref(pubkey);
  const label = actorLabel(pubkey, roster);
  return React.createElement('span', { className: 'gcs-actor' },
    href
      ? React.createElement('a', { href, title: pubkey }, label)
      : React.createElement('span', { title: pubkey }, label),
    extraTags || null
  );
}

function fact (label, value) {
  if (value == null || value === false) return null;
  return React.createElement('div', { className: 'gcs-fact', key: label },
    React.createElement('span', { className: 'k' }, label),
    typeof value === 'string' || typeof value === 'number'
      ? React.createElement('span', { className: 'v' }, value)
      : React.createElement('div', { className: 'v' }, value)
  );
}

function GroupContractSummary (props = {}) {
  const g = props.group;
  if (!g) return null;
  const roster = props.presenceRoster || {};
  const viewer = props.viewerPubkey || null;
  const created = g.createdAt ? String(g.createdAt).slice(0, 10) : null;
  const publisherTags = [];
  if (viewer && pubkeysMatch(g.creator, viewer)) {
    publisherTags.push(React.createElement('span', { key: 'you', className: 'gcs-tag accent' }, 'you'));
  }

  return React.createElement('div', { className: 'gcs' },
    React.createElement('div', { className: 'gcs-facts' },
      fact('Publisher', g.creator
        ? renderActor(g.creator, roster, publisherTags)
        : '—'),
      created ? fact('Created', created) : null,
      fact('Signers', thresholdLabel(g))
    )
  );
}

GroupContractSummary.CSS = CSS;
GroupContractSummary.signerList = signerList;
GroupContractSummary.signerCount = signerCount;
GroupContractSummary.memberCount = memberCount;
GroupContractSummary.thresholdLabel = thresholdLabel;
GroupContractSummary.isSignerKey = isSignerKey;
GroupContractSummary.pubkeysMatch = pubkeysMatch;

module.exports = GroupContractSummary;
