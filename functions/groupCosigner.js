'use strict';

/**
 * Group wallet cosigners. A signer's wallet key is their account cosigner key
 * (`m/87'/B'/n'/0/0`), never their identity key. Each member ties one to
 * their identity per group with a `cosigner.set` GroupChange carrying:
 *
 * - `proof`: the cosigner key's signature over (scope, identity, cosigner)
 *   (`@fabric/core` `cosignerProof`), so nobody can claim a key they don't hold;
 * - `endorsement`: the identity key's signature over the same, so a journal
 *   record proves itself without the frame it arrived in.
 *
 * The scope is `group:<contractId>`, so a proof can't be replayed into
 * another group.
 */

const accountKeys = require('@fabric/core/functions/accountKeys');
const signingTags = require('@fabric/core/functions/signingTags');
const Key = require('@fabric/core/types/key');
const { pubkeyXOnly } = require('@fabric/core/functions/pubkey');

const COMPRESSED = /^0[23][0-9a-f]{64}$/;

/**
 * @param {Object|string} group Group (uses `contractId`, else `id`) or contract id.
 * @returns {string}
 */
function cosignerScope (group) {
  const id = typeof group === 'string' ? group : (group && (group.contractId || group.id));
  if (!id) throw new TypeError('group contract id required');
  return `group:${id}`;
}

/** @private */
function endorsementMessage (scope, member, cosigner) {
  return `fabric-cosigner-endorse:1\n${scope}\n${member}\n${cosigner}`;
}

/**
 * Build the `cosigner.set` record for a member.
 * @param {Object} params
 * @param {Key} params.identityKey Member identity key (private).
 * @param {Key} params.cosignerKey Member cosigner key (private).
 * @param {Object|string} params.group Group or contract id.
 * @param {string} params.network Bitcoin network the cosigner key belongs to.
 * @returns {{ member: string, cosigner: string, proof: string, endorsement: string, network: string }}
 */
function createGroupCosigner ({ identityKey, cosignerKey, group, network }) {
  if (!identityKey || !identityKey.private) throw new TypeError('identity private key required');
  if (!cosignerKey || !cosignerKey.private) throw new TypeError('cosigner private key required');
  const scope = cosignerScope(group);
  const member = String(identityKey.pubkey).toLowerCase();
  const cosigner = String(cosignerKey.pubkey).toLowerCase();
  const proof = accountKeys.cosignerProof(cosignerKey, { identityPubkey: member, scope });
  const endorsement = Buffer.from(identityKey.signSchnorr(
    endorsementMessage(scope, member, cosigner),
    signingTags.PASSPORT_COSIGNER
  )).toString('hex');
  return { member, cosigner, proof, endorsement, network: accountKeys.normalizeAccountNetwork(network) };
}

/**
 * Check a `cosigner.set` record: both signatures, under the group's scope.
 * @param {Object} record `{ member, cosigner, proof, endorsement, network }`
 * @param {Object|string} group Group or contract id.
 * @returns {boolean}
 */
function verifyGroupCosigner (record, group) {
  try {
    if (!record) return false;
    const member = String(record.member || '').toLowerCase();
    const cosigner = String(record.cosigner || '').toLowerCase();
    if (!COMPRESSED.test(member) || !COMPRESSED.test(cosigner) || member === cosigner) return false;
    accountKeys.normalizeAccountNetwork(record.network);
    const scope = cosignerScope(group);
    if (!accountKeys.verifyCosignerProof({ cosigner, identityPubkey: member, scope, proof: record.proof })) return false;
    const sig = Buffer.from(String(record.endorsement || ''), 'hex');
    if (sig.length !== 64) return false;
    return new Key({ public: member }).verifySchnorr(
      endorsementMessage(scope, member, cosigner),
      sig,
      signingTags.PASSPORT_COSIGNER
    );
  } catch (_) {
    return false;
  }
}

/**
 * A member's cosigner key for a network from a group's `cosigners` map
 * (`{ <x-only member>: { <network>: record } }`).
 * @param {Object} group
 * @param {string} member Identity pubkey.
 * @param {string} network
 * @returns {string|null} compressed cosigner pubkey
 */
function groupCosignerFor (group, member, network) {
  const map = group && group.cosigners;
  if (!map || !member) return null;
  const entry = map[pubkeyXOnly(member)];
  const record = entry && entry[String(network || '').toLowerCase()];
  return record && record.cosigner ? String(record.cosigner).toLowerCase() : null;
}

module.exports = {
  cosignerScope,
  createGroupCosigner,
  verifyGroupCosigner,
  groupCosignerFor
};
