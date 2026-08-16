'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  DEVICE_LINK_OFFER_TTL_MS,
  stampCreatedAt,
  isDeviceLinkOfferExpired,
  isDeviceLinkPromptExpired,
  isStaleDeviceLinkError,
  isDeviceLinkLockedError
} = require('../../functions/deviceLinkLifecycle');

describe('deviceLinkLifecycle', () => {
  it('stamps createdAt once', () => {
    const a = stampCreatedAt({});
    assert.equal(typeof a.createdAt, 'number');
    const t = a.createdAt;
    stampCreatedAt(a);
    assert.equal(a.createdAt, t);
  });

  it('treats unstamped offers as not expired', () => {
    assert.equal(isDeviceLinkOfferExpired({ sessionId: 'aa' }), false);
  });

  it('expires offers after the UI TTL', () => {
    const now = 1_000_000;
    assert.equal(isDeviceLinkOfferExpired({ createdAt: now - DEVICE_LINK_OFFER_TTL_MS - 1 }, now), true);
    assert.equal(isDeviceLinkOfferExpired({ createdAt: now - 1000 }, now), false);
  });

  it('classifies hub 404 / expired copy as stale', () => {
    assert.equal(isStaleDeviceLinkError({ expired: true }), true);
    assert.equal(isStaleDeviceLinkError({ status: 404, error: 'unknown or expired device link' }), true);
    assert.equal(isStaleDeviceLinkError({ status: 410 }), true);
    assert.equal(isStaleDeviceLinkError({ error: 'Identity is locked' }), false);
    assert.equal(isDeviceLinkLockedError({ error: 'Identity is locked' }), true);
  });

  it('expires approval prompts on the same TTL', () => {
    const now = 5_000_000;
    assert.equal(isDeviceLinkPromptExpired({ createdAt: now - DEVICE_LINK_OFFER_TTL_MS - 1 }, now), true);
  });
});
