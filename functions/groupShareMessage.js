'use strict';

/**
 * `fabric:` shares for GoonCitizen Groups and missions: one signed AMP frame,
 * written and read with `@fabric/core` `functions/fabricUri` (base64url).
 * Primary body: CONTRACT_MESSAGE / GroupShare / kind GroupOffer (embeds genesis).
 * Also classifies FederationContractInvite, group CONTRACT_PUBLISH, and
 * MissionBroadcast.
 */

const crypto = require('crypto');
const { encodeFabricUri, decodeFabricUri } = require('@fabric/core/functions/fabricUri');
const {
  isGroupContractDefinition,
  groupContractId
} = require('../contracts/gooncitizenGroup');
const { gooncitizenContractId } = require('../contracts/gooncitizen');
const {
  FEDERATION_CONTRACT_INVITE,
  parseFederationContractInviteLoose
} = require('./federationContractInvite');

const GROUP_SHARE_KIND_OFFER = 'GroupOffer';

/**
 * @param {Buffer|import('@fabric/core/types/message')} messageOrBuffer
 * @returns {string} `fabric:<base64url>`
 */
function buildOpaqueFabricUrl (messageOrBuffer) {
  return encodeFabricUri(messageOrBuffer);
}

/**
 * Read a `fabric:` share. A bad body hash or author signature is refused;
 * unsigned frames pass with `signed: false`.
 * @param {string} uri
 * @returns {{ ok: true, protocolUrl: string, hex: string, buffer: Buffer, message: object, signed: boolean, author: string|null } | { ok: false, error: string }}
 */
function parseOpaqueFabricMessage (uri) {
  const out = decodeFabricUri(String(uri || ''), {
    allowUnsigned: true,
    allowUnknownTypes: true
  });
  if (!out.ok) return { ok: false, error: out.error };
  return {
    ok: true,
    protocolUrl: encodeFabricUri(out.buffer),
    hex: out.buffer.toString('hex'),
    buffer: out.buffer,
    message: out.message,
    signed: out.signed,
    author: out.author
  };
}

/**
 * Build GroupShare / GroupOffer object (inner `object` of CONTRACT_MESSAGE).
 * @param {object} opts
 * @param {object} opts.group Group JSON (id, name, visibility, …)
 * @param {object} opts.definition GoonCitizenGroup genesis
 * @param {string} [opts.actor] Offerer pubkey
 * @param {string} [opts.note]
 * @param {string} [opts.offerId]
 * @param {string} [opts.offeredAt]
 * @param {string|number} [opts.expiresAt] ISO or epoch ms (default 7 days from offeredAt)
 * @param {number} [opts.ttlMs]
 * @param {number} [opts.expiresInDays]
 * @returns {object}
 */
function buildGroupOfferBody (opts = {}) {
  const group = opts.group || {};
  let definition = opts.definition;
  if (!definition || !isGroupContractDefinition(definition)) {
    throw new Error('buildGroupOfferBody requires a GoonCitizenGroup definition');
  }
  const contractId = group.contractId || groupContractId(definition);
  const groupId = String(group.id || definition.groupId || '').trim();
  if (!groupId) throw new Error('groupId required');
  const offerId = opts.offerId || crypto.randomBytes(16).toString('hex');
  const offeredAt = opts.offeredAt || new Date().toISOString();
  const {
    resolveShareExpiresAtMs,
    expiresAtIso
  } = require('./inviteExpiry');
  const expiresAt = expiresAtIso(resolveShareExpiresAtMs({
    offeredAt,
    expiresAt: opts.expiresAt,
    ttlMs: opts.ttlMs,
    expiresInMs: opts.expiresInMs,
    expiresInSeconds: opts.expiresInSeconds,
    expiresInDays: opts.expiresInDays
  }));
  return {
    kind: GROUP_SHARE_KIND_OFFER,
    offerId,
    groupId,
    contractId,
    definition,
    meta: definition.meta || {
      name: group.name,
      visibility: group.visibility,
      slug: group.slug || null,
      parentId: group.parentId || null
    },
    note: opts.note != null && String(opts.note).trim()
      ? String(opts.note).trim().slice(0, 2000)
      : null,
    offeredAt,
    expiresAt,
    offeredBy: opts.actor != null ? String(opts.actor).trim().toLowerCase() : null
  };
}

/**
 * CONTRACT_MESSAGE wire body for a GroupOffer.
 * @param {object} offerBody From {@link buildGroupOfferBody}
 * @param {string} actorPubkey
 * @returns {object}
 */
function buildGroupOfferContractMessage (offerBody, actorPubkey) {
  const contract = String(offerBody.contractId || '').trim() || gooncitizenContractId();
  const pubkey = String(actorPubkey || '').trim();
  return {
    contract,
    type: 'GroupShare',
    actor: { publicKey: pubkey, id: pubkey },
    object: offerBody
  };
}

function _parseMessageBody (message) {
  if (!message) return null;
  const Message = require('@fabric/core/types/message');
  const parsed = Message.tryParseLegacyBody(message);
  return parsed.ok ? parsed.value : null;
}

/**
 * Classify a parsed Message for group / mission share ingest.
 * @param {object} message Fabric Message
 * @returns {{
 *   kind: 'GroupOffer'|'FederationContractInvite'|'GroupPublish'|'MissionBroadcast'|'unknown',
 *   wireType: string|null,
 *   body: object|null,
 *   object: object|null,
 *   contractId: string|null,
 *   groupId: string|null,
 *   missionId: string|null
 * }}
 */
function classifyGroupShareMessage (message) {
  const wireType = message && (message.type || message.wireType) || null;
  const body = _parseMessageBody(message);
  if (!body || typeof body !== 'object') {
    return {
      kind: 'unknown',
      wireType,
      body: null,
      object: null,
      contractId: null,
      groupId: null,
      missionId: null
    };
  }

  if (wireType === 'CONTRACT_PUBLISH' || (body.name && isGroupContractDefinition(body))) {
    if (isGroupContractDefinition(body)) {
      return {
        kind: 'GroupPublish',
        wireType: wireType || 'CONTRACT_PUBLISH',
        body,
        object: body,
        contractId: groupContractId(body),
        groupId: body.groupId || null,
        missionId: null
      };
    }
  }

  const appType = body.type || null;
  const object = body.object != null ? body.object : body;
  const contractId = body.contract || (object && object.contractId) || null;

  // Mission offer clipboard (MissionBroadcast) or GroupShare-wrapped mission.
  const missionInner = (object && object.kind === 'MissionBroadcast' && object.object)
    ? object.object
    : object;
  const isMissionBroadcast = appType === 'MissionBroadcast' ||
    (missionInner && (missionInner['@type'] === 'MissionBroadcast' || missionInner.type === 'MissionBroadcast')) ||
    (object && object.kind === 'MissionBroadcast');
  if (isMissionBroadcast && missionInner) {
    const mission = missionInner.mission || missionInner;
    return {
      kind: 'MissionBroadcast',
      wireType: wireType || 'CONTRACT_MESSAGE',
      body,
      object: missionInner,
      contractId: contractId || gooncitizenContractId(),
      groupId: missionInner.groupId || (mission && mission.groupId) || null,
      missionId: missionInner.missionId || (mission && mission.id) || null
    };
  }

  if (appType === 'GroupShare' || (object && object.kind === GROUP_SHARE_KIND_OFFER)) {
    if (object && object.kind === GROUP_SHARE_KIND_OFFER) {
      return {
        kind: 'GroupOffer',
        wireType: wireType || 'CONTRACT_MESSAGE',
        body,
        object,
        contractId: object.contractId || contractId,
        groupId: object.groupId || null,
        missionId: null
      };
    }
  }

  const invite = parseFederationContractInviteLoose(object)
    || parseFederationContractInviteLoose(body);
  if (invite || appType === FEDERATION_CONTRACT_INVITE) {
    const inv = invite || object;
    return {
      kind: 'FederationContractInvite',
      wireType: wireType || 'CONTRACT_MESSAGE',
      body,
      object: inv,
      contractId: (inv && inv.contractId) || contractId,
      groupId: (inv && inv.groupId) || null,
      missionId: null
    };
  }

  return { kind: 'unknown', wireType, body, object, contractId, groupId: null, missionId: null };
}

module.exports = {
  GROUP_SHARE_KIND_OFFER,
  buildOpaqueFabricUrl,
  parseOpaqueFabricMessage,
  buildGroupOfferBody,
  buildGroupOfferContractMessage,
  classifyGroupShareMessage
};
