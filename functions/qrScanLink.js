'use strict';

/**
 * Read a scanned QR code or a `fabric:` link as a signer invitation: the
 * `DELEGATION_LINK_OFFER` frame another signer shows to pair
 * (`@fabric/core` docs/DELEGATION.md). The frame names its rendezvous, which
 * must be a Hub this app uses.
 */

const { readLinkOffer } = require('@fabric/core/types/delegation');
const { assertAllowedFabricHub } = require('./fabricHubAllowlist');

const NOT_AN_INVITATION = 'Not a signer invitation. Scan the code from Link a signer on the other app.';

/**
 * @param {string} text
 * @returns {{ ok: true, kind: 'delegation-invitation', invitation: string, rendezvous: string, label: string }|{ ok: false, error: string }}
 */
function interpretQrScan (text) {
  const raw = String(text || '').trim();
  if (!raw) return { ok: false, error: 'empty scan' };
  if (!/^fabric:/i.test(raw)) return { ok: false, error: NOT_AN_INVITATION };
  let read;
  try {
    read = readLinkOffer(raw);
  } catch (_) {
    return { ok: false, error: NOT_AN_INVITATION };
  }
  if (!read || !read.ok) {
    return { ok: false, error: read && /expired/i.test(String(read.error)) ? 'This invitation expired. Ask for a fresh one.' : NOT_AN_INVITATION };
  }
  const allowed = assertAllowedFabricHub(read.offer.origin);
  if (!allowed.ok) return { ok: false, error: `The invitation uses ${read.offer.origin}, which this app does not use.` };
  return { ok: true, kind: 'delegation-invitation', invitation: raw, rendezvous: allowed.hubBase, label: read.offer.label || '' };
}

/**
 * The invitation in a `fabric:` URL, or null when it is something else.
 * @param {string} url
 * @returns {string|null}
 */
function delegationInvitationFromUrl (url) {
  const read = interpretQrScan(url);
  return read.ok ? read.invitation : null;
}

module.exports = {
  interpretQrScan,
  delegationInvitationFromUrl
};
