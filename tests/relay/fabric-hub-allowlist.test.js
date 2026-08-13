'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const {
  isAllowedFabricHub,
  assertAllowedFabricHub,
  normalizeHubOrigin
} = require('../../functions/fabricHubAllowlist');
const { parseFabricLoginUrl } = require('../../functions/fabricProtocolLogin');
const { parseFabricDeviceLinkUrl } = require('../../functions/fabricDeviceLinkProtocol');

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

describe('fabric login/link parsers enforce hub allowlist', () => {
  const sid = crypto.randomBytes(24).toString('hex');

  it('accepts allowlisted login hub', () => {
    const u = `fabric://login?sessionId=${sid}&hub=${encodeURIComponent('https://relay.goon.vc')}`;
    const p = parseFabricLoginUrl(u);
    assert.equal(p.ok, true);
    assert.equal(p.hubBase, 'https://relay.goon.vc');
  });

  it('rejects phishing login hub', () => {
    const u = `fabric://login?sessionId=${sid}&hub=${encodeURIComponent('https://evil.example')}`;
    const p = parseFabricLoginUrl(u);
    assert.equal(p.ok, false);
    assert.match(p.error, /not allowed/);
  });

  it('rejects phishing device-link hub', () => {
    const u = `fabric://link?sessionId=${sid}&hub=${encodeURIComponent('https://evil.example')}`;
    const p = parseFabricDeviceLinkUrl(u);
    assert.equal(p.ok, false);
    assert.match(p.error, /not allowed/);
  });

  it('accepts extra allowlist for link', () => {
    const u = `fabric://link?sessionId=${sid}&hub=${encodeURIComponent('https://myhub.lan:8443')}`;
    const p = parseFabricDeviceLinkUrl(u, { extra: ['https://myhub.lan:8443'] });
    assert.equal(p.ok, true);
  });
});
