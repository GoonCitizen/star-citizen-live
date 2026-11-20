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

describe('DelegationRequest in Notifications', () => {
  it('a linked signer\'s request becomes an actionable entry that toasts', async () => {
    const Key = require('@fabric/core/types/key');
    const Message = require('@fabric/core/types/message');
    const Delegation = require('@fabric/core/types/delegation');
    const { entryFromDelegationRequest } = require('../../functions/registerInbox');
    const player = new Delegation({ key: new Key() });
    const passport = new Delegation({ key: new Key() });
    const grant = await player.grant({ grantee: passport.key.pubkey, scopes: ['message'], label: 'Passport' });
    await passport.receive(grant.uri);
    const req = await passport.request({ target: player.key.pubkey, request: Message.fromVector(['P2P_CHAT_MESSAGE', 'sign me']) });
    const events = [];
    player.on('request', (ev) => events.push(ev));
    assert.equal((await player.receive(req.uri)).ok, true);
    assert.equal(events.length, 1);

    const entry = entryFromDelegationRequest(events[0]);
    assert.equal(entry.id, 'delegation:' + req.hash);
    assert.equal(entry.kind, 'DelegationRequest');
    assert.equal(entry.status, 'pending');
    assert.equal(entry.actionable, true);
    assert.equal(entry.refs.request, req.hash);
    assert.equal(entry.refs.scope, 'message');
    assert.ok(isDesktopInboxKind('DelegationRequest'));
    assert.ok(shouldDesktopToast(entry));
    assert.equal(desktopNotifyMeta('DelegationRequest').notifyKind, 'delegationrequest');
    assert.equal(entryFromDelegationRequest({ hash: 'nope' }), null);
  });
});
