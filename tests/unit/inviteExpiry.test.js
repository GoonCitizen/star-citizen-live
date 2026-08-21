'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const {
  DEFAULT_INVITE_TTL_MS,
  resolveShareExpiresAtMs,
  isInviteExpired,
  assertInviteNotExpired,
  assertExpiresAtInFuture,
  formatInviteExpiryLabel,
  inviteHttpStatus,
  inviteHttpBody
} = require('../../functions/inviteExpiry');

describe('inviteExpiry', () => {
  it('defaults share expiry to 7 days', () => {
    const now = 1_700_000_000_000;
    const exp = resolveShareExpiresAtMs({ invitedAt: now }, now);
    assert.equal(exp, now + DEFAULT_INVITE_TTL_MS);
    assert.equal(DEFAULT_INVITE_TTL_MS, 7 * 24 * 60 * 60 * 1000);
  });

  it('honours expiresInDays, ttlMs, and explicit expiresAt', () => {
    const now = 1_700_000_000_000;
    assert.equal(resolveShareExpiresAtMs({ invitedAt: now, expiresInDays: 1 }, now), now + 86400000);
    assert.equal(resolveShareExpiresAtMs({ invitedAt: now, ttlMs: 5000 }, now), now + 5000);
    assert.equal(resolveShareExpiresAtMs({ expiresAt: now + 3600000 }, now), now + 3600000);
    assert.equal(
      resolveShareExpiresAtMs({ expiresAt: new Date(now + 120000).toISOString() }, now),
      now + 120000
    );
  });

  it('treats missing expiresAt as valid and refuses a past stamp', () => {
    assert.equal(isInviteExpired({ inviteId: 'legacy' }), false);
    const past = { expiresAt: Date.now() - 1 };
    assert.equal(isInviteExpired(past), true);
    assert.throws(() => assertInviteNotExpired(past), { code: 'EXPIRED' });
    assert.throws(() => assertExpiresAtInFuture(Date.now() - 1), { code: 'BAD_REQUEST' });
    assert.equal(inviteHttpStatus({ code: 'EXPIRED', message: 'This invitation has expired' }), 410);
    assert.equal(inviteHttpBody({ code: 'EXPIRED', message: 'gone', expiresAt: 10 }).expired, true);
  });

  it('formats a 7-day remaining window', () => {
    const now = 1_700_000_000_000;
    const label = formatInviteExpiryLabel({ expiresAt: now + DEFAULT_INVITE_TTL_MS }, now);
    assert.equal(label, 'Expires in 7 days');
    assert.equal(formatInviteExpiryLabel({ expiresAt: now - 1 }, now), 'Expired');
    assert.equal(formatInviteExpiryLabel({}), '');
  });
});
