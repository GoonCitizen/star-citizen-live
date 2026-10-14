'use strict';

/**
 * Shared device-link UX / expiry helpers (no Hub HTTP, no identity keys).
 * Hub sessions last SESSION_TTL_MS (30 min). Local QR + approval cards use a
 * shorter TTL so a hung poll or overlay cannot outlive the ceremony.
 */

const DEVICE_LINK_OFFER_TTL_MS = 10 * 60 * 1000;
const DEVICE_LINK_PROMPT_TTL_MS = 10 * 60 * 1000;
const DEVICE_LINK_APPROVE_TIMEOUT_MS = 25 * 1000;

function stampCreatedAt (obj, now) {
  if (!obj || typeof obj !== 'object') return obj;
  if (!obj.createdAt) obj.createdAt = now || Date.now();
  return obj;
}

function isDeviceLinkOfferExpired (offer, now) {
  if (!offer) return true;
  const t = Number(offer.createdAt) || 0;
  if (!t) return false;
  return (now || Date.now()) - t > DEVICE_LINK_OFFER_TTL_MS;
}

function isDeviceLinkPromptExpired (prompt, now) {
  if (!prompt) return true;
  const t = Number(prompt.createdAt) || 0;
  if (!t) return false;
  return (now || Date.now()) - t > DEVICE_LINK_PROMPT_TTL_MS;
}

function isStaleDeviceLinkError (res) {
  if (!res) return false;
  if (res.expired) return true;
  const status = Number(res.status);
  if (status === 404 || status === 410) return true;
  const err = String(res.error || '');
  return /unknown or expired|no pending device-link/i.test(err);
}

function isDeviceLinkLockedError (res) {
  return !!(res && /Identity is locked/i.test(String(res.error || '')));
}

module.exports = {
  DEVICE_LINK_OFFER_TTL_MS,
  DEVICE_LINK_PROMPT_TTL_MS,
  DEVICE_LINK_APPROVE_TIMEOUT_MS,
  stampCreatedAt,
  isDeviceLinkOfferExpired,
  isDeviceLinkPromptExpired,
  isStaleDeviceLinkError,
  isDeviceLinkLockedError
};
