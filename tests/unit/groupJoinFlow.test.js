'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert');
const {
  shareClipboardText,
  shareNotice,
  createdNotice,
  groupsHash,
  notificationTarget,
  offerVisibility,
  isSelfSourced
} = require('../../functions/groupJoinFlow');

describe('groupJoinFlow', () => {
  it('prefers protocolUrl then base64 then hex for clipboard', () => {
    assert.strictEqual(shareClipboardText({ protocolUrl: 'fabric:abcPlus' }), 'fabric:abcPlus');
    assert.strictEqual(shareClipboardText({ protocolUrlBase64: 'fabric:xyz==' }), 'fabric:xyz==');
    assert.strictEqual(shareClipboardText({ protocolUrlHex: 'fabric:ef' }), 'fabric:ef');
    assert.strictEqual(shareClipboardText({}), '');
  });

  it('explains public apply vs private join invite', () => {
    const pub = shareNotice({
      kind: 'GroupOffer',
      visibility: 'public',
      relayed: true,
      peers: 1,
      expiresAt: Date.now() + (7 * 24 * 60 * 60 * 1000)
    }, 'http://x/groups/1');
    assert.match(pub, /apply/i);
    assert.match(pub, /notification/i);
    assert.match(pub, /Expires in 7 days/);
    const priv = shareNotice({ kind: 'FederationContractInvite', visibility: 'private', relayed: false }, null);
    assert.match(priv, /Join invite copied/i);
    assert.match(priv, /Import/i);
    assert.doesNotMatch(priv, /apply/i);
    const meshInvite = shareNotice({
      kind: 'FederationContractInvite',
      visibility: 'private',
      relayed: true,
      peers: 2,
      inviteePubkey: '02' + 'ab'.repeat(32)
    }, null);
    assert.match(meshInvite, /same Fabric message/i);
    assert.match(meshInvite, /destination pubkey/i);
    assert.match(meshInvite, /2 peer connection/);
  });

  it('points creators at share or invite after create', () => {
    assert.match(createdNotice({ name: 'Wing', visibility: 'public' }), /Share/);
    assert.match(createdNotice({ name: 'Wing', visibility: 'private' }), /join invite/i);
  });

  it('routes join requests to the Applications tab', () => {
    const t = notificationTarget({
      kind: 'GroupApplication',
      refs: { groupId: 'g1' }
    });
    assert.strictEqual(t.hash, groupsHash('g1', 'applications'));
    const offer = notificationTarget({
      kind: 'GroupOffer',
      refs: { groupId: 'g2' }
    });
    assert.strictEqual(offer.href, '/groups/g2');
  });

  it('reads offer visibility and self-sourced rows', () => {
    assert.strictEqual(offerVisibility({
      refs: { offer: { meta: { visibility: 'public' } } }
    }), 'public');
    assert.ok(isSelfSourced({ source: '02AA' }, '02aa'));
    assert.ok(!isSelfSourced({ source: '02aa' }, '02bb'));
  });
});
