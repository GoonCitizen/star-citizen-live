'use strict';

/**
 * Cross-app Fabric allowlist + identity HTTP expectation tests (Hub / http / GC).
 * Outside tests/relay — no LiveRelay boot required.
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const Key = require('@fabric/core/types/key');

const httpAllowlist = require('@fabric/http/functions/fabricHubAllowlist');
const httpProtocol = require('@fabric/http/functions/fabricProtocolLogin');
const httpDeviceProtocol = require('@fabric/http/functions/fabricDeviceLinkProtocol');
const httpVerify = require('@fabric/http/functions/fabricSiteLoginVerify');
const gcAllowlist = require('../../functions/fabricHubAllowlist');
const gcProtocol = require('../../functions/fabricProtocolLogin');

describe('Fabric interop: Hub allowlist across login/link parsers', () => {
  it('rejects phishing hubs before client sign (login + link)', () => {
    const sid = crypto.randomBytes(24).toString('hex');
    const evil = `fabric://login?sessionId=${sid}&hub=${encodeURIComponent('https://evil.example')}`;
    const login = gcProtocol.parseFabricLoginUrl(evil);
    assert.equal(login.ok, false);
    assert.match(String(login.error || ''), /allowlist|hub|origin/i);

    const evilLink = `fabric://link?sessionId=${sid}&hub=${encodeURIComponent('https://evil.example')}`;
    const link = httpDeviceProtocol.parseFabricDeviceLinkUrl(evilLink);
    assert.equal(link.ok, false);
  });

  it('accepts network hubs for login and builds matching Hub challenge prefix', () => {
    const sid = crypto.randomBytes(24).toString('hex');
    const hub = 'https://relay.goon.vc';
    const login = httpProtocol.parseFabricLoginUrl(
      `fabric://login?sessionId=${sid}&hub=${encodeURIComponent(hub)}`
    );
    assert.equal(login.ok, true);
    assert.equal(login.hubBase, hub);
    const allowed = gcAllowlist.assertAllowedFabricHub(hub);
    assert.equal(allowed.ok, true);
    assert.equal(allowed.hubBase, hub);

    const nonce = crypto.randomBytes(32).toString('hex');
    const message = httpVerify.buildLoginMessage(sid, hub, nonce);
    assert.match(message, /^fabric:hub-login:1:/);
    const key = new Key();
    const sig = key.signSchnorr(Buffer.from(message, 'utf8'));
    assert.ok(sig);
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
