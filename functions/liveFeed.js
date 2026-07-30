'use strict';

/**
 * Build a chat-style activity stream from local parse buffers + peer ingest
 * (collections, chat, mission broadcasts). Newest last (Chat UI order).
 *
 * Each item carries:
 *   - body — user-facing summary
 *   - badges — recognized fields ({ kind, value, label? })
 *   - provenance — where it came from (local Game.log vs peer pubkey/alias)
 *   - raw / hasRaw — optional Game.log line behind a UI control
 */

const { missionType, missionFaction, isNPC } = require('./parser');

const FEED_CATEGORIES = Object.freeze([
  ['chat', 'Chat'],
  ['mission', 'Missions'],
  ['combat', 'Combat'],
  ['player', 'Players'],
  ['quantum', 'Quantum'],
  ['broadcast', 'Broadcasts'],
  ['notify', 'HUD'],
  ['log', 'Other']
]);

const FEED_SOURCES = Object.freeze([
  ['local', 'Local'],
  ['peer', 'Peers']
]);

/** Badge kinds rendered with distinct styles in the Feed UI. */
const BADGE_KINDS = Object.freeze([
  'player', 'mission', 'type', 'faction', 'outcome', 'weapon',
  'ship', 'zone', 'channel', 'npc', 'status', 'destination'
]);

/**
 * @param {string|null|undefined} kind
 * @returns {string}
 */
function categoryForKind (kind) {
  const k = String(kind || '');
  if (k === 'ChatMessage' || k === 'chat') return 'chat';
  if (k === 'MissionBroadcast' || k === 'broadcast') return 'broadcast';
  if (k.indexOf('mission:') === 0) return 'mission';
  if (k === 'kill' || k === 'player:death' || k === 'player:incap' || k === 'vehicle:destroy') {
    return 'combat';
  }
  if (k.indexOf('quantum:') === 0) return 'quantum';
  if (k === 'hud:notification') return 'notify';
  if (k === 'player:login' || k === 'player:crimestat' || k.indexOf('session:') === 0) {
    return 'player';
  }
  if (k === 'log:raw' || k === 'log:notice' || !k || k === 'log') return 'log';
  if (k.indexOf('player:') === 0) return 'player';
  return 'log';
}

/**
 * @param {*} source
 * @returns {'local'|'peer'}
 */
function sourceKind (source) {
  return source ? 'peer' : 'local';
}

function shortKey (pk) {
  const s = String(pk || '');
  return s.length > 10 ? s.slice(0, 8) + '…' : (s || null);
}

/** True when `raw` is a distinct Game.log (or wire) line worth revealing. */
function hasDistinctRaw (body, raw) {
  const b = String(body || '').trim();
  const r = String(raw || '').trim();
  if (!r || r === b) return false;
  return true;
}

/**
 * @param {string} kind
 * @param {*} value
 * @param {string} [label]
 * @returns {{ kind: string, value: string, label: string }|null}
 */
function badge (kind, value, label) {
  if (value === undefined || value === null || value === '') return null;
  const v = String(value).trim();
  if (!v) return null;
  return { kind: String(kind), value: v, label: label || String(kind) };
}

function badges (...list) {
  const out = [];
  const seen = new Set();
  for (const b of list) {
    if (!b || !b.value) continue;
    const key = b.kind + ':' + b.value;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(b);
  }
  return out;
}

/**
 * @param {object} item
 * @param {{ aliases?: Record<string,string>, profiles?: Record<string,object>, selfPubkey?: string|null }} [ctx]
 */
function buildProvenance (item, ctx = {}) {
  const aliases = ctx.aliases || {};
  const profiles = ctx.profiles || {};
  const selfPubkey = ctx.selfPubkey || null;
  const sourceId = item.sourceId ? String(item.sourceId) : null;
  const resolveAlias = (pk) => {
    if (!pk) return null;
    if (aliases[pk]) return String(aliases[pk]);
    const prof = profiles[pk];
    if (prof && (prof.nickname || prof.alias)) return String(prof.nickname || prof.alias);
    return null;
  };

  if (item.source === 'peer' && sourceId) {
    const peerAlias = resolveAlias(sourceId);
    return {
      origin: 'peer',
      peerId: sourceId,
      peerAlias,
      label: peerAlias || shortKey(sourceId) || 'peer',
      detail: peerAlias
        ? `${peerAlias} · ${shortKey(sourceId)}`
        : (shortKey(sourceId) || sourceId)
    };
  }

  if (sourceId && selfPubkey && sourceId === selfPubkey) {
    const peerAlias = resolveAlias(sourceId);
    return {
      origin: 'self',
      peerId: sourceId,
      peerAlias,
      label: peerAlias || 'you',
      detail: 'This node'
    };
  }

  return {
    origin: 'local',
    peerId: selfPubkey || null,
    peerAlias: resolveAlias(selfPubkey),
    label: 'local',
    detail: 'This Game.log / node'
  };
}

function finalizeItem (item, ctx) {
  if (!item) return item;
  item.hasRaw = hasDistinctRaw(item.body, item.raw);
  if (!item.hasRaw && item.raw && String(item.raw).trim() === String(item.body || '').trim()) {
    item.raw = null;
  }
  if (!Array.isArray(item.badges)) item.badges = [];
  item.provenance = buildProvenance(item, ctx);
  return item;
}

function pushItem (out, seen, item, ctx) {
  if (!item || !item.id) return;
  if (seen.has(item.id)) return;
  seen.add(item.id);
  out.push(finalizeItem(item, ctx));
}

function humanizeKind (kind) {
  return String(kind || 'event')
    .replace(/^[a-z]+:/, (m) => m.slice(0, -1) + ' ')
    .replace(/:/g, ' · ')
    .replace(/_/g, ' ');
}

/** Strip SC timestamp / channel prefix from a log line for short excerpts. */
function stripLogPrefix (raw) {
  let s = String(raw || '').trim();
  s = s.replace(/^<\d{4}-\d{2}-\d{2}T[^>]+>\s*/, '');
  s = s.replace(/^\[(Notice|Error|Warning|Display)\]\s*/i, '');
  s = s.replace(/^<[^>]+>\s*/, '');
  return s.trim();
}

function firstQuoted (raw) {
  const m = String(raw || '').match(/'([^']{2,80})'/);
  return m ? m[1] : null;
}

/**
 * User-facing summary for a recent buffer row (keep full line in `raw`).
 * @param {object} ev
 * @returns {string}
 */
function summarizeRecent (ev) {
  const kind = String(ev.kind || '');
  const raw = String(ev.raw || '');
  const rest = stripLogPrefix(raw);
  const q = firstQuoted(raw);

  if (kind === 'quantum:select') {
    return q ? `Selected quantum target: ${q}` : 'Selected a quantum target';
  }
  if (kind === 'quantum:arrive') {
    return q ? `Arrived at ${q}` : 'Quantum drive arrived';
  }
  if (kind === 'quantum:route') {
    return q ? `Plotted route to ${q}` : 'Calculating quantum route';
  }
  if (kind === 'session:start') return 'Game session started';
  if (kind === 'session:level') {
    const map = rest.match(/Loading level\s+(\S+)/i);
    return map ? `Loading ${map[1]}` : 'Loading level';
  }
  if (kind === 'session:gamemode') return 'Game mode ready';
  if (kind === 'session:disconnect') {
    const nick = raw.match(/nickname="([^"]+)"/);
    return nick ? `${nick[1]} disconnected` : 'Disconnected from server';
  }
  if (kind === 'player:crimestat') {
    return q ? `CrimeStat: ${q}` : (rest.slice(0, 140) || 'CrimeStat update');
  }
  if (kind === 'character:status') return q ? `Character: ${q}` : 'Character status update';
  if (kind.indexOf('inventory:') === 0) {
    return humanizeKind(kind).replace(/^inventory /, 'Inventory · ');
  }
  if (kind.indexOf('vehicle:') === 0 && kind !== 'vehicle:destroy') {
    return q ? `${humanizeKind(kind)}: ${q}` : humanizeKind(kind);
  }
  if (kind.indexOf('mission:') === 0) {
    return q || rest.slice(0, 160) || humanizeKind(kind);
  }
  if (kind === 'log:notice') {
    return rest.slice(0, 160) || 'Game notice';
  }
  if (kind === 'log:raw' || !ev.recognized) {
    return rest.slice(0, 140) || 'Unrecognized log line';
  }
  return rest.slice(0, 160) || humanizeKind(kind);
}

function missionFriendlyBody (m) {
  const kind = String(m.kind || '');
  const text = m.text || m.contract || m.generator || null;
  if (kind === 'mission:start') {
    return text ? `Mission started — ${text}` : 'Mission started';
  }
  if (kind === 'mission:end') {
    const outcome = m.completionType || m.outcome || 'ended';
    return text
      ? `Mission ${String(outcome).toLowerCase()} — ${text}`
      : `Mission ${String(outcome).toLowerCase()}`;
  }
  if (kind === 'mission:objective' || kind === 'mission:objective:state') {
    return text ? `Objective — ${text}` : 'Objective updated';
  }
  if (kind === 'mission:objective:marker') {
    return text ? `Objective marker — ${text}` : 'Objective marker updated';
  }
  if (kind === 'mission:contract') {
    return text ? `Contract — ${text}` : 'Contract generated';
  }
  if (kind === 'mission:notification') {
    return text || 'Mission notification';
  }
  if (kind === 'mission:marker') {
    return text ? `Mission marker — ${text}` : 'Mission marker';
  }
  return text || humanizeKind(kind || 'mission');
}

function killFriendlyBody (k) {
  const killer = k.killer || 'Someone';
  const victim = k.victim || 'someone';
  if (k.involves === 'death') {
    return `${victim} was killed by ${killer}` +
      (k.weapon ? ` (${k.weapon})` : '');
  }
  if (k.involves === 'kill') {
    return `${killer} killed ${victim}` +
      (k.weapon ? ` with ${k.weapon}` : '');
  }
  return `${killer} → ${victim}` +
    (k.weapon ? ` · ${k.weapon}` : '') +
    (k.damageType ? ` · ${k.damageType}` : '');
}

function itemFromChat (m) {
  const who = m.handle || shortKey(m.author) || 'peer';
  const ch = m.channel === 'global' ? 'global' : (m.channel || 'chat');
  return {
    id: 'chat:' + m.id,
    ts: m.ts || null,
    category: 'chat',
    // `source` is set on peer ingest; local posts only have `author`.
    source: sourceKind(m.source),
    sourceId: m.source || m.author || null,
    kind: 'ChatMessage',
    label: 'chat',
    who,
    body: m.body || '',
    meta: ch === 'global' ? 'Global chat' : ch,
    badges: badges(
      badge('player', m.handle || null, 'player'),
      badge('channel', ch === 'global' ? 'Global' : ch, 'channel')
    ),
    raw: null
  };
}

function itemFromBroadcast (b) {
  const mission = b.mission || {};
  const title = mission.title || b.missionId || 'mission';
  const typeName = mission.type || missionType(mission.generator || mission.title || title);
  const faction = mission.faction || missionFaction(mission.generator || null);
  const who = shortKey(b.source) || 'peer';
  const status = b.status || 'pending';
  return {
    id: 'bcast:' + b.id,
    ts: b.broadcastAt || b.createdAt || b.ts || null,
    category: 'broadcast',
    source: 'peer',
    sourceId: b.source || null,
    kind: 'MissionBroadcast',
    label: 'broadcast',
    who,
    body: `Offered mission: ${title}`,
    meta: status === 'pending' ? 'Awaiting accept' : status,
    badges: badges(
      badge('mission', title, 'mission'),
      badge('type', typeName !== 'Other' ? typeName : (mission.type || null), 'type'),
      badge('faction', faction !== 'Unknown' ? faction : null, 'faction'),
      badge('status', status, 'status'),
      badge('channel', b.scope === 'group' ? `group:${b.groupId || ''}` : 'network', 'scope')
    ),
    raw: null
  };
}

function itemFromKill (k) {
  const label = k.involves === 'death' ? 'death' : 'kill';
  const killerNpc = k.killerNpc === true || (k.killer && isNPC(k.killer));
  const victimNpc = k.victimNpc === true || (k.victim && isNPC(k.victim));
  return {
    id: 'kill:' + k.id,
    ts: k.timestamp || null,
    category: 'combat',
    source: sourceKind(k.source),
    sourceId: k.source || null,
    kind: 'kill',
    label,
    who: k.source ? shortKey(k.source) : null,
    body: killFriendlyBody(k),
    meta: k.damageType || null,
    badges: badges(
      badge('player', k.killer, 'killer'),
      badge('player', k.victim, 'victim'),
      badge('weapon', k.weapon, 'weapon'),
      badge('type', k.damageType, 'damage'),
      badge('zone', k.zone, 'zone'),
      killerNpc ? badge('npc', 'killer NPC', 'npc') : null,
      victimNpc ? badge('npc', 'victim NPC', 'npc') : null
    ),
    raw: k.raw || null
  };
}

function itemFromDeath (d) {
  const player = d.player || 'You';
  return {
    id: 'death:' + d.id,
    ts: d.timestamp || null,
    category: 'combat',
    source: sourceKind(d.source),
    sourceId: d.source || null,
    kind: d.kind || 'player:death',
    label: 'death',
    who: d.player || (d.source ? shortKey(d.source) : null),
    body: `${player} died` + (d.bodyId ? ' (corpse marked for recovery)' : ''),
    meta: null,
    badges: badges(badge('player', d.player || player, 'player')),
    raw: d.raw || null
  };
}

function itemFromIncap (d) {
  const player = d.player || 'You';
  return {
    id: 'incap:' + d.id,
    ts: d.timestamp || null,
    category: 'combat',
    source: sourceKind(d.source),
    sourceId: d.source || null,
    kind: d.kind || 'player:incap',
    label: 'down',
    who: d.player || null,
    body: d.text ? `${player} incapacitated — ${d.text}` : `${player} incapacitated`,
    meta: null,
    badges: badges(badge('player', d.player || player, 'player')),
    raw: d.raw || null
  };
}

function itemFromVehicle (v) {
  const name = v.vehicleName || v.vehicle || 'Vehicle';
  return {
    id: 'veh:' + v.id,
    ts: v.timestamp || null,
    category: 'combat',
    source: sourceKind(v.source),
    sourceId: v.source || null,
    kind: 'vehicle:destroy',
    label: 'vehicle',
    who: v.attacker || null,
    body: `${name} destroyed` +
      (v.cause ? ` (${v.cause})` : '') +
      (v.attacker ? ` by ${v.attacker}` : ''),
    meta: null,
    badges: badges(
      badge('ship', name, 'ship'),
      badge('player', v.attacker, 'attacker'),
      badge('type', v.cause, 'cause')
    ),
    raw: v.raw || null
  };
}

function itemFromMission (m) {
  const title = m.text || m.contract || m.generator || null;
  const typeName = missionType(m.generator || m.contract || m.text || null);
  const faction = missionFaction(m.generator || null);
  const outcome = m.completionType || m.outcome || null;
  return {
    id: 'mission:' + m.id,
    ts: m.timestamp || null,
    category: 'mission',
    source: sourceKind(m.source),
    sourceId: m.source || null,
    kind: m.kind || 'mission',
    label: (m.kind || 'mission').replace(/^mission:/, '') || 'mission',
    who: m.player || (m.source ? shortKey(m.source) : null),
    body: missionFriendlyBody(m),
    meta: m.missionId || m.objectiveId || null,
    badges: badges(
      badge('mission', title, 'mission'),
      badge('type', typeName !== 'Other' ? typeName : null, 'type'),
      badge('faction', faction !== 'Unknown' ? faction : null, 'faction'),
      badge('outcome', outcome, 'outcome'),
      badge('player', m.player, 'player')
    ),
    raw: m.raw || null
  };
}

function itemFromNotification (n) {
  return {
    id: 'hud:' + n.id,
    ts: n.timestamp || null,
    category: 'notify',
    source: sourceKind(n.source),
    sourceId: n.source || null,
    kind: n.kind || 'hud:notification',
    label: 'hud',
    who: null,
    body: n.text || 'HUD notification',
    meta: null,
    badges: badges(),
    raw: n.raw || null
  };
}

function itemFromLogin (l) {
  const name = l.name || l.handle || 'player';
  return {
    id: 'login:' + (l.id || name + '|' + l.timestamp),
    ts: l.timestamp || null,
    category: 'player',
    source: sourceKind(l.source),
    sourceId: l.source || null,
    kind: 'player:login',
    label: 'login',
    who: name,
    body: `${name} logged in`,
    meta: null,
    badges: badges(badge('player', name, 'player')),
    raw: l.raw || null
  };
}

function itemFromRecent (ev) {
  const recognized = !!ev.recognized;
  const category = recognized ? categoryForKind(ev.kind) : 'log';
  const raw = String(ev.raw || '');
  const body = summarizeRecent(ev);
  const q = firstQuoted(raw);
  const nick = raw.match(/nickname="([^"]+)"/);
  return {
    id: 'log:' + (ev.seq != null ? ev.seq : '') + ':' + String(ev.timestamp || '') + ':' + String(ev.kind || ''),
    ts: ev.timestamp || null,
    category,
    source: 'local',
    sourceId: null,
    kind: ev.kind || 'log:raw',
    label: recognized
      ? humanizeKind(ev.kind).split(' · ')[0].slice(0, 18)
      : (ev.kind === 'log:notice' ? 'notice' : 'log'),
    who: null,
    body,
    meta: ev.tag ? String(ev.tag).replace(/^<|>$/g, '') : null,
    badges: badges(
      (String(ev.kind || '').indexOf('quantum:') === 0)
        ? badge('destination', q, 'destination')
        : null,
      badge('player', nick && nick[1], 'player'),
      (recognized && category === 'mission')
        ? badge('type', missionType(q || stripLogPrefix(raw)), 'type')
        : null
    ),
    raw: raw || null,
    verified: ev.verified,
    recognized
  };
}

/**
 * Kinds already represented by structured collection items — skip duplicates
 * from the recent log buffer when building the stream.
 */
const STRUCTURED_KINDS = new Set([
  'kill', 'player:death', 'player:incap', 'vehicle:destroy',
  'mission:contract', 'mission:objective', 'mission:notification',
  'mission:marker', 'mission:start', 'mission:end',
  'hud:notification', 'player:login'
]);

/**
 * @param {object} inputs
 * @param {{
 *   limit?: number,
 *   aliases?: Record<string, string>,
 *   profiles?: Record<string, object>,
 *   selfPubkey?: string|null
 * }} [opts]
 * @returns {{ items: object[], categories: string[][], sources: string[][] }}
 */
function buildLiveFeed (inputs = {}, opts = {}) {
  const limit = Math.min(Math.max(parseInt(opts.limit, 10) || 400, 1), 2000);
  const ctx = {
    aliases: opts.aliases || {},
    profiles: opts.profiles || {},
    selfPubkey: opts.selfPubkey || null
  };
  const out = [];
  const seen = new Set();

  for (const m of inputs.chat || []) pushItem(out, seen, itemFromChat(m), ctx);
  for (const b of inputs.broadcasts || []) pushItem(out, seen, itemFromBroadcast(b), ctx);
  for (const k of inputs.kills || []) pushItem(out, seen, itemFromKill(k), ctx);
  for (const d of inputs.deaths || []) pushItem(out, seen, itemFromDeath(d), ctx);
  for (const d of inputs.incaps || []) pushItem(out, seen, itemFromIncap(d), ctx);
  for (const v of inputs.vehicles || []) pushItem(out, seen, itemFromVehicle(v), ctx);
  for (const m of inputs.missionlog || []) pushItem(out, seen, itemFromMission(m), ctx);
  for (const n of inputs.notifications || []) pushItem(out, seen, itemFromNotification(n), ctx);
  for (const l of inputs.logins || []) pushItem(out, seen, itemFromLogin(l), ctx);

  for (const ev of inputs.recent || []) {
    if (!ev) continue;
    // Prefer structured items when the kind is already covered.
    if (ev.recognized && STRUCTURED_KINDS.has(ev.kind)) continue;
    pushItem(out, seen, itemFromRecent(ev), ctx);
  }

  out.sort((a, b) => {
    const at = a.ts || '';
    const bt = b.ts || '';
    if (at < bt) return -1;
    if (at > bt) return 1;
    return String(a.id).localeCompare(String(b.id));
  });

  return {
    items: out.slice(-limit),
    categories: FEED_CATEGORIES.map((pair) => pair.slice()),
    sources: FEED_SOURCES.map((pair) => pair.slice())
  };
}

/**
 * Client-side filter: null/empty set = include all.
 * @param {object[]} items
 * @param {{ categories?: Set<string>|null, sources?: Set<string>|null, keywords?: string[] }} filters
 */
function filterLiveFeed (items, filters = {}) {
  const cats = filters.categories;
  const sources = filters.sources;
  const kws = Array.isArray(filters.keywords) ? filters.keywords : [];
  return (items || []).filter((it) => {
    if (cats && cats.size && !cats.has(it.category)) return false;
    if (sources && sources.size && !sources.has(it.source)) return false;
    if (!kws.length) return true;
    const badgeText = (it.badges || []).map((b) => `${b.label || ''} ${b.value || ''}`).join(' ');
    const prov = it.provenance || {};
    const hay = [
      it.body, it.raw, it.who, it.kind, it.label, badgeText,
      prov.label, prov.detail, prov.peerAlias, prov.peerId
    ].join(' ').toLowerCase();
    return kws.some((k) => hay.includes(k));
  });
}

module.exports = {
  FEED_CATEGORIES,
  FEED_SOURCES,
  BADGE_KINDS,
  categoryForKind,
  sourceKind,
  hasDistinctRaw,
  badge,
  badges,
  buildProvenance,
  summarizeRecent,
  missionFriendlyBody,
  killFriendlyBody,
  buildLiveFeed,
  filterLiveFeed
};
