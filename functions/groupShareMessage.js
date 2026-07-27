'use strict';

/**
 * Opaque Fabric Message encode/decode for GoonCitizen Group shares.
 *
 * Clipboard form: `fabric:<hex>` of a signed AMP Message (Message.toBuffer).
 * Primary body: CONTRACT_MESSAGE / GroupShare / kind GroupOffer (embeds genesis).
 * Also classifies FederationContractInvite and group CONTRACT_PUBLISH.
 */

const crypto = require('crypto');
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

function normalizeHex (s) {
  if (typeof s !== 'string') return '';
  let t = s.trim();
  if (t.startsWith('0x') || t.startsWith('0X')) t = t.slice(2);
  return t;
}

/**
 * @param {Buffer|import('@fabric/core/types/message')} messageOrBuffer
 * @returns {string}
 */
function buildOpaqueFabricUrl (messageOrBuffer) {
  let buf;
  if (Buffer.isBuffer(messageOrBuffer)) {
    buf = messageOrBuffer;
  } else if (messageOrBuffer && typeof messageOrBuffer.toBuffer === 'function') {
    buf = messageOrBuffer.toBuffer();
  } else {
    throw new TypeError('buildOpaqueFabricUrl requires a Message or Buffer');
  }
  return 'fabric:' + buf.toString('hex');
}

/**
 * @param {string} urlStr
 * @returns {{ ok: true, hex: string } | { ok: false, error: string }}
 */
function parseOpaqueFabricUrl (urlStr) {
  if (typeof urlStr !== 'string' || !urlStr.trim()) {
    return { ok: false, error: 'empty url' };
  }
  const raw = urlStr.trim();
  // Fast path: fabric:<hex> without //
  if (/^fabric:[0-9a-fA-F]+$/i.test(raw) && !raw.includes('//')) {
    const hex = normalizeHex(raw.slice('fabric:'.length));
    if (!hex || hex.length % 2 !== 0) return { ok: false, error: 'invalid opaque hex' };
    return { ok: true, hex };
  }
  try {
    const url = new URL(raw);
    if (url.protocol !== 'fabric:') return { ok: false, error: 'not a fabric: url' };
    if (url.hostname) return { ok: false, error: 'opaque fabric message has no host' };
    const pathHex = url.pathname ? String(url.pathname).replace(/^\//, '') : '';
    const hex = normalizeHex(pathHex);
    if (!hex || hex.length % 2 !== 0 || !/^[0-9a-fA-F]+$/.test(hex)) {
      return { ok: false, error: 'invalid opaque hex' };
    }
    return { ok: true, hex };
  } catch (_) {
    return { ok: false, error: 'invalid fabric: url' };
  }
}

/**
 * @param {string} hexOrUrl
 * @returns {{ ok: true, hex: string, buffer: Buffer, message: object } | { ok: false, error: string }}
 */
function parseOpaqueFabricMessage (hexOrUrl) {
  let hex = null;
  const asUrl = parseOpaqueFabricUrl(hexOrUrl);
  if (asUrl.ok) hex = asUrl.hex;
  else {
    const norm = normalizeHex(hexOrUrl);
    if (norm && norm.length % 2 === 0 && /^[0-9a-fA-F]+$/.test(norm)) hex = norm;
  }
  if (!hex) return { ok: false, error: asUrl.error || 'invalid hex' };
  let buffer;
  try {
    buffer = Buffer.from(hex, 'hex');
  } catch (_) {
    return { ok: false, error: 'hex decode failed' };
  }
  if (buffer.length < 32) return { ok: false, error: 'buffer too short for Fabric message' };
  try {
    const Message = require('@fabric/core/types/message');
    const message = Message.fromBuffer(buffer);
    return { ok: true, hex, buffer, message };
  } catch (e) {
    return { ok: false, error: (e && e.message) ? String(e.message) : 'Message.fromBuffer failed' };
  }
}

/**
 * Build GroupShare / GroupOffer object (inner `object` of CONTRACT_MESSAGE).
 * @param {object} opts
 * @param {object} opts.group Group JSON (id, name, visibility, …)
 * @param {object} opts.definition GoonCitizenGroup genesis
 * @param {string} [opts.actor] Offerer pubkey
 * @param {string} [opts.note]
 * @param {string} [opts.offerId]
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
    offeredAt: opts.offeredAt || new Date().toISOString(),
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
  const raw = message.raw && message.raw.data
    ? (Buffer.isBuffer(message.raw.data) ? message.raw.data : Buffer.from(message.raw.data))
    : null;
  const text = raw
    ? raw.toString('utf8')
    : (typeof message.data === 'string' ? message.data : '');
  if (!text || !text.trim().startsWith('{')) return null;
  try {
    return JSON.parse(text);
  } catch (_) {
    return null;
  }
}

/**
 * Classify a parsed Message for group share ingest.
 * @param {object} message Fabric Message
 * @returns {{
 *   kind: 'GroupOffer'|'FederationContractInvite'|'GroupPublish'|'unknown',
 *   wireType: string|null,
 *   body: object|null,
 *   object: object|null,
 *   contractId: string|null,
 *   groupId: string|null
 * }}
 */
function classifyGroupShareMessage (message) {
  const wireType = message && (message.type || message.wireType) || null;
  const body = _parseMessageBody(message);
  if (!body || typeof body !== 'object') {
    return { kind: 'unknown', wireType, body: null, object: null, contractId: null, groupId: null };
  }

  if (wireType === 'CONTRACT_PUBLISH' || (body.name && isGroupContractDefinition(body))) {
    if (isGroupContractDefinition(body)) {
      return {
        kind: 'GroupPublish',
        wireType: wireType || 'CONTRACT_PUBLISH',
        body,
        object: body,
        contractId: groupContractId(body),
        groupId: body.groupId || null
      };
    }
  }

  const appType = body.type || null;
  const object = body.object != null ? body.object : body;
  const contractId = body.contract || (object && object.contractId) || null;

  if (appType === 'GroupShare' || (object && object.kind === GROUP_SHARE_KIND_OFFER)) {
    if (object && object.kind === GROUP_SHARE_KIND_OFFER) {
      return {
        kind: 'GroupOffer',
        wireType: wireType || 'CONTRACT_MESSAGE',
        body,
        object,
        contractId: object.contractId || contractId,
        groupId: object.groupId || null
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
      groupId: null
    };
  }

  return { kind: 'unknown', wireType, body, object, contractId, groupId: null };
}

module.exports = {
  GROUP_SHARE_KIND_OFFER,
  normalizeHex,
  buildOpaqueFabricUrl,
  parseOpaqueFabricUrl,
  parseOpaqueFabricMessage,
  buildGroupOfferBody,
  buildGroupOfferContractMessage,
  classifyGroupShareMessage
};
