'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const Key = require('@fabric/core/types/key');
const delegation = require('@fabric/core/functions/delegation');
const { interpretQrScan, delegationInvitationFromUrl } = require('../../functions/qrScanLink');

const HUB = 'https://relay.goon.vc';

function invitation (origin = HUB, now = Date.now()) {
  return delegation.createLinkOffer({ origin, label: 'Passport', network: 'regtest', now }, new Key()).uri;
}

describe('interpretQrScan', () => {
  it('reads a signer invitation that pairs through a Hub this app uses', () => {
    const uri = invitation();
    const hit = interpretQrScan(uri);
    assert.equal(hit.ok, true);
    assert.equal(hit.kind, 'delegation-invitation');
    assert.equal(hit.invitation, uri);
    assert.equal(hit.rendezvous, HUB);
    assert.equal(hit.label, 'Passport');
    assert.equal(delegationInvitationFromUrl(uri), uri);
  });

  it('rejects an empty scan', () => {
    assert.equal(interpretQrScan('   ').ok, false);
  });

  it('rejects a random URL and the retired fabric://link form', () => {
    for (const text of ['https://example.com/not-a-link', 'fabric://link?sessionId=aa&hub=https%3A%2F%2Frelay.goon.vc']) {
      const hit = interpretQrScan(text);
      assert.equal(hit.ok, false);
      assert.match(hit.error, /signer invitation/i);
      assert.equal(delegationInvitationFromUrl(text), null);
    }
  });

  it('rejects an invitation through a Hub this app does not use', () => {
    const hit = interpretQrScan(invitation('https://evil.example'));
    assert.equal(hit.ok, false);
    assert.match(hit.error, /evil\.example/);
  });

  it('rejects an expired invitation', () => {
    const hit = interpretQrScan(invitation(HUB, Date.now() - 24 * 60 * 60 * 1000));
    assert.equal(hit.ok, false);
    assert.match(hit.error, /expired/i);
  });

  it('rejects other fabric: frames', () => {
    const grant = delegation.createGrant({ grantee: new Key().pubkey, scopes: ['identity'] }, new Key());
    assert.equal(interpretQrScan(grant.uri).ok, false);
  });
});
