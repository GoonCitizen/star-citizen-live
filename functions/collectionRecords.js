'use strict';

/**
 * Dedicated collection pages for local search hits (`/collections/:kind/:id`)
 * plus first-class aliases (`/profiles`, `/groups`, `/missions`).
 */

const { isFabricPubkey, profileHref } = require('./identityActor');

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
  playtimes: 'When they fly',
  file: 'File',
  document: 'File',
  location: 'Location',
  'fabric-message': 'Fabric message'
});

const KIND_ALIASES = Object.freeze({
  person: 'profiles',
  peer: 'profiles',
  playtimes: 'profiles',
  file: 'files',
  document: 'files',
  group: 'groups',
  mission: 'missions',
  location: 'locations'
});

const ID_PREFIX = Object.freeze({
  note: 'note:',
  message: 'msg:',
  inbox: 'inbox:',
  player: 'player:',
  guild: 'guild:',
  playtimes: 'play:',
  file: 'file:',
  document: 'file:'
});

/**
 * @param {string} kind
 * @returns {string}
 */
function kindLabel (kind) {
  const k = String(kind || '');
  return KIND_LABELS[k] || k;
}

/**
 * @param {string} kind
 * @param {*} id
 * @returns {string}
 */
function normalizeRecordId (kind, id) {
  const k = String(kind || '');
  let s = String(id == null ? '' : id).trim();
  try { s = decodeURIComponent(s); } catch (_) { /* keep raw */ }
  const prefix = ID_PREFIX[k];
  if (prefix && s.indexOf(prefix) === 0) return s.slice(prefix.length);
  return s;
}

/**
 * Canonical browser path for a search kind + id.
 * @param {string} kind
 * @param {*} id
 * @returns {string|null}
 */
function hrefFor (kind, id) {
  const k = String(kind || '');
  if (!k || id == null || id === '') return null;
  const recId = normalizeRecordId(k, id);
  if (!recId) return null;
  if (k === 'person' || k === 'playtimes' || (k === 'peer' && isFabricPubkey(recId))) {
    return profileHref(recId) || ('/profiles/' + encodeURIComponent(recId));
  }
  if (k === 'group') return '/groups/' + encodeURIComponent(recId);
  if (k === 'mission') return '/missions/' + encodeURIComponent(recId);
  if (k === 'file' || k === 'document') return '/files/' + encodeURIComponent(recId);
  if (k === 'location') return '/locations/' + encodeURIComponent(recId);
  return '/collections/' + encodeURIComponent(k) + '/' + encodeURIComponent(recId);
}

/**
 * @param {*} hash
 * @returns {string|null}
 */
function fabricMessageHref (hash) {
  const s = String(hash || '').trim();
  if (!s) return null;
  return hrefFor('fabric-message', s);
}

function findRow (list, id, keys) {
  const s = String(id);
  const ks = keys || ['id'];
  return (list || []).find((row) => {
    if (!row) return false;
    return ks.some((key) => row[key] != null && String(row[key]) === s);
  }) || null;
}

function recordShell (kind, id, fields) {
  return Object.assign({
    type: 'CollectionRecord',
    kind,
    collection: KIND_ALIASES[kind] || kind,
    id,
    title: id,
    subtitle: kindLabel(kind),
    href: hrefFor(kind, id),
    record: null,
    links: [],
    actions: []
  }, fields || {});
}

function chatAction (opts) {
  return Object.assign({
    rel: 'chat',
    title: 'Open in Chat',
    hash: 'chat',
    href: '/#chat'
  }, opts || {});
}

/**
 * @param {string} kind
 * @param {*} rawId
 * @param {Object} [ctx]
 * @returns {object|null}
 */
function load (kind, rawId, ctx = {}) {
  const k = String(kind || '').trim();
  const id = normalizeRecordId(k, rawId);
  if (!k || !id) return null;
  const corpus = ctx.corpus || {};

  if (k === 'note') {
    const note = (ctx.getNote && ctx.getNote(id))
      || findRow(corpus.notes, id, ['id']);
    if (!note) return null;
    const subject = note.subject || null;
    const links = [];
    if (subject) {
      const href = profileHref(subject) || hrefFor('person', subject);
      if (href) links.push({ rel: 'profile', href, title: note.subjectHandle || subject });
    }
    return recordShell(k, id, {
      title: String(note.body || '').slice(0, 80) || 'Note',
      subtitle: 'Note on ' + (note.subjectHandle || subject || id),
      record: note,
      links,
      actions: subject ? [chatAction({ peopleQuery: note.subjectHandle || subject })] : []
    });
  }

  if (k === 'guild') {
    const guilds = (corpus.catalog && corpus.catalog.guilds) || [];
    const guild = findRow(guilds, id, ['id']);
    if (!guild) return null;
    return recordShell(k, id, {
      title: guild.name || String(id),
      subtitle: 'Discord server',
      record: {
        id: guild.id,
        name: guild.name,
        memberCount: guild.memberCount,
        truncated: guild.truncated,
        channels: (guild.channels || []).map((ch) => ({
          id: ch.id,
          name: ch.name,
          href: hrefFor('channel', ch.id && String(ch.id).indexOf('discord:') === 0
            ? ch.id
            : ('discord:' + ch.id))
        }))
      },
      actions: [chatAction()]
    });
  }

  if (k === 'channel') {
    const channels = corpus.chatChannels || [];
    let ch = findRow(channels, id, ['key', 'id']);
    if (!ch) {
      for (const guild of (corpus.catalog && corpus.catalog.guilds) || []) {
        const raw = String(id).replace(/^discord:/, '');
        const found = (guild.channels || []).find((row) => row && String(row.id) === raw);
        if (found) {
          ch = {
            key: id.indexOf('discord:') === 0 ? id : ('discord:' + found.id),
            label: found.name ? '#' + found.name : id,
            kind: 'discord',
            guildName: guild.name,
            guildId: guild.id
          };
          break;
        }
      }
    }
    if (!ch) {
      return recordShell(k, id, {
        title: id,
        subtitle: 'Channel',
        record: { key: id },
        actions: [chatAction({ channel: id })]
      });
    }
    return recordShell(k, id, {
      title: ch.label || ch.name || ch.key || id,
      subtitle: [ch.kind, ch.guildName].filter(Boolean).join(' · ') || 'Channel',
      record: ch,
      actions: [chatAction({ channel: ch.key || id })]
    });
  }

  if (k === 'message') {
    const rows = [].concat(corpus.chatMessages || [], corpus.discordMessages || []);
    const msg = (ctx.getChatMessage && ctx.getChatMessage(id))
      || findRow(rows, id, ['id', 'discordMessageId']);
    if (!msg) return null;
    const author = msg.author || msg.authorId || null;
    const links = [];
    if (author) {
      const href = profileHref(author) || hrefFor('person', author);
      if (href) links.push({ rel: 'profile', href, title: msg.handle || author });
    }
    return recordShell(k, id, {
      title: String(msg.body || '').slice(0, 80) || 'Message',
      subtitle: msg.handle || msg.channel || 'Message',
      record: msg,
      links,
      actions: [chatAction({
        channel: msg.channel || (msg.channelId ? ('discord:' + msg.channelId) : null),
        peopleQuery: msg.handle || null
      })]
    });
  }

  if (k === 'fleet') {
    const fleet = (ctx.getFleet && ctx.getFleet(id))
      || findRow(corpus.fleets, id, ['id', 'fleetId']);
    if (!fleet) return null;
    return recordShell(k, id, {
      title: fleet.name || id,
      subtitle: fleet.shipCount != null ? (fleet.shipCount + ' ships') : 'Fleet',
      record: fleet,
      actions: [{ rel: 'dashboard', title: 'Open Fleets', href: '/#fleet?id=' + encodeURIComponent(id) }]
    });
  }

  if (k === 'local-tag') {
    const tag = (ctx.getLocalTag && ctx.getLocalTag(id))
      || findRow(corpus.localTags, id, ['id']);
    if (!tag) return null;
    const links = (tag.members || []).slice(0, 40).map((member) => {
      const href = profileHref(member) || hrefFor('person', member);
      return href ? { rel: 'member', href, title: member } : null;
    }).filter(Boolean);
    return recordShell(k, id, {
      title: tag.name || id,
      subtitle: 'Local tag',
      record: tag,
      links,
      actions: [{ rel: 'dashboard', title: 'Open local tags', href: '/#groups' }]
    });
  }

  if (k === 'inbox') {
    const row = (ctx.getInbox && ctx.getInbox(id))
      || findRow(corpus.inbox, id, ['id']);
    if (!row) return null;
    return recordShell(k, id, {
      title: row.title || row.kind || 'Inbox',
      subtitle: row.kind || 'Notification',
      record: row,
      actions: [{ rel: 'dashboard', title: 'Open Notifications', href: '/#notifications' }]
    });
  }

  if (k === 'snapshot') {
    const snap = (ctx.getSnapshot && ctx.getSnapshot(id))
      || findRow(corpus.snapshots, id, ['id']);
    if (!snap) return null;
    return recordShell(k, id, {
      title: snap.file || snap.id || id,
      subtitle: snap.ts ? String(snap.ts) : 'Snapshot',
      record: snap,
      actions: [{ rel: 'dashboard', title: 'Open Library', href: '/#library' }]
    });
  }

  if (k === 'player') {
    const player = findRow(corpus.players, id, ['name', 'handle', 'id'])
      || { name: id };
    return recordShell(k, id, {
      title: player.name || player.handle || id,
      subtitle: 'Pilot (Game.log)',
      record: player,
      actions: [{ rel: 'dashboard', title: 'Open Feed', href: '/' }]
    });
  }

  if (k === 'peer') {
    const peer = findRow(corpus.peers, id, ['pubkey', 'address', 'id', 'alias']);
    if (!peer) {
      if (isFabricPubkey(id)) {
        return recordShell(k, id, {
          title: id,
          subtitle: 'Peer',
          record: { pubkey: id },
          links: [{ rel: 'profile', href: '/profiles/' + encodeURIComponent(id), title: 'Profile' }]
        });
      }
      return null;
    }
    const pk = peer.pubkey || null;
    return recordShell(k, id, {
      title: peer.alias || peer.nickname || pk || peer.address || id,
      subtitle: peer.address || 'Peer',
      record: peer,
      links: pk
        ? [{ rel: 'profile', href: '/profiles/' + encodeURIComponent(pk), title: 'Profile' }]
        : [],
      actions: [{ rel: 'dashboard', title: 'Open Peers', href: '/#network/peers' }]
    });
  }

  if (k === 'group') {
    const group = (ctx.getGroup && ctx.getGroup(id))
      || findRow(corpus.groups, id, ['id', 'slug']);
    if (!group) return null;
    return recordShell(k, id, {
      title: group.name || id,
      subtitle: group.visibility || 'Group',
      record: group,
      href: '/groups/' + encodeURIComponent(group.slug || group.id || id)
    });
  }

  if (k === 'mission') {
    const mission = findRow(corpus.missions, id, ['id', '_id']);
    if (!mission) return null;
    return recordShell(k, id, {
      title: mission.title || mission.name || id,
      subtitle: mission.status || 'Mission',
      record: mission,
      href: '/missions/' + encodeURIComponent(mission.id || id)
    });
  }

  if (k === 'person' || k === 'playtimes') {
    const href = hrefFor(k, id);
    return recordShell(k, id, {
      title: id,
      subtitle: kindLabel(k),
      record: { id },
      href,
      links: href ? [{ rel: 'profile', href, title: 'Profile' }] : []
    });
  }

  if (k === 'file' || k === 'document') {
    const doc = (ctx.getDocument && ctx.getDocument(id))
      || findRow(corpus.documents || corpus.files, id, ['id', 'sha256']);
    if (!doc) {
      return recordShell(k, id, {
        title: id,
        subtitle: 'File',
        record: { id },
        href: hrefFor(k, id),
        missing: true
      });
    }
    return recordShell(k, id, {
      title: doc.name || id,
      subtitle: [doc.mime, doc.size != null ? (doc.size + ' B') : null].filter(Boolean).join(' · ') || 'File',
      record: doc,
      href: hrefFor(k, doc.id || id),
      links: doc.publisher
        ? [{ rel: 'profile', href: profileHref(doc.publisher) || hrefFor('person', doc.publisher), title: 'Publisher' }]
        : []
    });
  }

  if (k === 'location') {
    const loc = (ctx.getLocation && ctx.getLocation(id))
      || findRow(corpus.locations, id, ['slug', 'name']);
    if (!loc) return null;
    const slug = loc.slug || id;
    return recordShell(k, slug, {
      title: loc.name || slug,
      subtitle: [loc.system, loc.type, loc.parent].filter(Boolean).join(' · ') || 'Location',
      record: loc,
      href: hrefFor('location', slug)
    });
  }

  if (k === 'fabric-message') {
    const entry = (ctx.getFabricMessage && ctx.getFabricMessage(id)) || null;
    return recordShell(k, id, {
      title: (entry && (entry.friendlyType || entry.type || entry.appType)) || 'Fabric message',
      subtitle: entry ? ((entry.direction || '') + ' · ' + (entry.hash || id)) : ('hash ' + id),
      record: entry || { hash: id, missing: true },
      missing: !entry
    });
  }

  return null;
}

module.exports = {
  KIND_LABELS,
  KIND_ALIASES,
  kindLabel,
  normalizeRecordId,
  hrefFor,
  fabricMessageHref,
  load
};
