'use strict';

/**
 * Desktop OS toast kinds for the GoonCitizen register inbox.
 * Aligned with Passport `NOTIFICATION_WORTHY_TYPES` high-priority ARC surfaces
 * (invites, offers, proposals) plus mission completion claims and wallet events.
 *
 * Inbox `kind` values (functions/registerInbox.js), not wire body `type` strings.
 */

const DESKTOP_INBOX_KINDS = Object.freeze([
  'FederationInvite',
  'FederationInviteDecision',
  'MultisigWalletInvite',
  'GroupOffer',
  'GroupApplication',
  'GroupApplicationDecision',
  'GroupChangeProposal',
  'MissionClaim',
  'MissionClaimDecision',
  'WalletEscrow',
  'WalletPayout',
  'WalletWithdrawal'
]);

const DESKTOP_INBOX_KIND_SET = new Set(DESKTOP_INBOX_KINDS);

/** Toast even when not pending/actionable (accept/reject outcomes). */
const DESKTOP_DECISION_KINDS = Object.freeze([
  'FederationInviteDecision',
  'GroupApplicationDecision',
  'MissionClaimDecision'
]);

const DESKTOP_DECISION_KIND_SET = new Set(DESKTOP_DECISION_KINDS);

/**
 * @param {string} kind Inbox row kind
 * @returns {boolean}
 */
function isDesktopInboxKind (kind) {
  return DESKTOP_INBOX_KIND_SET.has(String(kind || ''));
}

/**
 * Whether a fresh inbox row should raise a desktop toast.
 * Pending actionable invites/claims always; decisions (accept/reject) and wallet
 * events toast when status matches.
 * @param {object} row
 * @returns {boolean}
 */
function shouldDesktopToast (row) {
  if (!row || !isDesktopInboxKind(row.kind)) return false;
  if (row.status === 'pending' && row.actionable) return true;
  if (DESKTOP_DECISION_KIND_SET.has(row.kind) &&
      (row.status === 'accepted' || row.status === 'rejected')) {
    return true;
  }
  if (String(row.kind).indexOf('Wallet') === 0) {
    return row.status === 'info' || row.status === 'pending' || row.status === 'accepted';
  }
  // Resolved MultisigWalletInvite / FederationInvite / GroupApplication after
  // local accept/reject — toast so the other party outcome is visible when
  // the same row is patched on the inviter/creator machine via mesh response.
  if ((row.kind === 'MultisigWalletInvite' || row.kind === 'FederationInvite' ||
      row.kind === 'GroupApplication') &&
      (row.status === 'accepted' || row.status === 'rejected') &&
      row.actionable === false) {
    return true;
  }
  return false;
}

/**
 * Toast title / kind slug for chrome/Electron notify.
 * @param {string} kind
 * @returns {{ title: string, notifyKind: string }}
 */
function desktopNotifyMeta (kind) {
  switch (String(kind || '')) {
    case 'FederationInvite':
      return { title: 'Group invite', notifyKind: 'federationinvite' };
    case 'FederationInviteDecision':
      return { title: 'Invite response', notifyKind: 'federationinvitedecision' };
    case 'MultisigWalletInvite':
      return { title: 'Multisig wallet invite', notifyKind: 'multisigwalletinvite' };
    case 'GroupOffer':
      return { title: 'Group offer', notifyKind: 'groupoffer' };
    case 'GroupApplication':
      return { title: 'Group join request', notifyKind: 'groupapplication' };
    case 'GroupApplicationDecision':
      return { title: 'Group join decision', notifyKind: 'groupapplicationdecision' };
    case 'GroupChangeProposal':
      return { title: 'Group proposal', notifyKind: 'groupproposal' };
    case 'MissionClaim':
      return { title: 'Mission completion', notifyKind: 'missionclaim' };
    case 'MissionClaimDecision':
      return { title: 'Completion decision', notifyKind: 'missionclaimdecision' };
    case 'WalletEscrow':
      return { title: 'Mission escrow', notifyKind: 'walletescrow' };
    case 'WalletPayout':
      return { title: 'Wallet payout', notifyKind: 'walletpayout' };
    case 'WalletWithdrawal':
      return { title: 'Group withdrawal', notifyKind: 'walletwithdrawal' };
    default:
      return { title: 'Notification', notifyKind: 'inbox' };
  }
}

module.exports = {
  DESKTOP_INBOX_KINDS,
  DESKTOP_INBOX_KIND_SET,
  DESKTOP_DECISION_KINDS,
  isDesktopInboxKind,
  shouldDesktopToast,
  desktopNotifyMeta
};
