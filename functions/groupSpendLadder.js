'use strict';

/**
 * Build Core contractTaproot spend policy from a Group.
 */

function groupSpendLadder (group, opts = {}) {
  const tap = require('@fabric/core/functions/contractTaproot');
  if (group && group.spendLadder) {
    return tap.normalizeContractSpendPolicy(group.spendLadder);
  }
  const validators = (group && Array.isArray(group.validators) && group.validators.length)
    ? group.validators
    : (group && group.proposedPolicy && group.proposedPolicy.validators) || (group && group.members) || [];
  const threshold = (group && group.proposedPolicy && group.proposedPolicy.threshold) != null
    ? group.proposedPolicy.threshold
    : (group && group.threshold) || 1;
  const publisher = (group && group.creator) || validators[0];
  return tap.synthesizeDefaultLadder({
    validators,
    threshold,
    publisher,
    network: opts.network || 'regtest',
    csvBlocks: opts.csvBlocks != null ? opts.csvBlocks : tap.DEFAULT_CSV_BLOCKS
  });
}

function groupTaprootWallet (group, opts = {}) {
  const tap = require('@fabric/core/functions/contractTaproot');
  const policy = groupSpendLadder(group, opts);
  const built = tap.buildContractTaproot(policy);
  return {
    groupId: group && group.id,
    address: built.address,
    network: built.network,
    threshold: policy.tiers[0] ? policy.tiers[0].threshold : 1,
    keys: policy.tiers[0] ? policy.tiers[0].keys.slice() : [],
    validators: (group && group.validators) || (group && group.proposedPolicy && group.proposedPolicy.validators) || [],
    members: (group && group.members) || [],
    mode: 'taproot',
    treasury: {
      role: 'alliance-treasury',
      surface: 'group-taproot',
      custody: 'org-node'
    },
    policy,
    leaves: built.leaves,
    internalPubkeyHex: built.internalPubkeyHex
  };
}

module.exports = {
  groupSpendLadder,
  groupTaprootWallet
};
