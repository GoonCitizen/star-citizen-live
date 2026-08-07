'use strict';

/**
 * Group Contract State tip attestation — wraps Core `contractStateSigning`
 * with Group roster helpers (members / threshold via {@link Group}).
 *
 * Protocol tip string is `@fabric/core` `ContractStateTip` (canonical JSON).
 * Hub tracks the same module for contract-namespace sidechains.
 */

const {
  CONTRACT_STATE_TIP_KIND,
  signingStringForContractStateTip,
  tipMessageBuffer,
  signContractStateTip: signContractStateTipCore,
  verifyContractStateTip: verifyContractStateTipCore,
  mergeTipSignatures,
  tipDigestHex
} = require('@fabric/core/functions/contractStateSigning');
const { keyFromIdentity } = require('./identity');
const Group = require('../types/Group');

/**
 * Canonical tip message members Schnorr-sign (Core ContractStateTip).
 * @param {string} contractId
 * @param {number} clock
 * @param {string} stateDigest
 * @returns {string}
 */
function signingStringForGroupState (contractId, clock, stateDigest) {
  return signingStringForContractStateTip({ contractId, clock, stateDigest });
}

/**
 * Sign a state tip with one member identity (BIP340 Schnorr).
 * @param {object} identity Decrypted identity with xprv/mnemonic
 * @param {string} contractId
 * @param {number} clock
 * @param {string} stateDigest
 * @returns {{ pubkey: string, signature: string, message: string }}
 */
function signGroupStateTip (identity, contractId, clock, stateDigest) {
  const key = keyFromIdentity(identity);
  return signContractStateTipCore(key, contractId, clock, stateDigest);
}

/**
 * Verify k-of-n member Schnorr tip signatures against a Group roster.
 * Prefers Core federation-witness verify; falls back to Group.verifyMultiSignature.
 * @param {Group|object} group Group instance or JSON with members/threshold
 * @param {string} contractId
 * @param {number} clock
 * @param {string} stateDigest
 * @param {{ [pubkey: string]: string }} signatures
 * @returns {boolean}
 */
function verifyGroupStateTip (group, contractId, clock, stateDigest, signatures) {
  if (!signatures || typeof signatures !== 'object') return false;
  const g = group instanceof Group
    ? group
    : new Group(group || {});
  const members = (g.members || []).slice();
  const thr = g.threshold;
  if (verifyContractStateTipCore(members, thr, contractId, clock, stateDigest, signatures)) {
    return true;
  }
  // Legacy path: Group.verifyMultiSignature over the same tip UTF-8.
  const message = signingStringForGroupState(contractId, clock, stateDigest);
  return g.verifyMultiSignature({ message, signatures }, thr) === true;
}

/**
 * Compact Fabric-identity view of a group (contract Actor + local id/name).
 * @param {object} group Group JSON
 * @returns {{ id: string|null, groupId: string|null, name: string|null, commitment: string|null, threshold: number, members: string[] }}
 */
function groupFabricIdentity (group) {
  if (!group || typeof group !== 'object') {
    return { id: null, groupId: null, name: null, commitment: null, threshold: 1, members: [] };
  }
  const g = group instanceof Group ? group : new Group(group);
  return {
    id: g.contractId || null,
    groupId: g.id || null,
    name: g.name || null,
    commitment: g.commitment(),
    threshold: g.threshold,
    members: (g.members || []).slice()
  };
}

module.exports = {
  CONTRACT_STATE_TIP_KIND,
  signingStringForContractStateTip,
  signingStringForGroupState,
  tipMessageBuffer,
  signContractStateTip: signContractStateTipCore,
  signGroupStateTip,
  verifyContractStateTip: verifyContractStateTipCore,
  verifyGroupStateTip,
  mergeTipSignatures,
  groupFabricIdentity,
  tipDigestHex
};
