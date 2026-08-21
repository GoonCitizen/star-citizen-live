'use strict';

/**
 * GoonCitizen application-namespace types.
 * Merges `@fabric/core` generic ARC types with product-local body types
 * (missions, gameplay batches, share envelopes, activity trees).
 *
 * @see @fabric/core docs/APPLICATION_NAMESPACES.md
 */

let core;
try {
  core = require('@fabric/core/functions/applicationNamespaces');
} catch (_) {
  core = {
    OUTER: Object.freeze({
      P2P_CHAT_MESSAGE: 'P2P_CHAT_MESSAGE',
      CHAT_MESSAGE: 'ChatMessage',
      CONTRACT_PUBLISH: 'CONTRACT_PUBLISH',
      CONTRACT_MESSAGE: 'CONTRACT_MESSAGE',
      CONTRACT_PROPOSAL: 'CONTRACT_PROPOSAL'
    }),
    CONTRACT_BODY_TYPES: Object.freeze({
      FederationContractInvite: 'FederationContractInvite',
      FederationContractInviteResponse: 'FederationContractInviteResponse',
      GroupChat: 'GroupChat',
      GroupChange: 'GroupChange',
      GroupChangeProposal: 'GroupChangeProposal',
      GroupChangeVote: 'GroupChangeVote',
      GroupJournalRequest: 'GroupJournalRequest',
      GroupJournalBatch: 'GroupJournalBatch',
      GroupStateJournal: 'GroupStateJournal',
      ContractCapabilityGrant: 'ContractCapabilityGrant',
      ContractWithdrawalRequest: 'ContractWithdrawalRequest',
      ContractWithdrawalWitness: 'ContractWithdrawalWitness',
      MessageReceived: 'MessageReceived',
      MessageReceipt: 'MessageReceipt'
    }),
    ACTIVITY_TYPES: Object.freeze({}),
    LOG_TYPES: Object.freeze({
      ContractPublish: 'ContractPublish',
      ContractMessage: 'ContractMessage'
    }),
    isApplicationOuterType: function isApplicationOuterType (name) {
      const n = String(name || '');
      return n === 'P2P_CHAT_MESSAGE' || n === 'CONTRACT_PUBLISH' ||
        n === 'CONTRACT_MESSAGE' || n === 'CONTRACT_PROPOSAL';
    }
  };
}

/** Product-only CONTRACT_MESSAGE body types (not in @fabric/core). */
const APP_CONTRACT_BODY_TYPES = Object.freeze({
  MissionCreated: 'MissionCreated',
  MissionBroadcast: 'MissionBroadcast',
  /**
   * Completion claim / officer decision. Not frozen into genesis messageTypes
   * (would move the network contract id). Ride CONTRACT_MESSAGE like NoteShare.
   */
  MissionClaim: 'MissionClaim',
  MissionClaimDecision: 'MissionClaimDecision',
  SCEventBatch: 'SCEventBatch',
  GameStateSnapshot: 'GameStateSnapshot',
  GroupShare: 'GroupShare',
  GroupActivityTree: 'GroupActivityTree',
  FleetShare: 'FleetShare',
  /** Legacy 1:1 mesh chat (migrate toward pair ARC + GroupChat). */
  DirectChat: 'DirectChat',
  /** Fallback if linked @fabric/core predates these names. */
  GroupChangeProposal: 'GroupChangeProposal',
  GroupChangeVote: 'GroupChangeVote',
  /**
   * Discord bot coordination (same Discord application, multiple operators).
   * Request → Claim (first-wins) → Response. Not frozen into gooncitizen genesis
   * messageTypes (would move the network contract id).
   */
  DiscordRequest: 'DiscordRequest',
  DiscordClaim: 'DiscordClaim',
  DiscordResponse: 'DiscordResponse',
  /**
   * Chat `/lookup` coordination — master local report (players, public groups /
   * fleets, peers, Discord catalog, local tag names).
   * Request → Claim (first-wins) → Response. Not frozen into genesis messageTypes.
   */
  LookupRequest: 'LookupRequest',
  LookupClaim: 'LookupClaim',
  LookupResponse: 'LookupResponse',
  /**
   * Identity note share / update. Private on the authoring node until shared
   * with a Federation group or a peer. Not frozen into genesis messageTypes.
   */
  NoteShare: 'NoteShare',
  NoteUpdate: 'NoteUpdate',
  /**
   * Group-scoped data sync on Federation contracts. Pack-typed envelope so
   * chat catalogs/messages (`chat.*`, Discord first) and opt-in profile
   * play times (`profile.playtimes`) / published file listings (`profile.files`)
   * merge into one world view. Not frozen
   * into genesis messageTypes. Legacy DiscordCatalogShare still ingested as
   * `chat.catalog` with platform discord.
   */
  GroupDataShare: 'GroupDataShare',
  /**
   * Group-scoped Discord guild catalog gossip. Operators with a bot publish a
   * compact snapshot; members without Discord credentials merge it locally.
   * Not frozen into genesis messageTypes. Prefer GroupDataShare for new publishes.
   */
  DiscordCatalogShare: 'DiscordCatalogShare',
  /**
   * Mutual device identity cross-sign (D-013 network). Gossiped after the
   * `/device-links` pairing ceremony so peers can union distinct device
   * pubkeys into one actor. Not frozen into genesis messageTypes.
   */
  IdentityCrossSign: 'IdentityCrossSign',
  IdentityCrossSignRevoke: 'IdentityCrossSignRevoke',
  /**
   * Cluster-gated account replay after device-link. Compact packs (profile,
   * groups, notes, local tags, bounded chat) on the GoonCitizen contract.
   * Not frozen into genesis messageTypes. Receivers apply only when the
   * signer is in the same IdentityCluster. Never carries seeds or tokens.
   */
  DeviceDataShare: 'DeviceDataShare',
  /**
   * Federation group voice presence. Ephemeral; not frozen into genesis
   * messageTypes and not Statechain-journaled. SDP/ICE is Hub WebRTC, not these frames.
   */
  GroupVoiceJoin: 'GroupVoiceJoin',
  GroupVoiceLeave: 'GroupVoiceLeave',
  GroupVoiceSpeaking: 'GroupVoiceSpeaking'
});

const CONTRACT_BODY_TYPES = Object.freeze(Object.assign(
  {},
  core.CONTRACT_BODY_TYPES,
  APP_CONTRACT_BODY_TYPES
));

const ACTIVITY_TYPES = Object.freeze(Object.assign({}, core.ACTIVITY_TYPES, {
  GameStateSnapshot: 'GameStateSnapshot'
}));

function isKnownContractBodyType (type) {
  return Object.prototype.hasOwnProperty.call(CONTRACT_BODY_TYPES, String(type || ''));
}

module.exports = {
  OUTER: core.OUTER,
  CONTRACT_BODY_TYPES,
  APP_CONTRACT_BODY_TYPES,
  ACTIVITY_TYPES,
  LOG_TYPES: core.LOG_TYPES,
  isApplicationOuterType: core.isApplicationOuterType.bind(core),
  isKnownContractBodyType,
  fromCore: true
};
