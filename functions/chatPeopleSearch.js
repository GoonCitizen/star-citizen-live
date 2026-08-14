'use strict';

/**
 * Chat people directory — search members across the current channel,
 * Discord catalog, and Federation groups, plus overlap helpers for
 * common Discord servers and Fabric groups.
 */

const {
  parseDiscordActor,
  canonicalChatActor,
  linkForDiscordUser,
  linkForPubkey
} = require('./discordIdentityLink');

const DIRECTORY_LIMIT = 24;

function normalizePeopleQuery (query) {
  return String(query || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

/**
 * @param {object} member
 * @returns {string}
 */
function memberSearchHaystack (member) {
  if (!member || typeof member !== 'object') return '';
  const ship = member.ship;
  return [
    member.handle,
    member.pubkey,
    member.discordUserId,
    member.role,
    member.kind,
    ship && (ship.name || ship.slug),
    ...(member.guildNames || []),
    ...(member.groupNames || [])
  ].filter((v) => v != null && v !== '').map(String).join(' ').toLowerCase();
}

/**
 * Stable directory key: `discord:<id>` or canonical Fabric chat author.
 * @param {*} value
 * @returns {string|null}
 */
function canonicalPersonKey (value) {
  const s = String(value || '').trim();
  if (!s) return null;
  try {
    return canonicalChatActor(s) || s;
  } catch (_) {
    const discord = parseDiscordActor(s);
    return discord ? ('discord:' + discord) : s;
  }
}

function memberMatchesQuery (member, query) {
  const q = normalizePeopleQuery(query);
  if (!q) return true;
  return memberSearchHaystack(member).includes(q);
}

/**
 * @param {object[]} [members]
 * @param {string} [query]
 * @param {Object} [opts]
 * @param {string} [opts.keepKey]
 * @returns {object[]}
 */
function filterMembers (members, query, opts = {}) {
  const rows = Array.isArray(members) ? members : [];
  const q = normalizePeopleQuery(query);
  const keepKey = opts.keepKey || null;
  if (!q) return rows.slice();
  return rows.filter((m) => {
    if (keepKey && m && m.pubkey === keepKey) return true;
    return memberMatchesQuery(m, q);
  });
}

function foldPerson (byKey, row) {
  if (!row || !row.pubkey) return;
  const key = canonicalPersonKey(row.pubkey);
  if (!key) return;
  const prev = byKey.get(key);
  if (!prev) {
    byKey.set(key, Object.assign({
      guildNames: [],
      groupNames: []
    }, row, {
      pubkey: row.pubkey,
      guildNames: (row.guildNames || []).slice(),
      groupNames: (row.groupNames || []).slice()
    }));
    return;
  }
  if (parseDiscordActor(prev.pubkey) && !parseDiscordActor(row.pubkey)) {
    prev.pubkey = row.pubkey;
  }
  if (row.handle && !prev.handle) prev.handle = row.handle;
  if (row.linked) prev.linked = true;
  if (row.discordUserId) prev.discordUserId = row.discordUserId;
  if (row.kind === 'linked') prev.kind = 'linked';
  if (row.online) prev.online = true;
  if (row.bot === true) prev.bot = true;
  for (const name of row.guildNames || []) {
    if (name && prev.guildNames.indexOf(name) < 0) prev.guildNames.push(name);
  }
  for (const name of row.groupNames || []) {
    if (name && prev.groupNames.indexOf(name) < 0) prev.groupNames.push(name);
  }
}

/**
 * Flatten Discord catalog members into Chat-shaped people rows.
 * @param {object} [catalog]
 * @returns {object[]}
 */
function peopleFromDiscordCatalog (catalog) {
  const guilds = (catalog && Array.isArray(catalog.guilds)) ? catalog.guilds : [];
  const links = (catalog && catalog.identityLinks) || [];
  const byKey = new Map();
  for (const guild of guilds) {
    if (!guild) continue;
    const guildName = guild.name || guild.id;
    for (const member of guild.members || []) {
      if (!member || member.id == null) continue;
      const uid = String(member.id);
      const link = linkForDiscordUser(links, uid);
      const pubkey = link ? link.pubkey : ('discord:' + uid);
      foldPerson(byKey, {
        pubkey,
        handle: member.displayName || member.username || (link && link.username) || uid,
        kind: link ? 'linked' : 'discord',
        linked: !!link,
        discordUserId: uid,
        bot: member.bot === true,
        online: member.status === 'online' || member.status === 'idle' || member.status === 'dnd',
        guildNames: guildName ? [guildName] : [],
        source: 'discord'
      });
    }
  }
  return Array.from(byKey.values());
}

/**
 * Flatten Federation group members into Chat-shaped people rows.
 * @param {object[]} [groups]
 * @returns {object[]}
 */
function peopleFromFabricGroups (groups) {
  const byKey = new Map();
  for (const group of groups || []) {
    if (!group) continue;
    const name = group.name || group.id;
    for (const pk of group.members || []) {
      const pubkey = String(memberPubkey(pk) || '').trim();
      if (!pubkey) continue;
      foldPerson(byKey, {
        pubkey,
        handle: null,
        kind: 'fabric',
        linked: false,
        groupNames: name ? [name] : [],
        source: 'group'
      });
    }
  }
  return Array.from(byKey.values());
}

/**
 * Union of channel members, Discord catalog people, and group members.
 * @param {Object} [opts]
 * @param {object[]} [opts.members]
 * @param {object} [opts.catalog]
 * @param {object[]} [opts.groups]
 * @returns {object[]}
 */
function mergePeopleDirectory (opts = {}) {
  const byKey = new Map();
  for (const row of opts.members || []) foldPerson(byKey, row);
  for (const row of peopleFromDiscordCatalog(opts.catalog)) foldPerson(byKey, row);
  for (const row of peopleFromFabricGroups(opts.groups)) foldPerson(byKey, row);
  return Array.from(byKey.values());
}

/**
 * Directory hits for a people search, excluding keys already shown.
 * @param {object[]} directory
 * @param {string} [query]
 * @param {Object} [opts]
 * @param {string[]} [opts.exclude]
 * @param {number} [opts.limit]
 * @returns {object[]}
 */
function searchPeople (directory, query, opts = {}) {
  const q = normalizePeopleQuery(query);
  if (!q) return [];
  const exclude = new Set((opts.exclude || []).map(canonicalPersonKey).filter(Boolean));
  const limit = Number.isFinite(Number(opts.limit))
    ? Math.max(1, Math.min(100, Number(opts.limit)))
    : DIRECTORY_LIMIT;
  const hits = [];
  for (const row of directory || []) {
    if (!row) continue;
    const key = canonicalPersonKey(row.pubkey);
    if (!key || exclude.has(key)) continue;
    if (!memberMatchesQuery(row, q)) continue;
    hits.push(row);
    if (hits.length >= limit) break;
  }
  return hits;
}

/**
 * Discord snowflakes known for a Chat actor (discord:<id> or linked pubkey).
 * @param {object} [catalog]
 * @param {string} actor
 * @returns {string[]}
 */
function discordIdsForActor (catalog, actor) {
  const ids = new Set();
  const parsed = parseDiscordActor(actor);
  if (parsed) ids.add(parsed);
  const links = (catalog && catalog.identityLinks) || [];
  if (parsed) {
    const viaDiscord = linkForDiscordUser(links, parsed);
    if (viaDiscord && viaDiscord.discordUserId) ids.add(String(viaDiscord.discordUserId));
  } else if (actor) {
    const viaPk = linkForPubkey(links, actor);
    if (viaPk && viaPk.discordUserId) ids.add(String(viaPk.discordUserId));
  }
  return Array.from(ids);
}

function guildMemberIdSet (guild) {
  const ids = new Set();
  for (const member of (guild && guild.members) || []) {
    if (member && member.id != null) ids.add(String(member.id));
  }
  return ids;
}

/**
 * Discord guilds where both actors appear (self → all known guilds for that actor).
 * @param {object} [catalog]
 * @param {string} actorA
 * @param {string} actorB
 * @returns {Array<{ id: string, name: string }>}
 */
function commonDiscordGuilds (catalog, actorA, actorB) {
  const a = new Set(discordIdsForActor(catalog, actorA));
  const b = new Set(discordIdsForActor(catalog, actorB));
  if (!a.size || !b.size) return [];
  const out = [];
  for (const guild of (catalog && catalog.guilds) || []) {
    if (!guild || guild.id == null) continue;
    const members = guildMemberIdSet(guild);
    const aHit = Array.from(a).some((id) => members.has(id));
    const bHit = Array.from(b).some((id) => members.has(id));
    if (aHit && bHit) {
      out.push({ id: String(guild.id), name: guild.name || String(guild.id) });
    }
  }
  return out;
}

function memberPubkey (value) {
  if (value && typeof value === 'object') {
    return value.pubkey || value.actor || value.id || null;
  }
  return value;
}

function groupHasMember (group, pubkey) {
  const want = canonicalPersonKey(pubkey);
  if (!want || !group || !Array.isArray(group.members)) return false;
  return group.members.some((m) => canonicalPersonKey(memberPubkey(m)) === want);
}

/**
 * Federation groups both pubkeys belong to (self → groups that person is in).
 * @param {object[]} [groups]
 * @param {string} pubkeyA
 * @param {string} pubkeyB
 * @returns {Array<{ id: string, name: string, visibility: string|null }>}
 */
function commonFabricGroups (groups, pubkeyA, pubkeyB) {
  const a = String(pubkeyA || '');
  const b = String(pubkeyB || '');
  if (!a || !b) return [];
  const out = [];
  for (const group of groups || []) {
    if (!group || !group.id) continue;
    const aHit = groupHasMember(group, a);
    const bHit = a === b ? aHit : groupHasMember(group, b);
    if (aHit && bHit) {
      out.push({
        id: group.id,
        name: group.name || group.id,
        visibility: group.visibility || null
      });
    }
  }
  return out;
}

module.exports = {
  DIRECTORY_LIMIT,
  canonicalPersonKey,
  normalizePeopleQuery,
  memberSearchHaystack,
  memberMatchesQuery,
  filterMembers,
  peopleFromDiscordCatalog,
  peopleFromFabricGroups,
  mergePeopleDirectory,
  searchPeople,
  discordIdsForActor,
  commonDiscordGuilds,
  commonFabricGroups
};
