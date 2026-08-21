'use strict';

/**
 * Thin re-export — invite JSON parse/build lives in `@fabric/http`.
 * Hub and GoonCitizen share one FederationContractInvite shape (incl. group labels).
 *
 * GoonCitizen stamps `expiresAt` (default 7 days) even when the http pin's
 * builder does not yet know the field.
 *
 * @see @fabric/http/functions/federationContractInvite
 */

const http = require('@fabric/http/functions/federationContractInvite');

const DEFAULT_FEDERATION_INVITE_TTL_MS = http.DEFAULT_FEDERATION_INVITE_TTL_MS
  || (7 * 24 * 60 * 60 * 1000);

function stampExpiresAt (doc, fields) {
  if (!doc || typeof doc !== 'object') return doc;
  if (doc.expiresAt != null && doc.expiresAt !== '') return doc;
  const invitedAt = doc.invitedAt != null && Number.isFinite(Number(doc.invitedAt))
    ? Number(doc.invitedAt)
    : Date.now();
  if (fields && fields.expiresAt != null && fields.expiresAt !== '') {
    const n = typeof fields.expiresAt === 'number'
      ? fields.expiresAt
      : Date.parse(fields.expiresAt);
    if (Number.isFinite(n) && n > 0) {
      doc.expiresAt = Math.floor(n);
      return doc;
    }
  }
  let ttl = DEFAULT_FEDERATION_INVITE_TTL_MS;
  if (fields && fields.ttlMs != null && Number.isFinite(Number(fields.ttlMs))) {
    ttl = Math.max(1, Math.floor(Number(fields.ttlMs)));
  }
  doc.expiresAt = invitedAt + ttl;
  return doc;
}

function buildFederationContractInviteJson (fields) {
  const json = http.buildFederationContractInviteJson(fields);
  const doc = JSON.parse(json);
  stampExpiresAt(doc, fields);
  return JSON.stringify(doc);
}

function buildFederationContractInvite (fields) {
  return JSON.parse(buildFederationContractInviteJson(fields));
}

module.exports = Object.assign({}, http, {
  DEFAULT_FEDERATION_INVITE_TTL_MS,
  buildFederationContractInviteJson,
  buildFederationContractInvite
});
