'use strict';

/**
 * Shared Fabric application-namespace type names for GoonCitizen.
 * Prefer `@fabric/core/functions/applicationNamespaces` when linked; fall back
 * to a local mirror so tests/CI without a bleeding-edge core still boot.
 *
 * @see @fabric/core docs/APPLICATION_NAMESPACES.md
 */

let core = null;
try {
  core = require('@fabric/core/functions/applicationNamespaces');
} catch (_) {
  core = null;
}

const FALLBACK_CONTRACT_BODY_TYPES = Object.freeze({
  FederationContractInvite: 'FederationContractInvite',
  FederationContractInviteResponse: 'FederationContractInviteResponse',
  MissionCreated: 'MissionCreated',
  MissionBroadcast: 'MissionBroadcast',
  SCEventBatch: 'SCEventBatch',
  GroupChat: 'GroupChat',
  GroupChange: 'GroupChange',
  GroupShare: 'GroupShare'
});

const OUTER = (core && core.OUTER) || Object.freeze({
  P2P_CHAT_MESSAGE: 'P2P_CHAT_MESSAGE',
  CHAT_MESSAGE: 'ChatMessage',
  CONTRACT_PUBLISH: 'CONTRACT_PUBLISH',
  CONTRACT_MESSAGE: 'CONTRACT_MESSAGE',
  CONTRACT_PROPOSAL: 'CONTRACT_PROPOSAL'
});

const CONTRACT_BODY_TYPES = (core && core.CONTRACT_BODY_TYPES) || FALLBACK_CONTRACT_BODY_TYPES;

module.exports = {
  OUTER,
  CONTRACT_BODY_TYPES,
  isApplicationOuterType: core && core.isApplicationOuterType
    ? core.isApplicationOuterType.bind(core)
    : (name) => {
      const n = String(name || '');
      return n === OUTER.P2P_CHAT_MESSAGE
        || n === OUTER.CONTRACT_PUBLISH
        || n === OUTER.CONTRACT_MESSAGE
        || n === OUTER.CONTRACT_PROPOSAL
        || n === 'P2P_CONTRACT_PUBLISH'
        || n === 'P2P_CONTRACT_MESSAGE';
    },
  isKnownContractBodyType: core && core.isKnownContractBodyType
    ? core.isKnownContractBodyType.bind(core)
    : (type) => Object.prototype.hasOwnProperty.call(CONTRACT_BODY_TYPES, String(type || '')),
  fromCore: !!core
};
