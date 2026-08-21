'use strict';

/**
 * Sign / verify IdentityCrossSign bodies with the same Fabric identity
 * Schnorr helper Passport uses for site-login and device-link.
 * Canonical strings stay in `identityCrossSign.js` (browser-safe).
 */

const {
  buildFabricIdentitySignedPayload,
  verifyIdentitySchnorr
} = require('@fabric/http/functions/fabricSiteLoginVerify');
const {
  resolveFabricSigningIdentity
} = require('@fabric/http/functions/fabricIdentitySchnorr');
const { pubkeysMatch } = require('./identity');
const {
  SIGN_TYPE,
  REVOKE_TYPE,
  buildCrossSignMessage,
  buildRevokeMessage,
  buildCrossSignObject,
  buildRevokeObject,
  coerceCrossSignObject
} = require('./identityCrossSign');

function _messageFor (kind, rec) {
  if (kind === REVOKE_TYPE) {
    return buildRevokeMessage(rec.nonce, rec.localPubkey, rec.peerPubkey);
  }
  return buildCrossSignMessage(rec.nonce, rec.localPubkey, rec.peerPubkey);
}

/**
 * @param {object} identity unlocked Fabric Identity, HD Key, or Passport
 *   `{ privateKeyHex, xpub }` leaf. Canonical `localPubkey` is the Fabric
 *   signing key (`fabricKey.pubkey`), never Bech32 `identity.id` or the
 *   HD master pubkey.
 * @param {object} fields { peerPubkey, nonce, createdAt? }
 * @param {string} [kind] `IdentityCrossSign` or `IdentityCrossSignRevoke`.
 *   `createdAt` is not in the canonical signed string.
 */
function signCrossSign (identity, fields, kind = SIGN_TYPE) {
  if (kind !== SIGN_TYPE && kind !== REVOKE_TYPE) {
    throw new Error(`unknown cross-sign type: ${String(kind)}`);
  }
  if (!fields || typeof fields !== 'object') {
    throw new Error('cross-sign fields required (peerPubkey, nonce)');
  }
  const { fabricKey } = resolveFabricSigningIdentity(identity);
  const localPubkey = String(fabricKey.pubkey || '');
  const rec = {
    localPubkey,
    peerPubkey: fields.peerPubkey,
    nonce: fields.nonce,
    createdAt: fields.createdAt
  };
  const message = _messageFor(kind, rec);
  if (!message) throw new Error('invalid cross-sign fields');
  const signed = buildFabricIdentitySignedPayload(identity, message);
  const base = kind === REVOKE_TYPE
    ? buildRevokeObject(Object.assign({}, rec, signed))
    : buildCrossSignObject(Object.assign({}, rec, signed));
  return base;
}

/**
 * @param {object} object gossip / HTTP body
 * @param {string} [signerPubkey] AMP / envelope author when present
 * @returns {{ ok: true, kind: string, record: object }|{ ok: false, error: string }}
 */
function verifyCrossSignObject (object, _signerPubkey) {
  object = coerceCrossSignObject(object);
  if (!object || typeof object !== 'object') {
    return { ok: false, error: 'cross-sign object required' };
  }
  const kind = object.type || object['@type'];
  if (kind !== SIGN_TYPE && kind !== REVOKE_TYPE) {
    return { ok: false, error: 'unknown cross-sign type' };
  }
  const localPubkey = object.localPubkey || object.pubkeyHex;
  const peerPubkey = object.peerPubkey;
  const nonce = object.nonce;
  const message = _messageFor(kind, { localPubkey, peerPubkey, nonce });
  if (!message) return { ok: false, error: 'invalid cross-sign fields' };
  // Inner BIP340 is the identity proof (Passport / site-login construction).
  // AMP author is transport — hubs may re-wrap CONTRACT_MESSAGE for later-relay.
  const checked = verifyIdentitySchnorr(
    message,
    object.signature,
    object.pubkeyHex || localPubkey,
    object.identity
  );
  if (!checked.ok) return { ok: false, error: checked.error || 'signature failed' };
  if (!pubkeysMatch(checked.key && checked.key.pubkey, localPubkey) &&
    !pubkeysMatch(object.pubkeyHex, localPubkey)) {
    return { ok: false, error: 'pubkey does not match localPubkey' };
  }
  return {
    ok: true,
    kind,
    record: {
      type: kind,
      localPubkey,
      peerPubkey,
      nonce,
      createdAt: object.createdAt || null,
      pubkeyHex: object.pubkeyHex || localPubkey
    }
  };
}

module.exports = {
  signCrossSign,
  verifyCrossSignObject
};
