'use strict';

/**
 * Thin re-export — invite JSON parse/build lives in `@fabric/http`.
 * Hub and GoonCitizen share one FederationContractInvite shape (incl. group labels).
 *
 * Invite expiry (`expiresAt`, default 7 days) is upstream as of http
 * `resolveFederationInviteExpiresAt`. The stamping shim below only runs on
 * pins predating that helper, so this file collapses to the bare module once
 * the lockfile moves.
 *
 * @see @fabric/http/functions/federationContractInvite
 */

const http = require('@fabric/http/functions/federationContractInvite');

const PIN_STAMPS_EXPIRES_AT = typeof http.resolveFederationInviteExpiresAt === 'function' &&
  typeof http.DEFAULT_FEDERATION_INVITE_TTL_MS === 'number';

const DEFAULT_FEDERATION_INVITE_TTL_MS = http.DEFAULT_FEDERATION_INVITE_TTL_MS
  || (7 * 24 * 60 * 60 * 1000);

function positiveEpochMs (value) {
  if (value == null || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function stampExpiresAt (doc, fields) {
  if (!doc || typeof doc !== 'object') return doc;
  if (doc.expiresAt != null && doc.expiresAt !== '') return doc;
  const invitedAt = positiveEpochMs(doc.invitedAt) ?? Date.now();
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

module.exports = PIN_STAMPS_EXPIRES_AT
  ? http
  : Object.assign({}, http, {
    DEFAULT_FEDERATION_INVITE_TTL_MS,
    buildFederationContractInviteJson,
    buildFederationContractInvite
  });
