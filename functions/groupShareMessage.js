'use strict';

/**
 * Opaque Fabric Message encode/decode for GoonCitizen Group shares.
 *
 * Clipboard forms:
 * - `fabric:<payload>` — signed AMP Message bytes as base64 (default) or hex
 * - Legacy `fabric:base64,<b64>` / `fabric:b64,<b64>` is still accepted on decode
 *
 * The parser sniffs hex vs base64 from the body. Raw hex or base64 (no fabric:
 * prefix) is also accepted on decode.
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
const DISTINCTIVE_BASE64_RE = /[+/=_-]|[G-Zg-z]/;

/**
 * Share encoding for opaque `fabric:` URLs. Anything other than `'hex'` is base64.
 * @param {*} value
 * @returns {'hex'|'base64'}
 */
function normalizeOpaqueShareEncoding (value) {
  return String(value == null ? '' : value).trim().toLowerCase() === 'hex' ? 'hex' : 'base64';
}

function normalizeHex (s) {
  if (typeof s !== 'string') return '';
  let t = s.trim();
  if (t.startsWith('0x') || t.startsWith('0X')) t = t.slice(2);
  return t.replace(/\s+/g, '');
}

function normalizeBase64 (s) {
  if (typeof s !== 'string') return '';
  return s.trim().replace(/\s+/g, '').replace(/-/g, '+').replace(/_/g, '/');
}

/**
 * @param {Buffer|import('@fabric/core/types/message')} messageOrBuffer
 * @returns {Buffer}
 */
function bufferFromMessage (messageOrBuffer) {
  if (Buffer.isBuffer(messageOrBuffer)) return messageOrBuffer;
  if (messageOrBuffer && typeof messageOrBuffer.toBuffer === 'function') {
    return messageOrBuffer.toBuffer();
  }
  throw new TypeError('expected a Message or Buffer');
}

/**
 * @param {Buffer|import('@fabric/core/types/message')} messageOrBuffer
 * @param {Object} [opts]
 * @param {string} [opts.encoding] `'base64'` (default) or `'hex'`
 * @returns {string}
 */
function buildOpaqueFabricUrl (messageOrBuffer, opts = {}) {
  const buf = bufferFromMessage(messageOrBuffer);
  const encoding = normalizeOpaqueShareEncoding(opts.encoding);
  if (encoding === 'base64') {
    return 'fabric:' + buf.toString('base64');
  }
  return 'fabric:' + buf.toString('hex');
}

/**
 * Opaque `fabric:<body>` (no host). Structured `fabric://…` URLs are not opaque.
 * @param {string} raw
 * @returns {{ ok: true, payload: string } | { ok: false, error: string }}
 */
function extractOpaqueFabricPayload (raw) {
  const t = String(raw || '').trim();
  if (!t) return { ok: false, error: 'empty url' };
  if (!/^fabric:/i.test(t)) return { ok: false, error: 'not a fabric: url' };
  if (/^fabric:\/\//i.test(t)) return { ok: false, error: 'opaque fabric message has no host' };
  return { ok: true, payload: t.slice(t.indexOf(':') + 1) };
}

/**
 * @param {string} payload
 * @returns {{ body: string, hint: ('hex'|'base64'|null) }}
 */
function stripLegacyEncodingPrefix (payload) {
  const s = String(payload || '');
  const m = s.match(/^(base64|b64|hex)[,:](.*)$/i);
  if (!m) return { body: s, hint: null };
  return {
    body: m[2],
    hint: m[1].toLowerCase() === 'hex' ? 'hex' : 'base64'
  };
}

/**
 * @param {string} raw
 * @returns {{ ok: true, buffer: Buffer, encoding: string, hex: string } | { ok: false, error: string }}
 */
function tryDecodeHexPayload (raw) {
  const hex = normalizeHex(raw);
  if (!hex || hex.length % 2 !== 0 || !/^[0-9a-fA-F]+$/.test(hex)) {
    return { ok: false, error: 'invalid opaque hex' };
  }
  try {
    const buffer = Buffer.from(hex, 'hex');
    if (buffer.length < 32) return { ok: false, error: 'buffer too short for Fabric message' };
    return { ok: true, buffer, encoding: 'hex', hex };
  } catch (_) {
    return { ok: false, error: 'hex decode failed' };
  }
}

/**
 * Ordered decode candidates for an opaque body (hex vs base64 sniff).
 * @param {string} payload
 * @returns {Array<{ ok: true, buffer: Buffer, encoding: string, hex?: string }>}
 */
function opaquePayloadCandidates (payload) {
  const stripped = stripLegacyEncodingPrefix(payload);
  const body = stripped.body;
  const hint = stripped.hint;
  const asHex = tryDecodeHexPayload(body);
  const asB64 = tryDecodeBase64Payload(body);
  const out = [];
  const push = (item) => {
    if (item && item.ok) out.push(item);
  };
  if (hint === 'hex') {
    push(asHex);
    return out;
  }
  if (hint === 'base64') {
    push(asB64);
    return out;
  }
  const distinctiveB64 = DISTINCTIVE_BASE64_RE.test(body);
  if (distinctiveB64) {
    push(asB64);
    push(asHex);
    return out;
  }
  push(asHex);
  push(asB64);
  return out;
}

/**
 * @param {string} raw
 * @returns {{ ok: true, buffer: Buffer, encoding: string } | { ok: false, error: string }}
 */
function tryDecodeBase64Payload (raw) {
  const b64 = normalizeBase64(raw);
  if (!b64 || b64.length < 44 || !/^[A-Za-z0-9+/]+=*$/.test(b64)) {
    return { ok: false, error: 'invalid opaque base64' };
  }
  let buffer;
  try {
    buffer = Buffer.from(b64, 'base64');
  } catch (_) {
    return { ok: false, error: 'base64 decode failed' };
  }
  if (buffer.length < 32) return { ok: false, error: 'buffer too short for Fabric message' };
  return { ok: true, buffer, encoding: 'base64' };
}

/**
 * @param {string} urlStr
 * @returns {{ ok: true, hex: string, buffer?: Buffer, encoding: string } | { ok: false, error: string }}
 */
function parseOpaqueFabricUrl (urlStr) {
  const extracted = extractOpaqueFabricPayload(urlStr);
  if (!extracted.ok) return extracted;
  const candidates = opaquePayloadCandidates(extracted.payload);
  if (!candidates.length) return { ok: false, error: 'invalid fabric message encoding' };
  const first = candidates[0];
  return {
    ok: true,
    hex: first.hex || first.buffer.toString('hex'),
    buffer: first.buffer,
    encoding: first.encoding
  };
}

/**
 * @param {Buffer} buffer
 * @returns {{ ok: true, hex: string, base64: string, buffer: Buffer, message: object, encoding: string } | { ok: false, error: string }}
 */
function messageFromBuffer (buffer, encoding) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 32) {
    return { ok: false, error: 'buffer too short for Fabric message' };
  }
  try {
    const Message = require('@fabric/core/types/message');
    const message = Message.fromBuffer(buffer);
    return {
      ok: true,
      hex: buffer.toString('hex'),
      base64: buffer.toString('base64'),
      buffer,
      message,
      encoding: encoding || 'hex'
    };
  } catch (e) {
    return { ok: false, error: (e && e.message) ? String(e.message) : 'Message.fromBuffer failed' };
  }
}

/**
 * @param {string} hexOrUrlOrBase64
 * @returns {{ ok: true, hex: string, base64: string, buffer: Buffer, message: object, encoding: string } | { ok: false, error: string }}
 */
function parseOpaqueFabricMessage (hexOrUrlOrBase64) {
  if (typeof hexOrUrlOrBase64 !== 'string' || !hexOrUrlOrBase64.trim()) {
    return { ok: false, error: 'empty message' };
  }
  const raw = hexOrUrlOrBase64.trim();
  let payload = raw;
  if (/^fabric:/i.test(raw)) {
    const extracted = extractOpaqueFabricPayload(raw);
    if (!extracted.ok) return extracted;
    payload = extracted.payload;
  }

  const candidates = opaquePayloadCandidates(payload);
  let lastError = 'invalid fabric message encoding';
  for (const candidate of candidates) {
    const parsed = messageFromBuffer(candidate.buffer, candidate.encoding);
    if (parsed.ok) return parsed;
    lastError = parsed.error || lastError;
  }
  return { ok: false, error: lastError };
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
  normalizeBase64,
  normalizeOpaqueShareEncoding,
  buildOpaqueFabricUrl,
  parseOpaqueFabricUrl,
  parseOpaqueFabricMessage,
  buildGroupOfferBody,
  buildGroupOfferContractMessage,
  classifyGroupShareMessage
};
