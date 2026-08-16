'use strict';

/**
 * Unified local application search — people, notes, packs, register collections.
 *
 * Indexes operator-visible data already on this node (Discord world-view packs,
 * Fabric groups, notes, missions, fleets, peers, chat, inbox, library). Does
 * not gossip results; `/lookup` remains the public mesh report.
 */

const groupDataSync = require('./groupDataSync');
const { hrefFor } = require('./collectionRecords');

const DEFAULT_LIMIT = 24;
const MAX_LIMIT = 50;

const CHAT_CHANNEL_KEY = 'gc.chat.channel';
const CHAT_PEOPLE_KEY = 'gc.chat.people';
const GROUPS_ROSTER_KEY = 'gooncitizen.groups.rosterMode';

const KIND_LABELS = Object.freeze({
  person: 'Person',
  note: 'Note',
  group: 'Group',
  'local-tag': 'Local tag',
  guild: 'Discord',
  channel: 'Channel',
  message: 'Message',
  mission: 'Mission',
  fleet: 'Fleet',
  peer: 'Peer',
  player: 'Pilot',
  snapshot: 'Library',
  inbox: 'Inbox',
  playtimes: 'When they play',
  file: 'File',
  location: 'Location'
});

const KIND_WEIGHT = Object.freeze({
  person: 8,
  note: 7,
  group: 6,
  'local-tag': 5,
  guild: 4,
  channel: 4,
  mission: 5,
  fleet: 4,
  peer: 5,
  playtimes: 3,
  file: 4,
  location: 6,
  message: 2,
  player: 3,
  inbox: 3,
  snapshot: 2
});

function normalizeQuery (query) {
  return String(query || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

function keywords (query) {
  return normalizeQuery(query).split(/[\s,]+/).filter(Boolean);
}

function haystack (parts) {
  return parts
    .filter((v) => v != null && v !== '')
    .map((v) => String(v).toLowerCase())
    .join(' ');
}

function matchesHaystack (text, terms) {
  if (!terms.length) return false;
  const h = String(text || '');
  return terms.every((t) => h.includes(t));
}

function scoreHit (hit, terms, rawQuery) {
  const title = String(hit.title || '').toLowerCase();
  const sub = String(hit.subtitle || '').toLowerCase();
  const h = String(hit.haystack || '');
  let score = KIND_WEIGHT[hit.kind] || 0;
  if (rawQuery && title === rawQuery) score += 100;
  else if (rawQuery && title.startsWith(rawQuery)) score += 70;
  else if (terms.some((t) => title.includes(t))) score += 40;
  if (terms.some((t) => sub.includes(t))) score += 12;
  if (matchesHaystack(h, terms)) score += 8;
  if (hit.pack) score += 2;
  return score;
}

function isFabricPubkey (value) {
  return /^(?:0[23][0-9a-fA-F]{64}|[0-9a-fA-F]{64})$/.test(String(value || '').trim());
}

function shortKey (pk) {
  const s = String(pk || '');
  if (s.length < 12) return s;
  return s.slice(0, 8) + '…';
}

function discordChannelKey (id) {
  const s = String(id || '').trim();
  if (!s) return null;
  return s.startsWith('discord:') ? s : ('discord:' + s);
}

/**
 * @param {object} fields
 * @returns {object}
 */
function makeHit (fields) {
  const kind = String(fields.kind || 'inbox');
  const id = String(fields.id || fields.title || kind);
  const title = String(fields.title || id);
  const subtitle = fields.subtitle != null ? String(fields.subtitle) : '';
  const pack = fields.pack || null;
  const href = fields.href || hrefFor(kind, id);
  const hash = fields.hash || null;
  const channel = fields.channel || null;
  const peopleQuery = fields.peopleQuery || null;
  const rosterMode = fields.rosterMode || null;
  const networkView = fields.networkView || null;
  const tab = fields.tab || null;
  return {
    kind,
    label: KIND_LABELS[kind] || kind,
    id,
    title,
    subtitle,
    pack,
    href,
    hash,
    tab,
    channel,
    peopleQuery,
    rosterMode,
    networkView,
    haystack: fields.haystack || haystack([title, subtitle, kind, pack, id])
  };
}

function pushUnique (byKey, hit) {
  if (!hit || !hit.id) return;
  const key = hit.kind + ':' + hit.id;
  const prev = byKey.get(key);
  if (!prev) {
    byKey.set(key, hit);
    return;
  }
  if ((hit.haystack || '').length > (prev.haystack || '').length) {
    byKey.set(key, Object.assign({}, prev, hit, {
      haystack: haystack([prev.haystack, hit.haystack])
    }));
  }
}

function indexPeople (byKey, catalog) {
  const guilds = (catalog && Array.isArray(catalog.guilds)) ? catalog.guilds : [];
  const links = (catalog && catalog.identityLinks) || [];
  const linkByDiscord = new Map();
  for (const link of links) {
    if (link && link.discordUserId) linkByDiscord.set(String(link.discordUserId), link);
  }
  let n = 0;
  for (const guild of guilds) {
    if (!guild) continue;
    const gname = guild.name || guild.id;
    for (const member of guild.members || []) {
      if (!member || member.id == null) continue;
      const uid = String(member.id);
      const link = linkByDiscord.get(uid);
      const pubkey = link && link.pubkey ? String(link.pubkey) : ('discord:' + uid);
      const handle = member.displayName || member.username || uid;
      const fabric = isFabricPubkey(pubkey);
      pushUnique(byKey, makeHit({
        kind: 'person',
        id: pubkey,
        title: handle,
        subtitle: (gname ? gname + ' · ' : '') + (fabric ? shortKey(pubkey) : uid),
        pack: groupDataSync.PACK_CHAT_CATALOG,
        hash: 'chat',
        tab: 'chat',
        peopleQuery: handle,
        haystack: haystack([handle, member.username, uid, pubkey, gname, 'discord', 'person'])
      }));
      n += 1;
      if (n >= 400) return;
    }
  }
}

function indexGuilds (byKey, catalog) {
  const guilds = (catalog && Array.isArray(catalog.guilds)) ? catalog.guilds : [];
  for (const guild of guilds) {
    if (!guild || guild.id == null) continue;
    pushUnique(byKey, makeHit({
      kind: 'guild',
      id: 'guild:' + guild.id,
      title: guild.name || String(guild.id),
      subtitle: 'Discord server',
      pack: groupDataSync.PACK_CHAT_CATALOG,
      hash: 'chat',
      tab: 'chat',
      haystack: haystack([guild.name, guild.id, 'discord', 'guild', 'server'])
    }));
    for (const ch of guild.channels || []) {
      if (!ch || ch.id == null) continue;
      const key = discordChannelKey(ch.id);
      pushUnique(byKey, makeHit({
        kind: 'channel',
        id: key,
        title: (ch.name ? '#' + ch.name : key),
        subtitle: (guild.name || 'Discord') + ' channel',
        pack: groupDataSync.PACK_CHAT_CATALOG,
        hash: 'chat',
        tab: 'chat',
        channel: key,
        haystack: haystack([ch.name, ch.id, guild.name, 'discord', 'channel'])
      }));
    }
  }
}

function indexChatChannels (byKey, channels) {
  for (const ch of channels || []) {
    if (!ch || !ch.key) continue;
    pushUnique(byKey, makeHit({
      kind: 'channel',
      id: ch.key,
      title: ch.label || ch.key,
      subtitle: ch.kind === 'global' ? 'Public shoutbox' : (ch.kind || 'channel'),
      hash: 'chat',
      tab: 'chat',
      channel: ch.key,
      haystack: haystack([ch.label, ch.key, ch.kind, ch.guildName])
    }));
  }
}

function indexMessages (byKey, rows, pack) {
  let n = 0;
  for (const m of rows || []) {
    if (!m) continue;
    const body = String(m.body || '').trim();
    if (!body) continue;
    const channel = m.channel
      ? String(m.channel)
      : (m.channelId ? discordChannelKey(m.channelId) : null);
    const id = String(m.id || m.discordMessageId || (channel + ':' + (m.ts || n)));
    const handle = m.handle || m.authorId || m.author || '';
    pushUnique(byKey, makeHit({
      kind: 'message',
      id: 'msg:' + id,
      title: body.slice(0, 80),
      subtitle: handle ? String(handle) : (channel || 'message'),
      pack: pack || groupDataSync.PACK_CHAT_MESSAGES,
      hash: 'chat',
      tab: 'chat',
      channel,
      haystack: haystack([body, handle, channel, m.author, 'message', 'chat'])
    }));
    n += 1;
    if (n >= 240) break;
  }
}

function indexNotes (byKey, notes) {
  for (const note of notes || []) {
    if (!note) continue;
    const subject = note.subject || note.id;
    const handle = note.subjectHandle || subject;
    const fabric = isFabricPubkey(subject);
    pushUnique(byKey, makeHit({
      kind: 'note',
      id: 'note:' + (note.id || subject),
      title: String(note.body || '').slice(0, 80),
      subtitle: 'Note on ' + handle,
      hash: 'chat',
      tab: 'chat',
      peopleQuery: handle,
      haystack: haystack([note.body, handle, subject, note.visibility, 'note'])
    }));
    pushUnique(byKey, makeHit({
      kind: 'person',
      id: String(subject),
      title: String(handle),
      subtitle: fabric ? shortKey(subject) : String(subject),
      hash: 'chat',
      tab: 'chat',
      peopleQuery: String(handle),
      haystack: haystack([handle, subject, note.body, 'person'])
    }));
  }
}

function indexGroups (byKey, groups) {
  for (const g of groups || []) {
    if (!g || !g.id) continue;
    const members = Array.isArray(g.members) ? g.members : [];
    pushUnique(byKey, makeHit({
      kind: 'group',
      id: g.id,
      title: g.name || g.id,
      subtitle: (g.visibility || 'group') + (g.memberCount != null
        ? (' · ' + g.memberCount + ' members')
        : (members.length ? (' · ' + members.length + ' members') : '')),
      href: '/groups/' + encodeURIComponent(g.slug || g.id),
      hash: 'groups?id=' + encodeURIComponent(g.id),
      tab: 'groups',
      haystack: haystack([g.name, g.id, g.slug, g.visibility, members.join(' '), 'group', 'fabric'])
    }));
  }
}

function indexLocalTags (byKey, tags) {
  for (const t of tags || []) {
    if (!t || !t.id) continue;
    pushUnique(byKey, makeHit({
      kind: 'local-tag',
      id: t.id,
      title: t.name || t.id,
      subtitle: 'Local tag',
      hash: 'groups',
      tab: 'groups',
      rosterMode: 'local',
      haystack: haystack([t.name, t.id, 'local', 'tag'])
    }));
  }
}

function indexMissions (byKey, missions) {
  for (const m of missions || []) {
    if (!m) continue;
    const id = m.id || m._id;
    if (!id) continue;
    pushUnique(byKey, makeHit({
      kind: 'mission',
      id: String(id),
      title: m.title || m.name || String(id),
      subtitle: [m.status, m.type, m.location].filter(Boolean).join(' · ') || 'Mission',
      href: '/missions/' + encodeURIComponent(id),
      hash: 'missions',
      tab: 'missions',
      haystack: haystack([m.title, m.name, m.description, m.status, m.type, m.location, m.issuer, 'mission'])
    }));
  }
}

function indexFleets (byKey, fleets) {
  for (const f of fleets || []) {
    if (!f) continue;
    const id = f.id || f.fleetId;
    if (!id) continue;
    pushUnique(byKey, makeHit({
      kind: 'fleet',
      id: String(id),
      title: f.name || String(id),
      subtitle: (f.shipCount != null ? f.shipCount + ' ships' : 'Fleet'),
      hash: 'fleet?id=' + encodeURIComponent(id),
      tab: 'fleet',
      haystack: haystack([f.name, id, f.visibility, 'fleet'])
    }));
  }
}

function indexPeers (byKey, peers) {
  for (const p of peers || []) {
    if (!p) continue;
    const pubkey = p.pubkey || p.expectedPubkey || null;
    const alias = p.alias || p.nickname || p.label || null;
    const address = p.address || null;
    if (!pubkey && !alias && !address) continue;
    const fabric = isFabricPubkey(pubkey);
    pushUnique(byKey, makeHit({
      kind: 'peer',
      id: String(pubkey || address || alias),
      title: alias || (fabric ? shortKey(pubkey) : String(address || pubkey)),
      subtitle: fabric ? shortKey(pubkey) : (address || 'Peer'),
      hash: 'network/peers',
      tab: 'network',
      networkView: 'peers',
      haystack: haystack([alias, pubkey, address, p.label, 'peer'])
    }));
  }
}

function indexPlayers (byKey, players) {
  let n = 0;
  for (const p of players || []) {
    if (!p) continue;
    const name = p.name || p.handle || p.id;
    if (!name) continue;
    pushUnique(byKey, makeHit({
      kind: 'player',
      id: 'player:' + name,
      title: String(name),
      subtitle: 'Pilot (Game.log)',
      hash: '',
      tab: 'home',
      haystack: haystack([name, p.id, 'pilot', 'player'])
    }));
    n += 1;
    if (n >= 200) break;
  }
}

function indexInbox (byKey, rows) {
  let n = 0;
  for (const row of rows || []) {
    if (!row) continue;
    pushUnique(byKey, makeHit({
      kind: 'inbox',
      id: 'inbox:' + (row.id || n),
      title: row.title || row.kind || 'Inbox',
      subtitle: row.kind || 'Notification',
      hash: 'notifications',
      tab: 'notifications',
      haystack: haystack([row.title, row.body, row.kind, row.handle, 'inbox', 'notification'])
    }));
    n += 1;
    if (n >= 80) break;
  }
}

function indexSnapshots (byKey, rows) {
  for (const s of rows || []) {
    if (!s || !s.id) continue;
    pushUnique(byKey, makeHit({
      kind: 'snapshot',
      id: s.id,
      title: s.file || s.id,
      subtitle: s.ts ? String(s.ts) : 'Snapshot',
      hash: 'library',
      tab: 'library',
      haystack: haystack([s.file, s.id, s.ts, 'snapshot', 'library'])
    }));
  }
}

function indexPlaytimes (byKey, rows) {
  for (const row of rows || []) {
    if (!row || !row.pubkey) continue;
    pushUnique(byKey, makeHit({
      kind: 'playtimes',
      id: 'play:' + row.pubkey,
      title: shortKey(row.pubkey),
      subtitle: 'Shared play times',
      pack: groupDataSync.PACK_PROFILE_PLAYTIMES,
      href: '/profiles/' + encodeURIComponent(row.pubkey),
      haystack: haystack([row.pubkey, 'playtimes', 'when they play', 'profile'])
    }));
  }
}

function indexFiles (byKey, rows) {
  for (const row of rows || []) {
    if (!row || !(row.id || row.sha256)) continue;
    const id = row.id || row.sha256;
    pushUnique(byKey, makeHit({
      kind: 'file',
      id,
      title: row.name || id,
      subtitle: row.profilePinned ? 'Pinned on profile' : 'File',
      pack: groupDataSync.PACK_PROFILE_FILES,
      href: hrefFor('file', id),
      haystack: haystack([row.name, id, row.mime, 'file', 'build', 'document', 'profile'])
    }));
  }
}

function indexLocations (byKey, locations) {
  for (const loc of locations || []) {
    if (!loc || !loc.slug) continue;
    pushUnique(byKey, makeHit({
      kind: 'location',
      id: loc.slug,
      title: loc.name || loc.slug,
      subtitle: [loc.system, loc.type, loc.parent].filter(Boolean).join(' · ') || 'Location',
      href: hrefFor('location', loc.slug),
      tab: 'map',
      haystack: haystack([
        loc.name, loc.slug, loc.system, loc.parent, loc.tag, loc.type, loc.designation,
        ...(loc.aliases || []),
        'location', 'map', 'starmap'
      ])
    }));
  }
}

/**
 * Flatten local collections into searchable hits.
 * @param {object} [corpus]
 * @returns {object[]}
 */
function buildHits (corpus = {}) {
  const byKey = new Map();
  indexPeople(byKey, corpus.catalog);
  indexGuilds(byKey, corpus.catalog);
  indexChatChannels(byKey, corpus.chatChannels);
  indexMessages(byKey, corpus.discordMessages, groupDataSync.PACK_CHAT_MESSAGES);
  indexMessages(byKey, corpus.chatMessages, groupDataSync.PACK_CHAT_MESSAGES);
  indexNotes(byKey, corpus.notes);
  indexGroups(byKey, corpus.groups);
  indexLocalTags(byKey, corpus.localTags);
  indexMissions(byKey, corpus.missions);
  indexFleets(byKey, corpus.fleets);
  indexPeers(byKey, corpus.peers);
  indexPlayers(byKey, corpus.players);
  indexInbox(byKey, corpus.inbox);
  indexSnapshots(byKey, corpus.snapshots);
  indexPlaytimes(byKey, corpus.playtimes);
  indexFiles(byKey, corpus.documents);
  indexLocations(byKey, corpus.locations);
  return Array.from(byKey.values());
}

function indexedPacks (corpus = {}) {
  const catalog = corpus.catalog && Array.isArray(corpus.catalog.guilds)
    ? corpus.catalog.guilds.length
    : 0;
  const discordMsgs = Array.isArray(corpus.discordMessages) ? corpus.discordMessages.length : 0;
  const chatMsgs = Array.isArray(corpus.chatMessages) ? corpus.chatMessages.length : 0;
  const play = Array.isArray(corpus.playtimes) ? corpus.playtimes.length : 0;
  const files = Array.isArray(corpus.documents) ? corpus.documents.length : 0;
  return [
    {
      pack: groupDataSync.PACK_CHAT_CATALOG,
      indexed: catalog > 0,
      count: catalog
    },
    {
      pack: groupDataSync.PACK_CHAT_MESSAGES,
      indexed: (discordMsgs + chatMsgs) > 0,
      count: discordMsgs + chatMsgs
    },
    {
      pack: groupDataSync.PACK_PROFILE_PLAYTIMES,
      indexed: play > 0,
      count: play
    },
    {
      pack: groupDataSync.PACK_PROFILE_FILES,
      indexed: files > 0,
      count: files
    }
  ];
}

function publicHit (hit) {
  const out = {
    kind: hit.kind,
    label: hit.label,
    id: hit.id,
    title: hit.title,
    subtitle: hit.subtitle,
    pack: hit.pack,
    href: hit.href,
    hash: hit.hash,
    tab: hit.tab,
    channel: hit.channel,
    peopleQuery: hit.peopleQuery,
    rosterMode: hit.rosterMode,
    networkView: hit.networkView
  };
  return out;
}

/**
 * @param {object} corpus
 * @param {string} [query]
 * @param {Object} [opts]
 * @param {number} [opts.limit]
 * @returns {{ query: string, hits: object[], packs: object[], queriedAt: string }}
 */
function searchCorpus (corpus, query, opts = {}) {
  const raw = normalizeQuery(query);
  const terms = keywords(raw);
  const limit = Math.max(1, Math.min(MAX_LIMIT, Number(opts.limit) || DEFAULT_LIMIT));
  const packs = indexedPacks(corpus);
  if (!terms.length) {
    return { query: raw, hits: [], packs, queriedAt: new Date().toISOString() };
  }
  const scored = [];
  for (const hit of buildHits(corpus)) {
    if (!matchesHaystack(hit.haystack, terms)) continue;
    scored.push({ hit, score: scoreHit(hit, terms, raw) });
  }
  scored.sort((a, b) => b.score - a.score || String(a.hit.title).localeCompare(String(b.hit.title)));
  return {
    query: raw,
    hits: scored.slice(0, limit).map((row) => publicHit(row.hit)),
    packs,
    queriedAt: new Date().toISOString()
  };
}

/**
 * Browser path for a search hit without session side-effects.
 * Home-tab hits use `/` so they can be `<a href>` targets.
 * @param {object} hit
 * @returns {string|null}
 */
function hrefOfHit (hit) {
  if (!hit) return null;
  if (hit.href) return String(hit.href);
  if (hit.hash != null && hit.hash !== '') return '#' + String(hit.hash).replace(/^#/, '');
  if (hit.tab) return hit.tab === 'home' ? '/' : ('#' + hit.tab);
  return null;
}

/**
 * Apply navigation side-effects (Chat channel / people query, Groups local tags).
 * @param {object} hit
 * @param {Storage} [session]
 * @param {Storage} [local]
 * @returns {string|null} href or hash to open
 */
function applySearchHit (hit, session, local) {
  if (!hit) return null;
  const sess = session || (typeof sessionStorage !== 'undefined' ? sessionStorage : null);
  const loc = local || (typeof localStorage !== 'undefined' ? localStorage : null);
  try {
    if (hit.channel && sess) sess.setItem(CHAT_CHANNEL_KEY, String(hit.channel));
    if (hit.peopleQuery && sess) sess.setItem(CHAT_PEOPLE_KEY, String(hit.peopleQuery));
    if (hit.rosterMode === 'local' && loc) loc.setItem(GROUPS_ROSTER_KEY, 'local');
  } catch (_) { /* ignore */ }
  if (hit.href) return hit.href;
  if (hit.hash != null && hit.hash !== '') return '#' + String(hit.hash).replace(/^#/, '');
  if (hit.tab) return hit.tab === 'home' ? '' : ('#' + hit.tab);
  return null;
}

module.exports = {
  DEFAULT_LIMIT,
  MAX_LIMIT,
  KIND_LABELS,
  CHAT_CHANNEL_KEY,
  CHAT_PEOPLE_KEY,
  GROUPS_ROSTER_KEY,
  normalizeQuery,
  keywords,
  buildHits,
  searchCorpus,
  applySearchHit,
  hrefOfHit,
  makeHit
};
