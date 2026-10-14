'use strict';

/**
 * Accumulate Discord guild / channel / member / message observations.
 *
 * Discord will not return a full member list for large guilds (bounded
 * `members.list`). This store unions snapshots from the local bot, inbound
 * message authors, and group-scoped `GroupDataShare` packs (`chat.catalog` /
 * `chat.messages` with `platform: discord`; aliases `discord.catalog` /
 * `discord.messages`; legacy `DiscordCatalogShare` still accepted) so a node
 * can browse collected data if Discord is down, and so peers with other bots
 * or apps can merge packs into a shared world view.
 */

const { serializeChannel, serializeMember, uniqueUsersFromGuilds } = require('./discordGuildCatalog');

const COLLECTION = 'discordcatalog';
const SHARE_TYPE = 'DiscordCatalogShare';
const STORE_MEMBER_CAP = 2000;
const STORE_CHANNEL_CAP = 400;
const SHARE_GUILD_CAP = 25;
const SHARE_CHANNEL_CAP = 80;
const SHARE_MEMBER_CAP = 100;
const CHANNEL_MSG_KIND = 'channel-messages';
const STORE_MESSAGE_CAP = 500;
const SHARE_MESSAGE_CHANNELS = 12;
const SHARE_MESSAGES_PER_CHANNEL = 20;
const MESSAGE_BODY_SHARE_MAX = 500;

function guildRecordId (guildId) {
  const id = String(guildId || '').trim();
  return id ? ('guild:' + id) : null;
}

function isoNow (value) {
  if (value) {
    const d = new Date(value);
    if (!Number.isNaN(d.getTime())) return d.toISOString();
  }
  return new Date().toISOString();
}

function pickName (incoming, prev, fallback) {
  const next = incoming != null && String(incoming).trim() ? String(incoming).trim() : '';
  if (next) return next;
  const old = prev != null && String(prev).trim() ? String(prev).trim() : '';
  return old || fallback;
}

/**
 * @param {object} channel
 * @returns {object|null}
 */
function sanitizeChannel (channel) {
  const row = serializeChannel(channel);
  if (!row) return null;
  if (channel.chatInsight === true) row.chatInsight = true;
  if (channel.canAnnounce === true) row.canAnnounce = true;
  if (Number.isFinite(Number(channel.messageCount))) {
    row.messageCount = Number(channel.messageCount);
  }
  if (channel.lastMessageAt) row.lastMessageAt = String(channel.lastMessageAt);
  if (channel.bot && typeof channel.bot === 'object') row.bot = channel.bot;
  return row;
}

/**
 * @param {object} member
 * @param {string} [seenAt]
 * @returns {object|null}
 */
function sanitizeMember (member, seenAt) {
  const row = serializeMember(member);
  if (!row) return null;
  row.seenAt = isoNow((member && member.seenAt) || seenAt);
  return row;
}

function mergeById (prevList, incomingList, sanitize, cap) {
  const byId = new Map();
  for (const row of prevList || []) {
    const clean = sanitize(row);
    if (clean && clean.id) byId.set(String(clean.id), clean);
  }
  for (const row of incomingList || []) {
    const clean = sanitize(row);
    if (!clean || !clean.id) continue;
    const id = String(clean.id);
    const prev = byId.get(id);
    byId.set(id, prev ? Object.assign({}, prev, clean) : clean);
  }
  let out = Array.from(byId.values());
  if (Number.isFinite(cap) && out.length > cap) {
    out.sort((a, b) => String(b.seenAt || '').localeCompare(String(a.seenAt || '')));
    out = out.slice(0, cap);
  }
  out.sort((a, b) => {
    const an = String((a && (a.displayName || a.name || a.username)) || '').toLowerCase();
    const bn = String((b && (b.displayName || b.name || b.username)) || '').toLowerCase();
    if (an !== bn) return an.localeCompare(bn);
    const ap = Number.isFinite(Number(a && a.position)) ? Number(a.position) : 0;
    const bp = Number.isFinite(Number(b && b.position)) ? Number(b.position) : 0;
    if (ap !== bp) return ap - bp;
    return String(a.id).localeCompare(String(b.id));
  });
  return out;
}

function mergeSources (prev, next) {
  const list = Array.isArray(prev) ? prev.slice() : [];
  if (!next || !next.via) return list.slice(-12);
  const via = String(next.via);
  const pubkey = next.pubkey ? String(next.pubkey) : null;
  const groupId = next.groupId ? String(next.groupId) : null;
  const observedAt = isoNow(next.observedAt);
  const appId = next.appId ? String(next.appId) : null;
  const idx = list.findIndex((s) => s && s.via === via &&
    String(s.pubkey || '') === String(pubkey || '') &&
    String(s.groupId || '') === String(groupId || '') &&
    String(s.appId || '') === String(appId || ''));
  const row = { via, pubkey, groupId, appId, observedAt };
  if (idx >= 0) list[idx] = row;
  else list.push(row);
  return list.slice(-12);
}

function sourceLabel (sources) {
  const kinds = new Set((sources || []).map((s) => s && s.via).filter(Boolean));
  const hasBot = kinds.has('bot');
  const hasGossip = kinds.has('gossip');
  const hasMessage = kinds.has('message');
  if (hasBot && (hasGossip || hasMessage)) return 'merged';
  if (hasBot) return 'local';
  if (hasGossip) return 'gossip';
  if (hasMessage) return 'message';
  return 'local';
}

/**
 * @param {object|null} prev
 * @param {object} incoming
 * @param {object} [meta]
 * @returns {object|null}
 */
function mergeGuildRecord (prev, incoming, meta = {}) {
  if (!incoming || incoming.id == null) return prev || null;
  const id = String(incoming.id);
  const observedAt = isoNow(meta.observedAt || incoming.observedAt || incoming.updatedAt);
  const via = meta.via || incoming.source || 'bot';
  const channels = mergeById(
    (prev && prev.channels) || [],
    incoming.channels || [],
    (ch) => sanitizeChannel(ch),
    STORE_CHANNEL_CAP
  );
  const members = mergeById(
    (prev && prev.members) || [],
    incoming.members || [],
    (m) => sanitizeMember(m, observedAt),
    STORE_MEMBER_CAP
  );
  const listed = members.length;
  const memberCount = Math.max(
    Number(prev && prev.memberCount) || 0,
    Number(incoming.memberCount) || 0,
    listed
  );
  const sources = mergeSources(prev && prev.sources, {
    via,
    pubkey: meta.pubkey || null,
    groupId: meta.groupId || null,
    appId: meta.appId || null,
    observedAt
  });
  return {
    kind: 'guild',
    id,
    name: pickName(incoming.name, prev && prev.name, id),
    icon: incoming.icon != null ? incoming.icon : ((prev && prev.icon) || null),
    memberCount,
    channels,
    members,
    truncated: listed < memberCount,
    sources,
    source: sourceLabel(sources),
    updatedAt: observedAt,
    observedAt
  };
}

/**
 * Persist one or more guild snapshots into the register Store.
 * @param {object} store
 * @param {Array<object>} guilds
 * @param {object} [meta]
 * @returns {object[]}
 */
function foldGuilds (store, guilds, meta = {}) {
  if (!store) return [];
  const out = [];
  for (const g of guilds || []) {
    if (!g || g.id == null) continue;
    const key = guildRecordId(g.id);
    if (!key) continue;
    const merged = mergeGuildRecord(store.get(COLLECTION, key), g, meta);
    if (!merged) continue;
    store.put(COLLECTION, key, merged);
    out.push(merged);
  }
  return out;
}

/**
 * Fold a single member / channel observation (chat author, presence, …).
 * @param {object} store
 * @param {object} obs
 * @param {object} [meta]
 * @returns {object|null}
 */
function foldObservation (store, obs, meta = {}) {
  if (!store || !obs) return null;
  let guildId = obs.guildId != null ? String(obs.guildId).trim() : '';
  const channelId = obs.channelId != null ? String(obs.channelId).trim() : '';
  if (!guildId && channelId) {
    const found = findGuildIdForChannel(store, channelId);
    if (found) guildId = found;
  }
  if (!guildId) return null;
  const incoming = {
    id: guildId,
    name: obs.guildName || undefined,
    channels: channelId
      ? [{
        id: channelId,
        name: obs.channelName || channelId,
        type: obs.channelType != null ? obs.channelType : 0
      }]
      : [],
    members: obs.member || obs.authorId
      ? [{
        id: (obs.member && obs.member.id) || obs.authorId,
        username: (obs.member && (obs.member.username || obs.member.displayName)) ||
          obs.authorUsername || obs.authorId,
        displayName: (obs.member && obs.member.displayName) ||
          obs.authorUsername || obs.authorId,
        bot: !!(obs.member && obs.member.bot)
      }]
      : []
  };
  const folded = foldGuilds(store, [incoming], Object.assign({ via: 'message' }, meta));
  return folded[0] || null;
}

function findGuildIdForChannel (store, channelId) {
  const id = String(channelId || '').trim();
  if (!id || !store) return null;
  for (const row of store.all(COLLECTION) || []) {
    if (!isGuildRecord(row) || !Array.isArray(row.channels)) continue;
    if (row.channels.some((ch) => ch && String(ch.id) === id)) {
      return String(row.id);
    }
  }
  return null;
}

function isGuildRecord (row) {
  if (!row || row.id == null) return false;
  if (row.kind === CHANNEL_MSG_KIND) return false;
  if (row.kind === 'guild') return true;
  return Array.isArray(row.channels) || Array.isArray(row.members);
}

function channelMessageRecordId (channelId) {
  const id = String(channelId || '').trim();
  return id ? ('channel:' + id) : null;
}

/**
 * @param {object} row serializeMessage-shaped or Discord request-shaped
 * @returns {object|null}
 */
function sanitizeStoredMessage (row) {
  if (!row || typeof row !== 'object') return null;
  const rawId = String(row.discordMessageId || '').trim() ||
    (String(row.id || '').indexOf('discord-msg:') === 0 ? String(row.id) : '');
  const discordMessageId = rawId.replace(/^discord-msg:/, '').trim();
  const channelId = String(row.channelId || row.discordChannelId || '').trim() ||
    (String(row.channel || '').indexOf('discord:') === 0 && String(row.channel).indexOf('discord:dm:') !== 0
      ? String(row.channel).slice('discord:'.length)
      : '');
  if (!discordMessageId && !(row.body || row.content)) return null;
  if (!channelId && !discordMessageId) return null;
  const authorId = row.authorId != null
    ? String(row.authorId)
    : (row.discordUserId != null
      ? String(row.discordUserId)
      : (String(row.author || '').indexOf('discord:') === 0
        ? String(row.author).slice('discord:'.length)
        : null));
  const body = String(row.body != null ? row.body : (row.content != null ? row.content : ''));
  return {
    id: discordMessageId ? ('discord-msg:' + discordMessageId) : null,
    discordMessageId: discordMessageId || null,
    channelId: channelId || null,
    guildId: row.guildId != null ? String(row.guildId) : null,
    authorId: authorId || null,
    author: row.author != null
      ? String(row.author)
      : (authorId ? ('discord:' + authorId) : null),
    handle: row.handle != null
      ? String(row.handle)
      : (row.authorUsername != null ? String(row.authorUsername) : null),
    bot: row.bot === true,
    body,
    ts: isoNow(row.ts || row.createdAt || row.createdTimestamp),
    kind: 'discord'
  };
}

function mergeMessageLists (prevList, incomingList, cap) {
  const byId = new Map();
  for (const row of prevList || []) {
    const clean = sanitizeStoredMessage(row);
    if (!clean) continue;
    const key = clean.discordMessageId || (clean.ts + ':' + (clean.authorId || '') + ':' + clean.body);
    byId.set(key, clean);
  }
  for (const row of incomingList || []) {
    const clean = sanitizeStoredMessage(row);
    if (!clean) continue;
    const key = clean.discordMessageId || (clean.ts + ':' + (clean.authorId || '') + ':' + clean.body);
    const prev = byId.get(key);
    byId.set(key, prev ? Object.assign({}, prev, clean) : clean);
  }
  const out = Array.from(byId.values());
  out.sort((a, b) => String(a.ts || '').localeCompare(String(b.ts || '')));
  const max = Number.isFinite(cap) ? Math.max(1, cap) : STORE_MESSAGE_CAP;
  return out.length > max ? out.slice(-max) : out;
}

/**
 * Persist Discord messages (insight history + live ingest) for offline browse.
 * @param {object} store
 * @param {Array<object>} messages
 * @param {object} [meta]
 * @returns {object[]}
 */
function foldMessages (store, messages, meta = {}) {
  if (!store) return [];
  const byChannel = new Map();
  for (const raw of messages || []) {
    const row = sanitizeStoredMessage(raw);
    if (!row || !row.channelId) continue;
    if (!byChannel.has(row.channelId)) byChannel.set(row.channelId, []);
    byChannel.get(row.channelId).push(row);
  }
  const out = [];
  for (const [channelId, rows] of byChannel) {
    const key = channelMessageRecordId(channelId);
    const prev = store.get(COLLECTION, key);
    const guildId = (rows.find((r) => r.guildId) && rows.find((r) => r.guildId).guildId) ||
      (prev && prev.guildId) ||
      findGuildIdForChannel(store, channelId) ||
      null;
    const merged = {
      id: key,
      kind: CHANNEL_MSG_KIND,
      channelId,
      guildId,
      messages: mergeMessageLists((prev && prev.messages) || [], rows, STORE_MESSAGE_CAP),
      updatedAt: isoNow(meta.observedAt)
    };
    const last = merged.messages[merged.messages.length - 1];
    merged.lastMessageAt = last && last.ts ? last.ts : merged.updatedAt;
    store.put(COLLECTION, key, merged);
    out.push(merged);
    if (guildId) {
      const guildKey = guildRecordId(guildId);
      const guild = store.get(COLLECTION, guildKey);
      if (guild && isGuildRecord(guild)) {
        const channels = (guild.channels || []).map((ch) => {
          if (!ch || String(ch.id) !== String(channelId)) return ch;
          return Object.assign({}, ch, {
            messageCount: merged.messages.length,
            lastMessageAt: merged.lastMessageAt
          });
        });
        store.put(COLLECTION, guildKey, Object.assign({}, guild, {
          channels,
          updatedAt: merged.updatedAt
        }));
      }
    }
  }
  return out;
}

/**
 * @param {object} store
 * @param {string} channelId
 * @param {number} [limit]
 * @returns {object[]}
 */
function loadAccumulatedMessages (store, channelId, limit) {
  if (!store) return [];
  const key = channelMessageRecordId(channelId);
  const row = key ? store.get(COLLECTION, key) : null;
  const list = row && Array.isArray(row.messages) ? row.messages.slice() : [];
  list.sort((a, b) => String(a.ts || '').localeCompare(String(b.ts || '')));
  const max = Number.isFinite(Number(limit)) ? Math.max(1, Number(limit)) : STORE_MESSAGE_CAP;
  return list.slice(-max);
}

/**
 * Newest stored Discord messages across channels (local search / packs).
 * @param {object} store
 * @param {Object} [opts]
 * @param {number} [opts.perChannel]
 * @param {number} [opts.maxTotal]
 * @returns {object[]}
 */
function loadRecentStoredMessages (store, opts = {}) {
  const perChannel = Math.max(1, Number(opts.perChannel) || SHARE_MESSAGES_PER_CHANNEL);
  const maxTotal = Math.max(1, Number(opts.maxTotal) || 240);
  const stats = loadChannelMessageStats(store);
  const out = [];
  for (const row of stats) {
    if (!row || !row.channelId) continue;
    const msgs = loadAccumulatedMessages(store, row.channelId, perChannel);
    for (const m of msgs) {
      out.push(m);
      if (out.length >= maxTotal) return out;
    }
  }
  return out;
}

/**
 * @param {object} store
 * @returns {Array<{ channelId: string, guildId: string|null, count: number, lastMessageAt: string|null }>}
 */
function loadChannelMessageStats (store) {
  if (!store) return [];
  const out = [];
  for (const row of store.all(COLLECTION) || []) {
    if (!row || row.kind !== CHANNEL_MSG_KIND || !row.channelId) continue;
    const count = Array.isArray(row.messages) ? row.messages.length : 0;
    out.push({
      channelId: String(row.channelId),
      guildId: row.guildId ? String(row.guildId) : null,
      count,
      lastMessageAt: row.lastMessageAt || null
    });
  }
  out.sort((a, b) => String(b.lastMessageAt || '').localeCompare(String(a.lastMessageAt || '')));
  return out;
}

function compactStoredMessage (row) {
  const clean = sanitizeStoredMessage(row);
  if (!clean || !clean.channelId) return null;
  return {
    discordMessageId: clean.discordMessageId,
    channelId: clean.channelId,
    guildId: clean.guildId,
    authorId: clean.authorId,
    handle: clean.handle,
    bot: !!clean.bot,
    body: String(clean.body || '').slice(0, MESSAGE_BODY_SHARE_MAX),
    ts: clean.ts
  };
}

/**
 * Bound recent Discord messages for a GroupDataShare pack.
 * @param {Array<object>} channels [{ channelId, guildId, messages }]
 * @returns {{ channels: object[], truncated: boolean }}
 */
function compactMessageShare (channels) {
  const list = Array.isArray(channels) ? channels.slice() : [];
  list.sort((a, b) => {
    const at = (a && a.lastMessageAt) ||
      (a && a.messages && a.messages[a.messages.length - 1] && a.messages[a.messages.length - 1].ts) ||
      '';
    const bt = (b && b.lastMessageAt) ||
      (b && b.messages && b.messages[b.messages.length - 1] && b.messages[b.messages.length - 1].ts) ||
      '';
    return String(bt).localeCompare(String(at));
  });
  const truncated = list.length > SHARE_MESSAGE_CHANNELS;
  const out = [];
  for (const ch of list.slice(0, SHARE_MESSAGE_CHANNELS)) {
    if (!ch || !ch.channelId) continue;
    const msgs = (ch.messages || []).map(compactStoredMessage).filter(Boolean);
    if (!msgs.length) continue;
    const sliced = msgs.slice(-SHARE_MESSAGES_PER_CHANNEL);
    out.push({
      channelId: String(ch.channelId),
      guildId: ch.guildId ? String(ch.guildId) : null,
      lastMessageAt: sliced.length ? sliced[sliced.length - 1].ts : (ch.lastMessageAt || null),
      messages: sliced
    });
  }
  return { channels: out, truncated: truncated || list.some((ch) => (ch.messages || []).length > SHARE_MESSAGES_PER_CHANNEL) };
}

/**
 * Union several serializeMessage / ChatMessage lists for channel insight.
 * @param {Array<Array<object>>} lists
 * @param {number} [limit]
 * @returns {object[]}
 */
function mergeInsightMessages (lists, limit) {
  let merged = [];
  for (const list of lists || []) {
    merged = mergeMessageLists(merged, list, limit || STORE_MESSAGE_CAP);
  }
  return merged;
}

function compactStoredMessagesForShare (store) {
  const stats = loadChannelMessageStats(store);
  const channels = stats.map((s) => ({
    channelId: s.channelId,
    guildId: s.guildId,
    lastMessageAt: s.lastMessageAt,
    messages: loadAccumulatedMessages(store, s.channelId, SHARE_MESSAGES_PER_CHANNEL)
  }));
  return compactMessageShare(channels);
}

function annotateGuildsWithMessages (guilds, stats) {
  const byChannel = new Map();
  for (const s of stats || []) {
    if (s && s.channelId) byChannel.set(String(s.channelId), s);
  }
  if (!byChannel.size) return guilds;
  return (guilds || []).map((g) => {
    if (!g || !Array.isArray(g.channels)) return g;
    return Object.assign({}, g, {
      channels: g.channels.map((ch) => {
        if (!ch || !ch.id) return ch;
        const hit = byChannel.get(String(ch.id));
        if (!hit) return ch;
        return Object.assign({}, ch, {
          messageCount: hit.count,
          lastMessageAt: hit.lastMessageAt
        });
      })
    });
  });
}

/**
 * @param {object} store
 * @returns {object[]}
 */
function loadAccumulatedGuilds (store) {
  if (!store) return [];
  return (store.all(COLLECTION) || [])
    .filter(isGuildRecord)
    .sort((a, b) => String(a.name || a.id).localeCompare(String(b.name || b.id)));
}

/**
 * Overlay a live Discord snapshot onto accumulated Store rows.
 * Live names win; member/channel sets are unioned; memberCount never shrinks.
 *
 * @param {object} liveCatalog
 * @param {Array<object>} storedGuilds
 * @returns {object}
 */
function mergeLiveCatalog (liveCatalog, storedGuilds) {
  const live = liveCatalog && typeof liveCatalog === 'object' ? liveCatalog : {};
  const byId = new Map();
  for (const g of storedGuilds || []) {
    if (!g || g.id == null) continue;
    byId.set(String(g.id), g);
  }
  for (const g of live.guilds || []) {
    if (!g || g.id == null) continue;
    const id = String(g.id);
    const via = g.source === 'gossip'
      ? 'gossip'
      : (g.source === 'message' ? 'message' : 'bot');
    byId.set(id, mergeGuildRecord(byId.get(id), g, {
      via,
      observedAt: g.updatedAt || g.observedAt
    }));
  }
  const guilds = annotateGuildsWithMessages(
    Array.from(byId.values())
      .filter(Boolean)
      .sort((a, b) => String(a.name || a.id).localeCompare(String(b.name || b.id))),
    live.messageStats || []
  );
  return Object.assign({}, live, {
    guilds,
    users: uniqueUsersFromGuilds(guilds),
    accumulated: (storedGuilds || []).length > 0,
    truncated: guilds.some((g) => g.truncated === true)
  });
}

function compactChannel (ch) {
  const row = sanitizeChannel(ch);
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    type: row.type,
    typeName: row.typeName,
    parentId: row.parentId,
    position: row.position,
    canAnnounce: !!row.canAnnounce,
    chatInsight: !!row.chatInsight
  };
}

function compactMember (m) {
  const row = sanitizeMember(m);
  if (!row) return null;
  return {
    id: row.id,
    username: row.username,
    displayName: row.displayName,
    bot: !!row.bot
  };
}

/**
 * Bound a catalog for CONTRACT_MESSAGE gossip (keep payloads small).
 * @param {Array<object>} guilds
 * @returns {{ guilds: object[], truncated: boolean }}
 */
function compactGuildsForShare (guilds) {
  const list = (Array.isArray(guilds) ? guilds : []).slice();
  list.sort((a, b) => (Number(b.memberCount) || 0) - (Number(a.memberCount) || 0));
  const sliced = list.slice(0, SHARE_GUILD_CAP);
  let truncated = list.length > SHARE_GUILD_CAP;
  const out = sliced.map((g) => {
    const channels = (g.channels || []).map(compactChannel).filter(Boolean);
    const members = (g.members || []).map(compactMember).filter(Boolean);
    if (channels.length > SHARE_CHANNEL_CAP || members.length > SHARE_MEMBER_CAP) truncated = true;
    if ((g.members || []).length < (Number(g.memberCount) || 0)) truncated = true;
    return {
      id: String(g.id),
      name: String(g.name || g.id),
      icon: g.icon != null ? String(g.icon) : null,
      memberCount: Math.max(Number(g.memberCount) || 0, members.length),
      truncated: members.length < Math.max(Number(g.memberCount) || 0, members.length) ||
        channels.length > SHARE_CHANNEL_CAP ||
        members.length > SHARE_MEMBER_CAP,
      channels: channels.slice(0, SHARE_CHANNEL_CAP),
      members: members.slice(0, SHARE_MEMBER_CAP)
    };
  }).filter((g) => g.id);
  return { guilds: out, truncated };
}

/**
 * @param {object} opts
 * @param {Array<object>} opts.guilds
 * @param {string} opts.groupId
 * @param {string} [opts.observedAt]
 * @returns {object|null}
 */
function buildShareObject (opts = {}) {
  const groupId = String(opts.groupId || '').trim();
  if (!groupId) return null;
  const packed = compactGuildsForShare(opts.guilds || []);
  if (!packed.guilds.length) return null;
  return {
    type: SHARE_TYPE,
    '@type': SHARE_TYPE,
    groupId,
    observedAt: isoNow(opts.observedAt),
    truncated: packed.truncated === true,
    guilds: packed.guilds
  };
}

/**
 * @param {object} object
 * @returns {object|null}
 */
function sanitizeShareObject (object) {
  const raw = object && object.object != null ? object.object : object;
  if (!raw || typeof raw !== 'object') return null;
  const type = String(raw.type || raw['@type'] || '').trim();
  if (type && type !== SHARE_TYPE) return null;
  const groupId = String(raw.groupId || '').trim();
  if (!groupId) return null;
  const packed = compactGuildsForShare(raw.guilds || []);
  if (!packed.guilds.length) return null;
  return {
    type: SHARE_TYPE,
    '@type': SHARE_TYPE,
    groupId,
    observedAt: isoNow(raw.observedAt),
    truncated: packed.truncated === true || raw.truncated === true,
    guilds: packed.guilds
  };
}

/**
 * Best-effort guild snowflake from a Discord activity / request blob.
 * @param {object} activity
 * @returns {string|null}
 */
function guildIdFromActivity (activity) {
  if (!activity || typeof activity !== 'object') return null;
  const target = activity.target || {};
  const object = activity.object || {};
  const raw = activity.guildId || activity.guild ||
    target.guildId || target.guild ||
    object.guildId || object.guild || null;
  if (raw && typeof raw === 'object' && raw.id != null) return String(raw.id).trim() || null;
  const id = raw != null ? String(raw).trim() : '';
  return id || null;
}

module.exports = {
  COLLECTION,
  SHARE_TYPE,
  STORE_MEMBER_CAP,
  STORE_CHANNEL_CAP,
  SHARE_GUILD_CAP,
  SHARE_CHANNEL_CAP,
  SHARE_MEMBER_CAP,
  guildRecordId,
  sanitizeChannel,
  sanitizeMember,
  mergeGuildRecord,
  foldGuilds,
  foldObservation,
  findGuildIdForChannel,
  isGuildRecord,
  channelMessageRecordId,
  sanitizeStoredMessage,
  foldMessages,
  loadAccumulatedMessages,
  loadRecentStoredMessages,
  loadChannelMessageStats,
  CHANNEL_MSG_KIND,
  STORE_MESSAGE_CAP,
  SHARE_MESSAGE_CHANNELS,
  SHARE_MESSAGES_PER_CHANNEL,
  mergeInsightMessages,
  compactMessageShare,
  compactStoredMessagesForShare,
  annotateGuildsWithMessages,
  loadAccumulatedGuilds,
  mergeLiveCatalog,
  compactGuildsForShare,
  buildShareObject,
  sanitizeShareObject,
  guildIdFromActivity
};
