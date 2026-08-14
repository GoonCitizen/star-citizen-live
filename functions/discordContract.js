'use strict';

/**
 * Discord bot coordination over GoonCitizen CONTRACT_MESSAGE frames.
 *
 * Multiple operators of the same Discord application publish inbound user
 * traffic as DiscordRequest, race DiscordClaim (first-claim-wins), then
 * publish DiscordResponse. Auditors reconstruct the sequence from the mesh
 * log / local journal without colliding on Discord replies.
 */

const crypto = require('crypto');
const Actor = require('@fabric/core/types/actor');
const { APP_CONTRACT_BODY_TYPES } = require('../contracts/applicationMessageTypes');

const DISCORD_REQUEST = APP_CONTRACT_BODY_TYPES.DiscordRequest || 'DiscordRequest';
const DISCORD_CLAIM = APP_CONTRACT_BODY_TYPES.DiscordClaim || 'DiscordClaim';
const DISCORD_RESPONSE = APP_CONTRACT_BODY_TYPES.DiscordResponse || 'DiscordResponse';

const DEFAULT_CLAIM_TTL_MS = 30 * 1000;

function sha256hex (s) {
  return crypto.createHash('sha256').update(String(s || ''), 'utf8').digest('hex');
}

/**
 * Deterministic request id from Discord message identity (stable across peers).
 * @param {{ discordMessageId?: string, channelId?: string, content?: string, createdAt?: string|number }} parts
 * @returns {string}
 */
function discordRequestId (parts = {}) {
  const discordMessageId = String(parts.discordMessageId || parts.messageId || '').trim();
  const channelId = String(parts.channelId || '').trim();
  if (discordMessageId && channelId) {
    return sha256hex(`discord:${channelId}:${discordMessageId}`);
  }
  return new Actor({
    type: DISCORD_REQUEST,
    channelId,
    content: String(parts.content || '').slice(0, 500),
    createdAt: parts.createdAt || null
  }).id;
}

/**
 * Build DiscordRequest body from a @fabric/discord activity emit.
 * @param {object} activity
 * @param {object} [opts]
 * @returns {object|null}
 */
function requestFromDiscordActivity (activity, opts = {}) {
  if (!activity || activity.type !== 'DiscordMessage') return null;
  const actor = activity.actor || {};
  const object = activity.object || {};
  const target = activity.target || {};
  const discordMessageId = String(
    object.id || object.messageId || object.ref || opts.discordMessageId || ''
  ).trim();
  const channelId = String(target.ref || target.id || opts.channelId || '').trim();
  const content = String(object.content || '').trim();
  const createdAt = object.created != null
    ? (typeof object.created === 'number'
      ? new Date(object.created).toISOString()
      : String(object.created))
    : new Date().toISOString();
  if (!channelId || (!discordMessageId && !content)) return null;

  const requestId = discordRequestId({
    discordMessageId: discordMessageId || sha256hex(`${channelId}:${createdAt}:${content}`),
    channelId,
    content,
    createdAt
  });

  return {
    requestId,
    discordMessageId: discordMessageId || null,
    channelId,
    guildId: opts.guildId != null
      ? String(opts.guildId)
      : (activity.guildId != null
        ? String(activity.guildId)
        : (target.guildId != null ? String(target.guildId) : (object.guildId != null ? String(object.guildId) : null))),
    authorId: String(actor.ref || actor.id || '').trim() || null,
    authorUsername: String(actor.username || '').trim() || null,
    content,
    createdAt,
    appId: opts.appId != null ? String(opts.appId) : null,
    targetType: target.type != null ? target.type : null
  };
}

/**
 * @param {object} request DiscordRequest object
 * @param {string} claimantPubkey
 * @param {object} [opts]
 * @returns {object}
 */
function buildDiscordClaim (request, claimantPubkey, opts = {}) {
  const requestId = String(request && request.requestId || '').trim();
  const pubkey = String(claimantPubkey || '').trim();
  if (!requestId || !pubkey) throw new Error('DiscordClaim requires requestId and claimantPubkey');
  const claimedAt = opts.claimedAt || new Date().toISOString();
  const ttlMs = Math.max(1000, Number(opts.ttlMs) || DEFAULT_CLAIM_TTL_MS);
  const claimId = new Actor({
    type: DISCORD_CLAIM,
    requestId,
    claimantPubkey: pubkey,
    claimedAt
  }).id;
  return {
    requestId,
    claimId,
    claimantPubkey: pubkey,
    claimedAt,
    ttlMs
  };
}

/**
 * @param {object} request
 * @param {object} [claim]
 * @param {object} result
 * @returns {object}
 */
function buildDiscordResponse (request, claim, result = {}) {
  const requestId = String(request && request.requestId || result.requestId || '').trim();
  if (!requestId) throw new Error('DiscordResponse requires requestId');
  return {
    requestId,
    claimId: claim && claim.claimId ? String(claim.claimId) : (result.claimId || null),
    responderPubkey: String(result.responderPubkey || (claim && claim.claimantPubkey) || '').trim() || null,
    status: String(result.status || 'ok'),
    reply: result.reply != null ? result.reply : null,
    discordReplyMessageId: result.discordReplyMessageId != null
      ? String(result.discordReplyMessageId)
      : null,
    error: result.error != null ? String(result.error) : null,
    respondedAt: result.respondedAt || new Date().toISOString()
  };
}

/**
 * First-claim-wins: earlier claimedAt wins; tie → lower pubkey hex.
 * @param {object|null} a
 * @param {object|null} b
 * @returns {object|null}
 */
function winningClaim (a, b) {
  if (!a) return b || null;
  if (!b) return a;
  const ta = Date.parse(a.claimedAt) || 0;
  const tb = Date.parse(b.claimedAt) || 0;
  if (ta !== tb) return ta < tb ? a : b;
  const pa = String(a.claimantPubkey || '');
  const pb = String(b.claimantPubkey || '');
  return pa <= pb ? a : b;
}

/**
 * Whether claim is still within TTL relative to `now`.
 * @param {object} claim
 * @param {number} [now]
 * @returns {boolean}
 */
function claimIsActive (claim, now = Date.now()) {
  if (!claim || !claim.claimedAt) return false;
  const start = Date.parse(claim.claimedAt);
  if (!Number.isFinite(start)) return false;
  const ttl = Math.max(1000, Number(claim.ttlMs) || DEFAULT_CLAIM_TTL_MS);
  return now <= start + ttl;
}

/**
 * Build an auditor-facing sequence tree for one requestId from journal entries.
 * @param {string} requestId
 * @param {object[]} entries [{ type, object, signer, ts, messageId, direction }]
 * @returns {object}
 */
function buildDiscordSequenceTree (requestId, entries = []) {
  const id = String(requestId || '').trim();
  const nodes = [];
  let request = null;
  /** @type {object|null} */
  let claim = null;
  const responses = [];

  for (const entry of entries) {
    if (!entry) continue;
    const type = String(entry.type || entry.appType || '').trim();
    const object = entry.object || entry.body || entry;
    if (!object || String(object.requestId || '') !== id) continue;
    const node = {
      type,
      object,
      signer: entry.signer || null,
      ts: entry.ts || object.createdAt || object.claimedAt || object.respondedAt || null,
      messageId: entry.messageId || null,
      direction: entry.direction || null,
      parentRequestId: id
    };
    nodes.push(node);
    if (type === DISCORD_REQUEST) request = object;
    if (type === DISCORD_CLAIM) claim = winningClaim(claim, object);
    if (type === DISCORD_RESPONSE) responses.push(object);
  }

  nodes.sort((a, b) => {
    const ta = Date.parse(a.ts) || 0;
    const tb = Date.parse(b.ts) || 0;
    if (ta !== tb) return ta - tb;
    return String(a.type).localeCompare(String(b.type));
  });

  const root = {
    type: 'DiscordSequenceTree',
    requestId: id,
    request,
    winningClaim: claim,
    responses,
    nodes,
    digest: sha256hex(JSON.stringify({
      requestId: id,
      types: nodes.map((n) => n.type),
      ids: nodes.map((n) => n.messageId || n.object && (n.object.claimId || n.object.requestId))
    }))
  };
  return root;
}

/**
 * In-memory coordination journal (per LiveRelay).
 */
function createDiscordCoordJournal (opts = {}) {
  const capacity = Math.max(50, Number(opts.capacity) || 500);
  /** @type {Map<string, object[]>} */
  const byRequest = new Map();
  /** @type {object[]} */
  const flat = [];

  function append (type, object, meta = {}) {
    const requestId = String(object && object.requestId || '').trim();
    if (!requestId) return null;
    const row = {
      type: String(type),
      object,
      signer: meta.signer || null,
      ts: meta.ts || new Date().toISOString(),
      messageId: meta.messageId || null,
      direction: meta.direction || null
    };
    flat.push(row);
    while (flat.length > capacity) {
      const drop = flat.shift();
      if (drop && drop.object && drop.object.requestId) {
        const list = byRequest.get(drop.object.requestId);
        if (list) {
          const i = list.indexOf(drop);
          if (i >= 0) list.splice(i, 1);
          if (!list.length) byRequest.delete(drop.object.requestId);
        }
      }
    }
    const list = byRequest.get(requestId) || [];
    list.push(row);
    byRequest.set(requestId, list);
    return row;
  }

  function treeFor (requestId) {
    return buildDiscordSequenceTree(requestId, byRequest.get(String(requestId || '').trim()) || []);
  }

  function listRecent (limit = 100) {
    return flat.slice(-Math.max(1, Math.min(500, Number(limit) || 100)));
  }

  function getWinningClaim (requestId) {
    const list = byRequest.get(String(requestId || '').trim()) || [];
    let win = null;
    for (const row of list) {
      if (row.type === DISCORD_CLAIM) win = winningClaim(win, row.object);
    }
    return win;
  }

  return {
    append,
    treeFor,
    listRecent,
    getWinningClaim,
    buildDiscordSequenceTree
  };
}

module.exports = {
  DISCORD_REQUEST,
  DISCORD_CLAIM,
  DISCORD_RESPONSE,
  DEFAULT_CLAIM_TTL_MS,
  discordRequestId,
  requestFromDiscordActivity,
  buildDiscordClaim,
  buildDiscordResponse,
  winningClaim,
  claimIsActive,
  buildDiscordSequenceTree,
  createDiscordCoordJournal
};
