'use strict';

/**
 * Cross-app Fabric allowlist + identity HTTP expectation tests (Hub / http / GC).
 * Outside tests/relay — no LiveRelay boot required.
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const Key = require('@fabric/core/types/key');
const { createLinkOffer } = require('@fabric/core/types/delegation');

const httpAllowlist = require('@fabric/http/functions/fabricHubAllowlist');
const { readLinkInvitation } = require('@fabric/http/functions/fabricDelegationClient');
const gcAllowlist = require('../../functions/fabricHubAllowlist');
const { signInToRelay } = require('../../functions/fabricLoginClient');
const { createIdentity } = require('../../functions/identity');

describe('Fabric interop: Hub allowlist across sign-in and signer invitations', () => {
  it('rejects phishing rendezvous before any key is used (signer invitation)', () => {
    const evil = createLinkOffer({ origin: 'https://evil.example', label: 'Phone', network: 'regtest' }, new Key());
    const link = readLinkInvitation(evil.uri);
    assert.equal(link.ok, false);
    assert.equal(gcAllowlist.assertAllowedFabricHub('https://evil.example').ok, false);
  });

  it('native relay sign-in refuses a challenge for another origin', async () => {
    const hub = 'https://relay.goon.vc';
    assert.equal(gcAllowlist.assertAllowedFabricHub(hub).ok, true);
    const passport = require('@fabric/core/functions/passport');
    const forged = passport.createChallenge({ origin: 'https://evil.example', network: 'regtest' });
    let posted = 0;
    const fetchImpl = async (url) => {
      if (url.endsWith('/sessions')) posted++;
      return { ok: true, status: 200, json: async () => ({ challenge: forged.uri, binding: 'ab'.repeat(32) }) };
    };
    const out = await signInToRelay(createIdentity(), hub, { fetchImpl });
    assert.equal(out.ok, false);
    assert.equal(posted, 0, 'nothing is signed or posted for a foreign challenge');
  });

  it('http and GC allowlists agree on defaults', () => {
    assert.equal(
      typeof httpAllowlist.assertAllowedFabricHub,
      typeof gcAllowlist.assertAllowedFabricHub
    );
    assert.deepEqual(
      httpAllowlist.assertAllowedFabricHub('https://hub.fabric.pub'),
      gcAllowlist.assertAllowedFabricHub('https://hub.fabric.pub')
    );
  });
});
