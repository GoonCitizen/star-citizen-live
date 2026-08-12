'use strict';

/**
 * Basics tied to SECURITY.md § Adversarial environment.
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  isAllowedFabricHub,
  assertAllowedFabricHub,
  normalizeHubOrigin
} = require('../../functions/fabricHubAllowlist');

describe('adversarialEnvironment.basics (GoonCitizen)', () => {
  it('rejects phishing hubs for fabric login/link', () => {
    assert.equal(isAllowedFabricHub('https://evil.example'), false);
    const bad = assertAllowedFabricHub('https://phishing.test/sessions');
    assert.equal(bad.ok, false);
    assert.match(bad.error, /not allowed/);
  });

  it('keeps loopback and network hubs available for legitimate completions', () => {
    assert.equal(isAllowedFabricHub('https://relay.goon.vc'), true);
    assert.equal(isAllowedFabricHub('http://127.0.0.1:3041'), true);
    assert.equal(normalizeHubOrigin('https://hub.fabric.pub/path'), 'https://hub.fabric.pub');
  });
});
