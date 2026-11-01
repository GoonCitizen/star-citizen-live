'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const Key = require('@fabric/core/types/key');
const { createLinkOffer } = require('@fabric/core/functions/delegation');
const {
  isAllowedFabricHub,
  assertAllowedFabricHub,
  normalizeHubOrigin
} = require('../../functions/fabricHubAllowlist');
const { readLinkInvitation } = require('@fabric/http/functions/fabricDelegationClient');

describe('fabricHubAllowlist', () => {
  it('allows default network hubs and loopback', () => {
    assert.equal(isAllowedFabricHub('https://relay.goon.vc'), true);
    assert.equal(isAllowedFabricHub('https://hub.fabric.pub/sessions'), true);
    assert.equal(isAllowedFabricHub('http://127.0.0.1:3041'), true);
    assert.equal(isAllowedFabricHub('http://localhost:8080'), true);
  });

  it('rejects unknown hubs unless allowlisted via env', () => {
    assert.equal(isAllowedFabricHub('https://evil.example'), false);
    assert.equal(
      isAllowedFabricHub('https://evil.example', {
        env: { FABRIC_HUB_ALLOWLIST: 'https://evil.example' }
      }),
      true
    );
  });

  it('assertAllowedFabricHub normalizes origin', () => {
    const ok = assertAllowedFabricHub('https://relay.goon.vc/path');
    assert.equal(ok.ok, true);
    assert.equal(ok.hubBase, 'https://relay.goon.vc');
    const bad = assertAllowedFabricHub('https://phishing.test');
    assert.equal(bad.ok, false);
    assert.match(bad.error, /not allowed/);
  });

  it('normalizeHubOrigin rejects non-http(s)', () => {
    assert.equal(normalizeHubOrigin('ftp://x'), null);
  });
});

describe('signer invitations enforce the hub allowlist', () => {
  const invite = (origin) => createLinkOffer({ origin, label: 'Phone', network: 'regtest' }, new Key()).uri;

  it('rejects a phishing rendezvous', () => {
    const p = readLinkInvitation(invite('https://evil.example'));
    assert.equal(p.ok, false);
    assert.match(p.error, /rendezvous this app does not use/);
  });

  it('accepts a rendezvous on the extra allowlist', () => {
    const p = readLinkInvitation(invite('https://myhub.lan:8443'), { allowlist: { extra: ['https://myhub.lan:8443'] } });
    assert.equal(p.ok, true);
    assert.equal(p.rendezvous, 'https://myhub.lan:8443');
  });
});
