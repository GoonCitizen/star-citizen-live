'use strict';

/**
 * Expiration for shareable GoonCitizen invitation strings
 * (opaque `fabric:` GroupOffer / FederationContractInvite).
 *
 * New clips stamp `expiresAt` (default 7 days). Legacy clips without the
 * field remain valid. Ingest and accept refuse a present, past timestamp.
 */

const DEFAULT_INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_INVITE_TTL_MS = 365 * 24 * 60 * 60 * 1000;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Canonical expire timestamp as epoch milliseconds.
 * Accepts a number (ms) or an ISO-8601 string. Missing / empty → null.
 * @param {unknown} value
 * @returns {number|null}
 */
function normalizeInviteExpiresAtMs (value) {
  if (value == null || value === '') return null;
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    return Math.floor(value);
  }
  if (typeof value === 'string') {
    const t = value.trim();
    if (!t) return null;
    if (/^\d+(\.\d+)?$/.test(t)) {
      const n = Number(t);
      if (Number.isFinite(n) && n > 0) return Math.floor(n);
      return null;
    }
    const parsed = Date.parse(t);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }
  return null;
}

/**
 * @param {number} n
 * @returns {number}
 */
function clampInviteTtlMs (n) {
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_INVITE_TTL_MS;
  return Math.min(Math.max(Math.floor(n), 1), MAX_INVITE_TTL_MS);
}

/**
 * Relative TTL from HTTP / Share opts. Explicit `expiresAt` is handled by
 * {@link resolveShareExpiresAtMs}.
 * @param {object} [opts]
 * @returns {number|null} ttl ms, or null when the caller supplied expiresAt
 */
function relativeInviteTtlMs (opts = {}) {
  if (opts.expiresAt != null && opts.expiresAt !== '') return null;
  if (opts.ttlMs != null && opts.ttlMs !== '') return clampInviteTtlMs(Number(opts.ttlMs));
  if (opts.expiresInMs != null && opts.expiresInMs !== '') {
    return clampInviteTtlMs(Number(opts.expiresInMs));
  }
  if (opts.expiresInSeconds != null && opts.expiresInSeconds !== '') {
    return clampInviteTtlMs(Number(opts.expiresInSeconds) * 1000);
  }
  if (opts.expiresInDays != null && opts.expiresInDays !== '') {
    return clampInviteTtlMs(Number(opts.expiresInDays) * MS_PER_DAY);
  }
  return DEFAULT_INVITE_TTL_MS;
}

/**
 * Epoch ms when a new share / invite should expire.
 * @param {object} [opts]
 * @param {number} [now]
 * @returns {number}
 */
function resolveShareExpiresAtMs (opts = {}, now = Date.now()) {
  if (opts.expiresAt != null && opts.expiresAt !== '') {
    const exp = normalizeInviteExpiresAtMs(opts.expiresAt);
    if (exp == null) {
      const e = new Error('invalid expiresAt');
      e.code = 'BAD_REQUEST';
      throw e;
    }
    return exp;
  }
  let invitedAt = now;
  if (opts.invitedAt != null && Number.isFinite(Number(opts.invitedAt))) {
    invitedAt = Number(opts.invitedAt);
  } else if (opts.offeredAt != null) {
    const parsed = Date.parse(opts.offeredAt);
    if (Number.isFinite(parsed)) invitedAt = parsed;
  }
  return invitedAt + relativeInviteTtlMs(opts);
}

/**
 * @param {object} record GroupOffer, FederationContractInvite, or API payload
 * @returns {number|null}
 */
function recordExpiresAtMs (record) {
  if (!record || typeof record !== 'object') return null;
  if (record.expiresAt != null) return normalizeInviteExpiresAtMs(record.expiresAt);
  const offer = record.offer;
  if (offer && offer.expiresAt != null) return normalizeInviteExpiresAtMs(offer.expiresAt);
  const invite = record.invite;
  if (invite && invite.expiresAt != null) return normalizeInviteExpiresAtMs(invite.expiresAt);
  const refs = record.refs;
  if (refs && refs.expiresAt != null) return normalizeInviteExpiresAtMs(refs.expiresAt);
  return null;
}

/**
 * @param {object} record
 * @param {number} [now]
 * @returns {boolean}
 */
function isInviteExpired (record, now = Date.now()) {
  const exp = recordExpiresAtMs(record);
  if (exp == null) return false;
  return now > exp;
}

/**
 * @param {number} expiresAtMs
 * @param {number} [now]
 */
function assertExpiresAtInFuture (expiresAtMs, now = Date.now()) {
  if (!(Number.isFinite(expiresAtMs) && expiresAtMs > now)) {
    const e = new Error('expiresAt must be in the future');
    e.code = 'BAD_REQUEST';
    throw e;
  }
  return expiresAtMs;
}

/**
 * @param {object} record
 * @param {number} [now]
 * @returns {object} record
 */
function assertInviteNotExpired (record, now = Date.now()) {
  if (!isInviteExpired(record, now)) return record;
  const exp = recordExpiresAtMs(record);
  const e = new Error('This invitation has expired');
  e.code = 'EXPIRED';
  e.expiresAt = exp;
  throw e;
}

/**
 * @param {Error} err
 * @returns {number}
 */
function inviteHttpStatus (err) {
  if (!err) return 500;
  if (err.code === 'EXPIRED') return 410;
  if (err.code === 'FORBIDDEN') return 403;
  if (err.code === 'NOT_FOUND') return 404;
  if (err.code === 'UNAVAILABLE') return 503;
  return 400;
}

/**
 * @param {Error} err
 * @returns {object}
 */
function inviteHttpBody (err) {
  const body = { error: (err && err.message) || 'request failed' };
  if (err && err.code === 'EXPIRED') {
    body.expired = true;
    if (err.expiresAt) body.expiresAt = new Date(err.expiresAt).toISOString();
  }
  return body;
}

/**
 * Short label for Share notices and Notifications.
 * @param {object} record
 * @param {number} [now]
 * @returns {string}
 */
function formatInviteExpiryLabel (record, now = Date.now()) {
  const exp = recordExpiresAtMs(record);
  if (exp == null) return '';
  if (now > exp) return 'Expired';
  const days = Math.max(0, Math.round((exp - now) / MS_PER_DAY));
  if (days <= 0) return 'Expires today';
  if (days === 1) return 'Expires in 1 day';
  if (days <= 14) return 'Expires in ' + days + ' days';
  return 'Expires ' + new Date(exp).toISOString().slice(0, 10);
}

/**
 * ISO-8601 for GroupOffer `expiresAt` (matches `offeredAt`).
 * @param {number} ms
 * @returns {string}
 */
function expiresAtIso (ms) {
  return new Date(ms).toISOString();
}

module.exports = {
  DEFAULT_INVITE_TTL_MS,
  MAX_INVITE_TTL_MS,
  normalizeInviteExpiresAtMs,
  clampInviteTtlMs,
  relativeInviteTtlMs,
  resolveShareExpiresAtMs,
  recordExpiresAtMs,
  isInviteExpired,
  assertExpiresAtInFuture,
  assertInviteNotExpired,
  inviteHttpStatus,
  inviteHttpBody,
  formatInviteExpiryLabel,
  expiresAtIso
};
