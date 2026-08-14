'use strict';

/**
 * Discord network exploration from the bot guild catalog.
 *
 * Discord Friends are not exposed to bots — this graph is co-membership:
 * which users appear together across the servers the local bot can see,
 * plus optional Fabric identity-link overlays.
 */

/**
 * @param {object} catalog From {@link buildDiscordGuildCatalog}
 * @param {Array<object>} [identityLinks]
 * @returns {{
 *   users: object[],
 *   guilds: object[],
 *   edges: object[],
 *   multiGuildUsers: object[],
 *   stats: object
 * }}
 */
function buildDiscordNetworkGraph (catalog, identityLinks) {
  const guildsIn = (catalog && Array.isArray(catalog.guilds)) ? catalog.guilds : [];
  const links = Array.isArray(identityLinks)
    ? identityLinks
    : ((catalog && Array.isArray(catalog.identityLinks)) ? catalog.identityLinks : []);
  const linkByDiscord = new Map();
  for (const link of links) {
    if (!link || link.discordUserId == null) continue;
    linkByDiscord.set(String(link.discordUserId), link);
  }

  /** @type {Map<string, object>} */
  const usersById = new Map();
  /** @type {Array<object>} */
  const guilds = [];

  for (const g of guildsIn) {
    if (!g || g.id == null) continue;
    const gid = String(g.id);
    const gname = String(g.name || gid);
    const memberIds = [];
    for (const m of (g.members || [])) {
      if (!m || m.id == null) continue;
      const uid = String(m.id);
      memberIds.push(uid);
      let row = usersById.get(uid);
      if (!row) {
        const link = linkByDiscord.get(uid) || null;
        row = {
          id: uid,
          displayName: m.displayName || m.username || uid,
          username: m.username || null,
          bot: m.bot === true,
          status: m.status || null,
          guildIds: [],
          guildNames: [],
          linkedPubkey: link && link.pubkey ? String(link.pubkey) : null,
          linkedUsername: link && link.username ? String(link.username) : null
        };
        usersById.set(uid, row);
      } else {
        if (m.displayName && (!row.displayName || row.displayName === row.id)) {
          row.displayName = m.displayName;
        }
        if (m.username && !row.username) row.username = m.username;
        if (m.bot === true) row.bot = true;
      }
      if (!row.guildIds.includes(gid)) {
        row.guildIds.push(gid);
        row.guildNames.push(gname);
      }
    }
    guilds.push({
      id: gid,
      name: gname,
      memberCount: g.memberCount != null ? Number(g.memberCount) : memberIds.length,
      memberIds,
      memberIdsVisible: memberIds.length
    });
  }

  const users = Array.from(usersById.values()).sort((a, b) => {
    if (b.guildIds.length !== a.guildIds.length) return b.guildIds.length - a.guildIds.length;
    return String(a.displayName).localeCompare(String(b.displayName));
  });

  const edges = buildCoMembershipEdges(users, { minShared: 1, excludeBots: false });
  const multiGuildUsers = users.filter((u) => !u.bot && u.guildIds.length >= 2);

  return {
    users,
    guilds,
    edges,
    multiGuildUsers,
    stats: {
      guildCount: guilds.length,
      userCount: users.length,
      humanCount: users.filter((u) => !u.bot).length,
      botCount: users.filter((u) => u.bot).length,
      linkedCount: users.filter((u) => u.linkedPubkey).length,
      multiGuildHumanCount: multiGuildUsers.length,
      edgeCount: edges.length,
      maxShared: edges.length ? edges[0].sharedCount : 0
    }
  };
}

/**
 * Undirected edges between users who share at least `minShared` guilds.
 * Sorted by sharedCount desc, then name.
 *
 * @param {object[]} users
 * @param {Object} [opts]
 * @param {number} [opts.minShared]
 * @param {boolean} [opts.excludeBots]
 * @param {number} [opts.limit]
 * @returns {Array<{ a: string, b: string, sharedGuildIds: string[], sharedGuildNames: string[], sharedCount: number, aName: string, bName: string }>}
 */
function buildCoMembershipEdges (users, opts = {}) {
  const minShared = Math.max(1, Number(opts.minShared) || 1);
  const excludeBots = opts.excludeBots !== false;
  const limit = Number.isFinite(Number(opts.limit))
    ? Math.max(1, Math.min(5000, Number(opts.limit)))
    : 400;
  const list = (Array.isArray(users) ? users : []).filter((u) => {
    if (!u || !u.id) return false;
    if (excludeBots && u.bot) return false;
    return Array.isArray(u.guildIds) && u.guildIds.length > 0;
  });

  /** @type {Array<object>} */
  const edges = [];

  for (let i = 0; i < list.length; i++) {
    const a = list[i];
    const aSet = new Set(a.guildIds);
    for (let j = i + 1; j < list.length; j++) {
      const b = list[j];
      const sharedGuildIds = [];
      const sharedGuildNames = [];
      for (let k = 0; k < b.guildIds.length; k++) {
        const gid = b.guildIds[k];
        if (aSet.has(gid)) {
          sharedGuildIds.push(gid);
          sharedGuildNames.push(b.guildNames[k] || a.guildNames[a.guildIds.indexOf(gid)] || gid);
        }
      }
      if (sharedGuildIds.length < minShared) continue;
      edges.push({
        a: a.id,
        b: b.id,
        aName: a.displayName || a.username || a.id,
        bName: b.displayName || b.username || b.id,
        sharedGuildIds,
        sharedGuildNames,
        sharedCount: sharedGuildIds.length
      });
    }
  }

  edges.sort((x, y) => {
    if (y.sharedCount !== x.sharedCount) return y.sharedCount - x.sharedCount;
    const an = String(x.aName).localeCompare(String(y.aName));
    if (an) return an;
    return String(x.bName).localeCompare(String(y.bName));
  });

  return edges.slice(0, limit);
}

/**
 * Neighbors of a user, strongest overlap first.
 * @param {object} graph From {@link buildDiscordNetworkGraph}
 * @param {string} userId
 * @param {Object} [opts]
 * @param {number} [opts.minShared]
 * @param {boolean} [opts.excludeBots]
 * @returns {Array<object>}
 */
function neighborsForUser (graph, userId, opts = {}) {
  const uid = String(userId || '');
  if (!uid || !graph) return [];
  const minShared = Math.max(1, Number(opts.minShared) || 1);
  const excludeBots = opts.excludeBots !== false;
  const me = (graph.users || []).find((u) => u.id === uid);
  if (!me) return [];
  const mySet = new Set(me.guildIds || []);
  const out = [];
  for (const other of (graph.users || [])) {
    if (!other || other.id === uid) continue;
    if (excludeBots && other.bot) continue;
    const sharedGuildIds = [];
    const sharedGuildNames = [];
    for (let i = 0; i < (other.guildIds || []).length; i++) {
      const gid = other.guildIds[i];
      if (mySet.has(gid)) {
        sharedGuildIds.push(gid);
        sharedGuildNames.push(other.guildNames[i] || gid);
      }
    }
    if (sharedGuildIds.length < minShared) continue;
    out.push({
      user: other,
      sharedCount: sharedGuildIds.length,
      sharedGuildIds,
      sharedGuildNames
    });
  }
  out.sort((a, b) => {
    if (b.sharedCount !== a.sharedCount) return b.sharedCount - a.sharedCount;
    return String(a.user.displayName).localeCompare(String(b.user.displayName));
  });
  return out;
}

/**
 * @param {object[]} users
 * @param {string} [query]
 * @returns {object[]}
 */
function filterNetworkUsers (users, query) {
  const q = String(query || '').trim().toLowerCase();
  const rows = Array.isArray(users) ? users : [];
  if (!q) return rows.slice();
  return rows.filter((u) => {
    const hay = [
      u.displayName, u.username, u.id, u.linkedPubkey,
      ...(u.guildNames || [])
    ].join(' ').toLowerCase();
    return hay.includes(q);
  });
}

module.exports = {
  buildDiscordNetworkGraph,
  buildCoMembershipEdges,
  neighborsForUser,
  filterNetworkUsers
};
