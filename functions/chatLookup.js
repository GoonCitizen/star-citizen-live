'use strict';

/**
 * Chat `/lookup` coordination — network-wide Request → Claim (first-wins) → Response.
 *
 * Operators race to answer with a local master report (players, public groups /
 * fleets, peers, Discord catalog, local tag names). Speed wins; losers drop
 * their pending settle when a foreign claim arrives.
 */

const crypto = require('crypto');
const Actor = require('@fabric/core/types/actor');
const { APP_CONTRACT_BODY_TYPES } = require('../contracts/applicationMessageTypes');
const Group = require('../types/Group');

const LOOKUP_REQUEST = APP_CONTRACT_BODY_TYPES.LookupRequest || 'LookupRequest';
const LOOKUP_CLAIM = APP_CONTRACT_BODY_TYPES.LookupClaim || 'LookupClaim';
const LOOKUP_RESPONSE = APP_CONTRACT_BODY_TYPES.LookupResponse || 'LookupResponse';

const DEFAULT_CLAIM_TTL_MS = 15 * 1000;
const LOOKUP_PREFIX = '/lookup';

function sha256hex (s) {
  return crypto.createHash('sha256').update(String(s || ''), 'utf8').digest('hex');
}

/**
 * @param {string} body
 * @returns {{ isLookup: boolean, query: string }|null}
 */
function parseLookupCommand (body) {
  const raw = String(body || '').trim();
  if (!raw.startsWith(LOOKUP_PREFIX)) return null;
  const rest = raw.slice(LOOKUP_PREFIX.length);
  if (rest.length && !/^\s/.test(rest) && rest !== '') {
    // `/lookupfoo` is not a command
    return null;
  }
  return {
    isLookup: true,
    query: rest.trim()
  };
}

/**
 * Deterministic request id so every peer races the same query.
 * Prefer chatMessageId when present.
 * @param {object} parts
 * @returns {string}
 */
function lookupRequestId (parts = {}) {
  const chatMessageId = String(parts.chatMessageId || parts.messageId || '').trim();
  const channel = String(parts.channel || 'global').trim() || 'global';
  const query = String(parts.query || '').trim().toLowerCase();
  if (chatMessageId) {
    return sha256hex(`lookup:${channel}:${chatMessageId}`);
  }
  return new Actor({
    type: LOOKUP_REQUEST,
    channel,
    query,
    createdAt: parts.createdAt || null,
    authorPubkey: parts.authorPubkey || null
  }).id;
}

/**
 * @param {object} opts
 * @returns {object}
 */
function buildLookupRequest (opts = {}) {
  const channel = String(opts.channel || 'global').trim() || 'global';
  const query = String(opts.query || '').trim();
  const createdAt = opts.createdAt || new Date().toISOString();
  const authorPubkey = opts.authorPubkey != null ? String(opts.authorPubkey) : null;
  const chatMessageId = opts.chatMessageId != null ? String(opts.chatMessageId) : null;
  const requestId = lookupRequestId({
    channel,
    query,
    createdAt,
    authorPubkey,
    chatMessageId
  });
  return {
    requestId,
    channel,
    query,
    authorPubkey,
    chatMessageId,
    createdAt
  };
}

/**
 * @param {object} request
 * @param {string} claimantPubkey
 * @param {object} [opts]
 * @returns {object}
 */
function buildLookupClaim (request, claimantPubkey, opts = {}) {
  const requestId = String(request && request.requestId || '').trim();
  const pubkey = String(claimantPubkey || '').trim();
  if (!requestId || !pubkey) throw new Error('LookupClaim requires requestId and claimantPubkey');
  const claimedAt = opts.claimedAt || new Date().toISOString();
  const ttlMs = Math.max(500, Number(opts.ttlMs) || DEFAULT_CLAIM_TTL_MS);
  const claimId = new Actor({
    type: LOOKUP_CLAIM,
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
function buildLookupResponse (request, claim, result = {}) {
  const requestId = String(request && request.requestId || result.requestId || '').trim();
  if (!requestId) throw new Error('LookupResponse requires requestId');
  return {
    requestId,
    claimId: claim && claim.claimId ? String(claim.claimId) : (result.claimId || null),
    responderPubkey: String(result.responderPubkey || (claim && claim.claimantPubkey) || '').trim() || null,
    status: String(result.status || 'ok'),
    reply: result.reply != null ? String(result.reply) : null,
    results: result.results && typeof result.results === 'object' ? result.results : null,
    error: result.error != null ? String(result.error) : null,
    chatMessageId: result.chatMessageId != null ? String(result.chatMessageId) : null,
    respondedAt: result.respondedAt || new Date().toISOString()
  };
}

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

function claimIsActive (claim, now = Date.now()) {
  if (!claim || !claim.claimedAt) return false;
  const start = Date.parse(claim.claimedAt);
  if (!Number.isFinite(start)) return false;
  const ttl = Math.max(500, Number(claim.ttlMs) || DEFAULT_CLAIM_TTL_MS);
  return now <= start + ttl;
}

/**
 * Public-safe local catalog for `/lookup` (master report).
 * Includes players, public groups, public fleets, peer aliases, Discord
 * guild/user names from the bot catalog, and local tag *names* only
 * (no private member lists or identity-note bodies).
 *
 * @param {object} opts
 * @param {Array<object>} [opts.players]
 * @param {Array<object>} [opts.groups]
 * @param {Array<object>} [opts.fleets]
 * @param {Array<object>} [opts.peers]
 * @param {Array<object>} [opts.discordGuilds]
 * @param {Array<object>} [opts.discordUsers]
 * @param {Array<object>} [opts.localTags]
 * @param {string} [opts.query]
 * @param {number} [opts.limit]
 * @returns {object}
 */
function queryLocalPublicListings (opts = {}) {
  const query = String(opts.query || '').trim();
  const q = query.toLowerCase();
  const limit = Math.max(1, Math.min(50, Number(opts.limit) || 12));

  function matches (...parts) {
    if (!q) return true;
    return parts.some((p) => String(p || '').toLowerCase().includes(q));
  }

  const playersIn = Array.isArray(opts.players) ? opts.players : [];
  let players = playersIn.map((p) => {
    const name = String((p && (p.name || p.handle || p.id)) || '').trim();
    if (!name) return null;
    return {
      name,
      lastSeen: p.lastSeen || p.ts || p.updatedAt || null
    };
  }).filter(Boolean);
  if (q) players = players.filter((p) => matches(p.name));
  players = players.slice(0, limit);

  const groupsIn = Array.isArray(opts.groups) ? opts.groups : [];
  let groups = groupsIn
    .filter((g) => g && String(g.visibility || '') === 'public')
    .map((g) => {
      try {
        return g.toPublicJSON ? g.toPublicJSON() : new Group(g).toPublicJSON();
      } catch (_) {
        return {
          id: g.id,
          name: g.name,
          memberCount: Array.isArray(g.members) ? g.members.length : (g.memberCount || 0),
          visibility: 'public',
          slug: g.slug || null
        };
      }
    });
  if (q) {
    groups = groups.filter((g) => matches(g.name, g.slug, g.id));
  }
  groups = groups.slice(0, limit);

  const fleetsIn = Array.isArray(opts.fleets) ? opts.fleets : [];
  let fleets = fleetsIn
    .filter((f) => f && String(f.visibility || '') === 'public')
    .map((f) => ({
      id: f.fleetId || f.id || null,
      name: String(f.name || f.fleetId || f.id || '').trim() || 'fleet',
      shipCount: Number(f.shipCount) || 0,
      visibility: 'public'
    }));
  if (q) fleets = fleets.filter((f) => matches(f.name, f.id));
  fleets = fleets.slice(0, limit);

  const peersIn = Array.isArray(opts.peers) ? opts.peers : [];
  let peers = peersIn.map((p) => {
    if (!p) return null;
    const alias = String(p.alias || p.nickname || p.label || '').trim() || null;
    const pubkey = String(p.pubkey || p.expectedPubkey || p.id || '').trim() || null;
    const address = String(p.address || '').trim() || null;
    if (!alias && !pubkey && !address) return null;
    return {
      alias,
      pubkey: pubkey && pubkey.length > 16 ? pubkey.slice(0, 8) + '…' + pubkey.slice(-6) : pubkey,
      address
    };
  }).filter(Boolean);
  if (q) {
    peers = peers.filter((p) => matches(p.alias, p.pubkey, p.address));
  }
  peers = peers.slice(0, limit);

  const guildsIn = Array.isArray(opts.discordGuilds) ? opts.discordGuilds : [];
  let discordGuilds = guildsIn.map((g) => ({
    id: g && g.id != null ? String(g.id) : null,
    name: String((g && g.name) || '').trim() || null,
    memberCount: g && g.memberCount != null ? Number(g.memberCount) : null
  })).filter((g) => g.name);
  if (q) discordGuilds = discordGuilds.filter((g) => matches(g.name, g.id));
  discordGuilds = discordGuilds.slice(0, limit);

  const usersIn = Array.isArray(opts.discordUsers) ? opts.discordUsers : [];
  let discordUsers = usersIn.map((u) => {
    const name = String((u && (u.displayName || u.username || u.handle || u.name)) || '').trim();
    if (!name) return null;
    return {
      id: u.id != null ? String(u.id) : null,
      name,
      username: u.username ? String(u.username) : null
    };
  }).filter(Boolean);
  if (q) discordUsers = discordUsers.filter((u) => matches(u.name, u.username, u.id));
  discordUsers = discordUsers.slice(0, limit);

  const tagsIn = Array.isArray(opts.localTags) ? opts.localTags : [];
  let localTags = tagsIn.map((t) => ({
    id: t && t.id != null ? String(t.id) : null,
    name: String((t && t.name) || '').trim() || null,
    memberCount: Array.isArray(t && t.members)
      ? t.members.length
      : (t && t.memberCount != null ? Number(t.memberCount) : null)
  })).filter((t) => t.name);
  if (q) localTags = localTags.filter((t) => matches(t.name, t.id));
  localTags = localTags.slice(0, limit);

  return {
    query,
    players,
    groups,
    fleets,
    peers,
    discordGuilds,
    discordUsers,
    localTags,
    queriedAt: new Date().toISOString()
  };
}

/**
 * Human-readable chat reply body from local results (master report).
 * @param {object} request
 * @param {object} results from {@link queryLocalPublicListings}
 * @returns {string}
 */
function formatLookupReply (request, results) {
  const q = String((results && results.query) || (request && request.query) || '').trim();
  const players = (results && results.players) || [];
  const groups = (results && results.groups) || [];
  const fleets = (results && results.fleets) || [];
  const peers = (results && results.peers) || [];
  const discordGuilds = (results && results.discordGuilds) || [];
  const discordUsers = (results && results.discordUsers) || [];
  const localTags = (results && results.localTags) || [];

  const listOrNone = (arr, mapFn) => (arr.length ? arr.map(mapFn).join(', ') : 'none');

  const lines = [
    q ? `Lookup «${q}»` : 'Lookup report (all)',
    `Players (${players.length}): ` + listOrNone(players, (p) => p.name),
    `Public groups (${groups.length}): ` + listOrNone(groups, (g) =>
      g.name + (g.memberCount != null ? ` [${g.memberCount}]` : '')),
    `Public fleets (${fleets.length}): ` + listOrNone(fleets, (f) =>
      f.name + (f.shipCount ? ` [${f.shipCount} ships]` : '')),
    `Peers (${peers.length}): ` + listOrNone(peers, (p) =>
      p.alias || p.pubkey || p.address || '?'),
    `Discord servers (${discordGuilds.length}): ` + listOrNone(discordGuilds, (g) =>
      g.name + (g.memberCount != null ? ` [${g.memberCount}]` : '')),
    `Discord users (${discordUsers.length}): ` + listOrNone(discordUsers, (u) => u.name),
    `Local tags (${localTags.length}): ` + listOrNone(localTags, (t) =>
      t.name + (t.memberCount != null ? ` [${t.memberCount}]` : ''))
  ];
  return lines.join('\n');
}

function createLookupCoordJournal (opts = {}) {
  const capacity = Math.max(50, Number(opts.capacity) || 400);
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

  function getWinningClaim (requestId) {
    const list = byRequest.get(String(requestId || '').trim()) || [];
    let win = null;
    for (const row of list) {
      if (row.type === LOOKUP_CLAIM) win = winningClaim(win, row.object);
    }
    return win;
  }

  function listRecent (limit = 100) {
    return flat.slice(-Math.max(1, Math.min(500, Number(limit) || 100)));
  }

  function treeFor (requestId) {
    const id = String(requestId || '').trim();
    const entries = byRequest.get(id) || [];
    let request = null;
    let claim = null;
    const responses = [];
    for (const entry of entries) {
      if (entry.type === LOOKUP_REQUEST) request = entry.object;
      if (entry.type === LOOKUP_CLAIM) claim = winningClaim(claim, entry.object);
      if (entry.type === LOOKUP_RESPONSE) responses.push(entry.object);
    }
    return {
      type: 'LookupSequenceTree',
      requestId: id,
      request,
      winningClaim: claim,
      responses,
      nodes: entries.slice()
    };
  }

  return { append, getWinningClaim, listRecent, treeFor };
}

module.exports = {
  LOOKUP_REQUEST,
  LOOKUP_CLAIM,
  LOOKUP_RESPONSE,
  LOOKUP_PREFIX,
  DEFAULT_CLAIM_TTL_MS,
  parseLookupCommand,
  lookupRequestId,
  buildLookupRequest,
  buildLookupClaim,
  buildLookupResponse,
  winningClaim,
  claimIsActive,
  queryLocalPublicListings,
  formatLookupReply,
  createLookupCoordJournal
};
