'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  DESKTOP_INBOX_KINDS,
  isDesktopInboxKind,
  shouldDesktopToast,
  desktopNotifyMeta
} = require('../../functions/desktopInboxKinds');

describe('desktopInboxKinds', () => {
  it('includes group proposals, multisig invites, and wallet events', () => {
    assert.ok(DESKTOP_INBOX_KINDS.includes('GroupChangeProposal'));
    assert.ok(DESKTOP_INBOX_KINDS.includes('FederationInvite'));
    assert.ok(DESKTOP_INBOX_KINDS.includes('MultisigWalletInvite'));
    assert.ok(DESKTOP_INBOX_KINDS.includes('GroupApplicationDecision'));
    assert.ok(DESKTOP_INBOX_KINDS.includes('WalletPayout'));
    assert.ok(isDesktopInboxKind('GroupChangeProposal'));
    assert.strictEqual(isDesktopInboxKind('GroupChangeVote'), false);
  });

  it('maps proposal and wallet meta for desktop toast', () => {
    const meta = desktopNotifyMeta('GroupChangeProposal');
    assert.strictEqual(meta.title, 'Group proposal');
    assert.strictEqual(meta.notifyKind, 'groupproposal');
    const wallet = desktopNotifyMeta('MultisigWalletInvite');
    assert.strictEqual(wallet.title, 'Multisig wallet invite');
  });

  it('toasts pending actionable invites and rejected decisions', () => {
    assert.ok(shouldDesktopToast({
      kind: 'MultisigWalletInvite',
      status: 'pending',
      actionable: true
    }));
    assert.ok(shouldDesktopToast({
      kind: 'GroupApplicationDecision',
      status: 'rejected',
      actionable: false
    }));
    assert.ok(shouldDesktopToast({
      kind: 'WalletEscrow',
      status: 'info',
      actionable: false
    }));
    assert.strictEqual(shouldDesktopToast({
      kind: 'GroupChangeVote',
      status: 'pending',
      actionable: true
    }), false);
  });
});
