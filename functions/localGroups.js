'use strict';

/**
 * Operator-local identity tags (Discord members and Fabric pubkeys).
 * Not Federation groups — the roster stays on this node and is never published.
 */

const crypto = require('crypto');
const {
  parseDiscordActor,
  discordActorKey,
  canonicalChatActor
} = require('./discordIdentityLink');

const TYPE = 'LocalGroup';
const COLLECTION = 'localgroups';
const NAME_MAX = 64;
const HANDLE_MAX = 64;
const MEMBERS_MAX = 500;
const GROUPS_MAX = 200;

function sha256Hex (s) {
  return crypto.createHash('sha256').update(String(s)).digest('hex');
}

function fail (message, code) {
  const err = new Error(message);
  err.code = code;
  return err;
}

/**
 * Canonical member id: `discord:<id>` or Fabric chat author (x-only pubkey).
 * Bare digit snowflakes are treated as Discord ids.
 * @param {*} value
 * @returns {string|null}
 */
function canonicalActor (value) {
  const s = String(value || '').trim();
  if (!s) return null;
  if (parseDiscordActor(s)) return discordActorKey(s);
  if (/^\d{5,32}$/.test(s)) return discordActorKey(s);
  try {
    const actor = canonicalChatActor(s);
    return actor || null;
  } catch (_) {
    return null;
  }
}

function actorKind (actor) {
  return parseDiscordActor(actor) ? 'discord' : 'fabric';
}

function sanitizeHandle (value) {
  const s = String(value || '').trim().replace(/\s+/g, ' ');
  return s ? s.slice(0, HANDLE_MAX) : null;
}

/**
 * @param {object} row
 * @returns {object|null}
 */
function sanitizeMember (row) {
  if (!row || typeof row !== 'object') return null;
  const actor = canonicalActor(row.actor || row.id || row.pubkey || row.discordUserId);
  if (!actor) return null;
  return {
    actor,
    kind: actorKind(actor),
    handle: sanitizeHandle(row.handle || row.username || row.displayName),
    addedAt: row.addedAt || new Date().toISOString()
  };
}

/**
 * @param {object} row
 * @returns {object|null}
 */
function sanitizeGroup (row) {
  if (!row || typeof row !== 'object') return null;
  const id = String(row.id || '').trim();
  const name = String(row.name || '').trim().slice(0, NAME_MAX);
  if (!id || !name) return null;
  const members = [];
  const seen = new Set();
  for (const raw of Array.isArray(row.members) ? row.members : []) {
    const member = sanitizeMember(raw);
    if (!member || seen.has(member.actor)) continue;
    seen.add(member.actor);
    members.push(member);
    if (members.length >= MEMBERS_MAX) break;
  }
  return {
    '@type': TYPE,
    id,
    name,
    createdAt: row.createdAt || null,
    updatedAt: row.updatedAt || row.createdAt || null,
    createdBy: row.createdBy != null ? String(row.createdBy) : 'local',
    members
  };
}

/**
 * @param {object} store
 * @returns {object[]}
 */
function listGroups (store) {
  if (!store) return [];
  return (store.all(COLLECTION) || [])
    .map(sanitizeGroup)
    .filter(Boolean)
    .sort((a, b) => String(a.name).localeCompare(String(b.name)));
}

/**
 * @param {object} store
 * @param {string} id
 * @returns {object|null}
 */
function getGroup (store, id) {
  if (!store || !id) return null;
  return sanitizeGroup(store.get(COLLECTION, String(id)));
}

/**
 * @param {object} store
 * @param {object} [opts]
 * @param {string} opts.name
 * @param {object[]} [opts.members]
 * @param {string} [opts.createdBy]
 * @returns {object}
 */
function createGroup (store, opts = {}) {
  if (!store) throw fail('Store required', 'UNAVAILABLE');
  if (listGroups(store).length >= GROUPS_MAX) {
    throw fail('Too many local groups', 'LIMIT');
  }
  const name = String(opts.name || '').trim().slice(0, NAME_MAX);
  if (!name) throw fail('name required', 'BAD_REQUEST');
  const now = new Date().toISOString();
  const id = 'lg-' + sha256Hex(name + ':' + now + ':' + crypto.randomBytes(8).toString('hex')).slice(0, 16);
  const members = [];
  const seen = new Set();
  for (const raw of Array.isArray(opts.members) ? opts.members : []) {
    const member = sanitizeMember(raw);
    if (!member || seen.has(member.actor)) continue;
    seen.add(member.actor);
    members.push(member);
  }
  const createdBy = canonicalActor(opts.createdBy) || (opts.createdBy ? String(opts.createdBy) : 'local');
  const group = {
    '@type': TYPE,
    id,
    name,
    createdAt: now,
    updatedAt: now,
    createdBy,
    members
  };
  store.put(COLLECTION, id, group);
  return group;
}

/**
 * @param {object} store
 * @param {string} id
 * @param {string} name
 * @returns {object}
 */
function renameGroup (store, id, name) {
  const group = getGroup(store, id);
  if (!group) throw fail('Local group not found', 'NOT_FOUND');
  const next = String(name || '').trim().slice(0, NAME_MAX);
  if (!next) throw fail('name required', 'BAD_REQUEST');
  group.name = next;
  group.updatedAt = new Date().toISOString();
  store.put(COLLECTION, group.id, group);
  return group;
}

/**
 * @param {object} store
 * @param {string} id
 * @returns {boolean}
 */
function deleteGroup (store, id) {
  const group = getGroup(store, id);
  if (!group) throw fail('Local group not found', 'NOT_FOUND');
  store.del(COLLECTION, group.id);
  return true;
}

/**
 * @param {object} store
 * @param {string} groupId
 * @param {object} member
 * @returns {object}
 */
function addMember (store, groupId, member) {
  const group = getGroup(store, groupId);
  if (!group) throw fail('Local group not found', 'NOT_FOUND');
  const row = sanitizeMember(member);
  if (!row) {
    throw fail('actor required (discord:<id> or Fabric pubkey)', 'BAD_REQUEST');
  }
  if (group.members.some((m) => m.actor === row.actor)) return group;
  if (group.members.length >= MEMBERS_MAX) throw fail('Too many members', 'LIMIT');
  group.members.push(row);
  group.updatedAt = new Date().toISOString();
  store.put(COLLECTION, group.id, group);
  return group;
}

/**
 * @param {object} store
 * @param {string} groupId
 * @param {*} actor
 * @returns {object}
 */
function removeMember (store, groupId, actor) {
  const group = getGroup(store, groupId);
  if (!group) throw fail('Local group not found', 'NOT_FOUND');
  const key = canonicalActor(actor);
  if (!key) throw fail('actor required', 'BAD_REQUEST');
  const next = group.members.filter((m) => m.actor !== key);
  if (next.length === group.members.length) return group;
  group.members = next;
  group.updatedAt = new Date().toISOString();
  store.put(COLLECTION, group.id, group);
  return group;
}

/**
 * @param {object} store
 * @param {*} actor
 * @returns {object[]}
 */
function groupsForActor (store, actor) {
  const key = canonicalActor(actor);
  if (!key) return [];
  return listGroups(store).filter((g) => g.members.some((m) => m.actor === key));
}

module.exports = {
  TYPE,
  COLLECTION,
  canonicalActor,
  actorKind,
  sanitizeHandle,
  sanitizeMember,
  sanitizeGroup,
  listGroups,
  getGroup,
  createGroup,
  renameGroup,
  deleteGroup,
  addMember,
  removeMember,
  groupsForActor
};
