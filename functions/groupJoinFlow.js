'use strict';

/**
 * Shared copy + navigation for group create → share → join → notifications.
 */

function shareClipboardText (data) {
  if (!data || typeof data !== 'object') return '';
  return String(
    data.protocolUrl ||
    data.protocolUrlBase64 ||
    data.protocolUrlHex ||
    ''
  ).trim();
}

/**
 * User-facing notice after Share / Copy join invite.
 * @param {object} data API payload from /share or /invites
 * @param {string} [pageUrl]
 * @returns {string}
 */
function shareNotice (data, pageUrl) {
  const kind = data && data.kind;
  const vis = (data && data.visibility) || null;
  const peers = Number(data && data.peers) || 0;
  const mesh = data && data.relayed
    ? (`Sent to the network (${peers} peer connection${peers === 1 ? '' : 's'}). `)
    : '';
  const page = pageUrl ? (` Page: ${pageUrl}`) : '';
  const isInvite = kind === 'FederationContractInvite' || vis === 'private';
  if (isInvite) {
    return mesh +
      'Join invite copied — send it to the person you want in the group. They choose Import…, paste, and Accept to join.' +
      page;
  }
  return mesh +
    'Share copied — they paste it via Import… to apply, or open the group page. You will get a notification to accept.' +
    page;
}

/**
 * Next-step copy after creating a group.
 * @param {object} group
 * @returns {string}
 */
function createdNotice (group) {
  const name = (group && group.name) || 'Group';
  if (group && group.visibility === 'public') {
    return `"${name}" is public. Share so others can apply — join requests land in Notifications.`;
  }
  return `"${name}" created. Share a join invite, or Invite a pubkey from Members. Make it public if you want a join page.`;
}

function groupPagePath (groupId) {
  if (!groupId) return '/#groups';
  return `/groups/${encodeURIComponent(groupId)}`;
}

function groupsHash (groupId, tab) {
  if (!groupId) return 'groups';
  const q = ['id=' + encodeURIComponent(groupId)];
  if (tab && tab !== 'members') q.push('tab=' + encodeURIComponent(tab));
  return 'groups?' + q.join('&');
}

/**
 * Where a notification row should open.
 * @param {object} item
 * @returns {{ href?: string, hash?: string }}
 */
function notificationTarget (item) {
  const refs = (item && item.refs) || {};
  const kind = String((item && item.kind) || '');
  if (refs.missionId && kind.indexOf('Wallet') !== 0) {
    return { href: '/missions/' + encodeURIComponent(refs.missionId) };
  }
  if (kind === 'GroupApplication' && refs.groupId) {
    return { hash: groupsHash(refs.groupId, 'applications') };
  }
  if (kind === 'GroupChangeProposal' && refs.groupId) {
    return { hash: groupsHash(refs.groupId, 'proposals') };
  }
  if (refs.groupId) {
    return { href: groupPagePath(refs.groupId) };
  }
  if (kind.indexOf('Wallet') === 0) return { hash: 'wallet' };
  if (kind.indexOf('Group') === 0 || kind === 'FederationInvite' ||
      kind === 'FederationInviteDecision' || kind === 'MultisigWalletInvite') {
    return { hash: 'groups' };
  }
  return { hash: 'missions' };
}

function applyNotificationTarget (target) {
  if (!target || typeof window === 'undefined') return;
  if (target.href) {
    window.location.href = target.href;
    return;
  }
  if (target.hash) window.location.hash = target.hash;
}

function offerVisibility (item) {
  const refs = (item && item.refs) || {};
  const offer = refs.offer || {};
  const meta = offer.meta || {};
  return refs.visibility || meta.visibility || null;
}

function isSelfSourced (item, pubkey) {
  if (!item || !pubkey) return false;
  const src = String(item.source || '').toLowerCase();
  const me = String(pubkey).toLowerCase();
  if (!src || !me) return false;
  return src === me;
}

function dispatchGroupImported (data) {
  if (typeof window === 'undefined' || typeof window.dispatchEvent !== 'function') return;
  try {
    window.dispatchEvent(new CustomEvent('gooncitizen:group-imported', { detail: data || {} }));
  } catch (_) { /* ignore */ }
}

function dispatchInboxRefresh (data) {
  if (typeof window === 'undefined' || typeof window.dispatchEvent !== 'function') return;
  try {
    window.dispatchEvent(new CustomEvent('gooncitizen:inbox', { detail: data || {} }));
  } catch (_) { /* ignore */ }
}

module.exports = {
  shareClipboardText,
  shareNotice,
  createdNotice,
  groupPagePath,
  groupsHash,
  notificationTarget,
  applyNotificationTarget,
  offerVisibility,
  isSelfSourced,
  dispatchGroupImported,
  dispatchInboxRefresh
};
