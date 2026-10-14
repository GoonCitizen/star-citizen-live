'use strict';

/**
 * Discord Guild Scheduled Events — fetch, serialize, categorize, and fold into
 * the `discordcatalog` Fabric Store collection (same bag as guild/channel packs).
 *
 * Agents / ops:
 *   node scripts/discord-events.js fetch --guild 1190527980120850493
 *   node scripts/discord-events.js categorize --ids <id>,…
 *
 * Secrets stay in env / `discord.secrets.json` under the settings dir (never
 * committed). Public invite scraping is a fallback only when no bot token.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

const { resolveDiscordConfig } = require('./discordConfig');

const COLLECTION = 'discordcatalog';
const EVENTS_KIND = 'guild-events';
const DISCORD_API = 'https://discord.com/api/v10';
const DEFAULT_GUILD_ID = '1190527980120850493'; // G00N SQUAD / Permafleet

/** Discord GuildScheduledEventEntityType */
const ENTITY_TYPE = Object.freeze({
  1: 'stage',
  2: 'voice',
  3: 'external'
});

/** Discord GuildScheduledEventStatus */
const STATUS = Object.freeze({
  1: 'scheduled',
  2: 'active',
  3: 'completed',
  4: 'canceled'
});

/** Discord RecurrenceRule frequency (0=yearly … 3=daily); weekly=2 is common. */
const FREQ = Object.freeze({
  0: 'yearly',
  1: 'monthly',
  2: 'weekly',
  3: 'daily'
});

/** Monday=0 … Sunday=6 (Discord RecurrenceRuleWeekday). */
const WEEKDAY = Object.freeze([
  'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'
]);

const THEME_NAME_RE = /^(MINING MONDAY|TRAUMA TUESDAY|HUMPDAY HAULING|FIGHTER FRIDAY|SATURDAY SHENANIGANS|SUNDAY FUNDAY)\b/i;
const TRAINING_NAME_RE = /^(TRAINING |FLIGHT SCHOOL |FRIDAY NIGHT FIGHTS\b)/i;
const SPECIAL_NAME_RE = /(TOURNAMENT|CAPITAL COMBAT|TOUR THROUGH)/i;

/**
 * @param {string} guildId
 * @returns {string|null}
 */
function guildEventsRecordId (guildId) {
  const id = String(guildId || '').trim();
  return id ? ('guild-events:' + id) : null;
}

function isoNow (value) {
  if (value) {
    const d = new Date(value);
    if (!Number.isNaN(d.getTime())) return d.toISOString();
  }
  return new Date().toISOString();
}

/**
 * Candidate settings roots: env, Electron userData, then repo `stores/gooncitizen`.
 * @param {object} [opts]
 * @param {string} [opts.cwd]
 * @param {NodeJS.ProcessEnv} [opts.env]
 * @returns {string[]}
 */
function candidateSettingsDirs (opts = {}) {
  const env = opts.env || process.env;
  const cwd = opts.cwd || process.cwd();
  const out = [];
  const push = (p) => {
    const n = path.resolve(String(p || '').trim());
    if (n && !out.includes(n) && fs.existsSync(n)) out.push(n);
  };
  if (env.SC_SETTINGS_DIR) push(env.SC_SETTINGS_DIR);
  const home = os.homedir();
  // Historical Electron userData for this package name; current productName may differ.
  push(path.join(home, 'Library/Application Support/@rsi/star-citizen/stores/gooncitizen'));
  push(path.join(home, 'Library/Application Support/GoonCitizen/stores/gooncitizen'));
  push(path.join(cwd, 'stores/gooncitizen'));
  return out;
}

/**
 * First settings dir that has discord.secrets.json or is explicitly requested.
 * @param {object} [opts]
 * @returns {string|null}
 */
function resolveSettingsDir (opts = {}) {
  const env = opts.env || process.env;
  if (opts.settingsDir) return path.resolve(opts.settingsDir);
  if (env.SC_SETTINGS_DIR) return path.resolve(env.SC_SETTINGS_DIR);
  for (const dir of candidateSettingsDirs(opts)) {
    if (fs.existsSync(path.join(dir, 'discord.secrets.json'))) return dir;
  }
  const list = candidateSettingsDirs(opts);
  return list[0] || null;
}

/**
 * Register LevelDB path beside a settings dir (or SC_REGISTER_DIR / repo default).
 * @param {object} [opts]
 * @returns {string}
 */
function resolveRegisterPath (opts = {}) {
  const env = opts.env || process.env;
  if (opts.registerPath) return path.resolve(opts.registerPath);
  if (env.SC_REGISTER_DIR) return path.resolve(env.SC_REGISTER_DIR);
  const settingsDir = resolveSettingsDir(opts);
  if (settingsDir) {
    const reg = path.join(settingsDir, 'register');
    if (fs.existsSync(reg) || settingsDir.endsWith('gooncitizen')) return reg;
  }
  return path.resolve((opts.cwd || process.cwd()), 'stores/gooncitizen/register');
}

/**
 * @param {object} event Discord API or stored row
 * @returns {object|null}
 */
function serializeScheduledEvent (event) {
  if (!event || typeof event !== 'object') return null;
  const id = String(event.id || '').trim();
  if (!id) return null;
  const entityType = Number(event.entity_type != null ? event.entity_type : event.entityType);
  const status = Number(event.status);
  const recurrence = event.recurrence_rule || event.recurrenceRule || null;
  const meta = event.entity_metadata || event.entityMetadata || null;
  const row = {
    id,
    guildId: event.guild_id != null
      ? String(event.guild_id)
      : (event.guildId != null ? String(event.guildId) : null),
    name: String(event.name || '').trim() || id,
    description: event.description != null ? String(event.description) : null,
    scheduledStartTime: event.scheduled_start_time || event.scheduledStartTime || null,
    scheduledEndTime: event.scheduled_end_time || event.scheduledEndTime || null,
    entityType: Number.isFinite(entityType) ? entityType : null,
    entityTypeName: ENTITY_TYPE[entityType] || null,
    status: Number.isFinite(status) ? status : null,
    statusName: STATUS[status] || null,
    channelId: event.channel_id != null
      ? String(event.channel_id)
      : (event.channelId != null ? String(event.channelId) : null),
    creatorId: event.creator_id != null
      ? String(event.creator_id)
      : (event.creatorId != null ? String(event.creatorId) : null),
    userCount: Number.isFinite(Number(event.user_count != null ? event.user_count : event.userCount))
      ? Number(event.user_count != null ? event.user_count : event.userCount)
      : null,
    image: event.image != null ? String(event.image) : null,
    entityMetadata: meta && typeof meta === 'object'
      ? { location: meta.location != null ? String(meta.location) : null }
      : null,
    recurrenceRule: serializeRecurrence(recurrence),
    updatedAt: isoNow(event.updatedAt)
  };
  return row;
}

/**
 * @param {object|null} rule
 * @returns {object|null}
 */
function serializeRecurrence (rule) {
  if (!rule || typeof rule !== 'object') return null;
  const frequency = Number(rule.frequency);
  const byWeekday = Array.isArray(rule.by_weekday)
    ? rule.by_weekday.map((d) => Number(d)).filter((n) => Number.isFinite(n))
    : (Array.isArray(rule.byWeekday) ? rule.byWeekday.map((d) => Number(d)).filter((n) => Number.isFinite(n)) : null);
  const byNWeekday = rule.by_n_weekday || rule.byNWeekday || null;
  return {
    start: rule.start || null,
    end: rule.end || null,
    frequency: Number.isFinite(frequency) ? frequency : null,
    frequencyName: FREQ[frequency] || null,
    interval: Number.isFinite(Number(rule.interval)) ? Number(rule.interval) : 1,
    byWeekday,
    byWeekdayNames: byWeekday ? byWeekday.map((d) => WEEKDAY[d] || String(d)) : null,
    byNWeekday: Array.isArray(byNWeekday)
      ? byNWeekday.map((x) => ({
        n: Number(x && x.n),
        day: Number(x && x.day),
        dayName: WEEKDAY[Number(x && x.day)] || null
      }))
      : null,
    count: rule.count != null ? Number(rule.count) : null
  };
}

/**
 * Infer calendar day for theming from recurrence or scheduled start (UTC weekday).
 * Evening blocks that land at 00:00 UTC map to the previous local theme day when
 * the name encodes a weekday (Training Wednesday / Thursday).
 * @param {object} event serializeScheduledEvent row
 * @returns {string|null} Monday…Sunday
 */
function inferWeekday (event) {
  if (!event) return null;
  const name = String(event.name || '');
  const nameDay = name.match(/\b(MONDAY|TUESDAY|WEDNESDAY|THURSDAY|FRIDAY|SATURDAY|SUNDAY|HUMPDAY)\b/i);
  if (nameDay) {
    const w = nameDay[1].toUpperCase();
    if (w === 'HUMPDAY') return 'Wednesday';
    return w.charAt(0) + w.slice(1).toLowerCase();
  }
  // Prefer local (Central) calendar day of the next occurrence so late-evening
  // CT ops that land after midnight UTC stay on the intended play day.
  if (event.scheduledStartTime) {
    const dt = new Date(event.scheduledStartTime);
    if (!Number.isNaN(dt.getTime())) {
      try {
        const parts = new Intl.DateTimeFormat('en-US', {
          timeZone: 'America/Chicago',
          weekday: 'long'
        }).formatToParts(dt);
        const w = parts.find((p) => p.type === 'weekday');
        if (w && w.value && WEEKDAY.includes(w.value)) return w.value;
      } catch (_) { /* fall through */ }
    }
  }
  const rule = event.recurrenceRule;
  if (rule && Array.isArray(rule.byWeekday) && rule.byWeekday.length === 1) {
    const d = rule.byWeekday[0];
    if (WEEKDAY[d]) return WEEKDAY[d];
  }
  if (rule && Array.isArray(rule.byNWeekday) && rule.byNWeekday[0] &&
      WEEKDAY[rule.byNWeekday[0].day]) {
    return WEEKDAY[rule.byNWeekday[0].day];
  }
  if (event.scheduledStartTime) {
    const dt = new Date(event.scheduledStartTime);
    if (!Number.isNaN(dt.getTime())) {
      const js = dt.getUTCDay();
      const discord = js === 0 ? 6 : js - 1;
      return WEEKDAY[discord] || null;
    }
  }
  return null;
}

/**
 * Categorize one event: day theme vs timed training vs special/tournament.
 * @param {object} event serializeScheduledEvent row
 * @returns {object}
 */
function categorizeEvent (event) {
  const row = serializeScheduledEvent(event) || event;
  const name = String((row && row.name) || '');
  const rule = row && row.recurrenceRule;
  const interval = rule && Number(rule.interval) || 1;
  const freq = rule && rule.frequencyName;
  let kind = 'timed';
  let reason = 'default timed block';

  if (THEME_NAME_RE.test(name)) {
    kind = 'theme';
    reason = 'named day-theme event';
  } else if (TRAINING_NAME_RE.test(name)) {
    kind = 'timed';
    reason = 'training / flight school block';
  } else if (SPECIAL_NAME_RE.test(name) || (freq === 'monthly') || (freq === 'weekly' && interval > 1)) {
    kind = 'special';
    reason = SPECIAL_NAME_RE.test(name)
      ? 'tournament / capital / tour'
      : (freq === 'monthly' ? 'monthly recurrence' : 'multi-week recurrence');
  } else {
    // Ad-hoc ops (e.g. HATHOR DOMINANCE) — not a recurring day banner.
    kind = 'special';
    reason = 'ops / ad-hoc event';
  }

  const weekday = inferWeekday(row);
  return {
    id: row && row.id,
    name: row && row.name,
    kind,
    reason,
    weekday,
    scheduledStartTime: row && row.scheduledStartTime,
    scheduledEndTime: row && row.scheduledEndTime,
    cadence: describeCadence(rule),
    channelId: row && row.channelId,
    entityTypeName: row && row.entityTypeName,
    statusName: row && row.statusName,
    userCount: row && row.userCount,
    description: row && row.description
  };
}

/**
 * @param {object|null} rule
 * @returns {string}
 */
function describeCadence (rule) {
  if (!rule || !rule.frequencyName) return 'one-off or unknown';
  const interval = Number(rule.interval) || 1;
  if (rule.frequencyName === 'weekly' && interval === 1) {
    const days = (rule.byWeekdayNames || []).join('/');
    return days ? ('weekly ' + days) : 'weekly';
  }
  if (rule.frequencyName === 'weekly' && interval > 1) {
    return 'every ' + interval + ' weeks';
  }
  if (rule.frequencyName === 'monthly') {
    if (Array.isArray(rule.byNWeekday) && rule.byNWeekday[0]) {
      const x = rule.byNWeekday[0];
      return (ordinal(x.n) + ' ' + (x.dayName || 'day') + ' monthly');
    }
    return 'monthly';
  }
  return rule.frequencyName + (interval > 1 ? (' ×' + interval) : '');
}

function ordinal (n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return String(n);
  const s = ['th', 'st', 'nd', 'rd'];
  const v100 = v % 100;
  return v + (s[(v100 - 20) % 10] || s[v100] || s[0]);
}

/**
 * Build a week schedule: one theme per day + timed/special overlays.
 * @param {Array<object>} events
 * @returns {object}
 */
function buildWeekSchedule (events) {
  const categorized = (events || []).map((e) => categorizeEvent(e));
  const days = {};
  for (const name of WEEKDAY) {
    days[name] = { theme: null, timed: [], special: [], other: [] };
  }
  const unassigned = [];
  for (const row of categorized) {
    const day = row.weekday;
    if (!day || !days[day]) {
      unassigned.push(row);
      continue;
    }
    if (row.kind === 'theme') {
      if (!days[day].theme) days[day].theme = row;
      else days[day].timed.push(row);
    } else if (row.kind === 'special') {
      days[day].special.push(row);
    } else if (row.kind === 'timed') {
      days[day].timed.push(row);
    } else {
      days[day].other.push(row);
    }
  }
  const sortKey = (a, b) => String(a.scheduledStartTime || '').localeCompare(String(b.scheduledStartTime || ''));
  for (const name of WEEKDAY) {
    days[name].timed.sort(sortKey);
    days[name].special.sort(sortKey);
    days[name].other.sort(sortKey);
  }
  return {
    generatedAt: isoNow(),
    days,
    unassigned,
    counts: {
      theme: categorized.filter((c) => c.kind === 'theme').length,
      timed: categorized.filter((c) => c.kind === 'timed').length,
      special: categorized.filter((c) => c.kind === 'special').length,
      total: categorized.length
    }
  };
}

/**
 * Discord REST GET with Bot token.
 * @param {string} apiPath
 * @param {string} token
 * @param {object} [opts]
 * @returns {Promise<{status:number, json:*, error?:string}>}
 */
async function discordGet (apiPath, token, opts = {}) {
  const base = opts.apiBase || DISCORD_API;
  const fetchImpl = opts.fetch || globalThis.fetch;
  if (typeof fetchImpl !== 'function') {
    return { status: 0, json: null, error: 'fetch unavailable' };
  }
  const maxAttempts = Number.isFinite(Number(opts.retries)) ? Number(opts.retries) : 3;
  let attempt = 0;
  while (attempt < maxAttempts) {
    attempt += 1;
    const r = await fetchImpl(base + apiPath, {
      headers: {
        Authorization: 'Bot ' + token,
        'User-Agent': 'GoonCitizenDiscordEvents/0.1',
        Accept: 'application/json'
      }
    });
    let json = null;
    const text = await r.text();
    try { json = text ? JSON.parse(text) : null; } catch (_) { json = { raw: text.slice(0, 200) }; }
    if (r.status === 429 && attempt < maxAttempts) {
      const retry = Number((json && json.retry_after) || r.headers.get('retry-after') || 1);
      const ms = Math.min(15000, Math.max(500, Math.ceil(retry * 1000)));
      await new Promise((resolve) => setTimeout(resolve, ms));
      continue;
    }
    return { status: r.status, json };
  }
  return { status: 429, json: null, error: 'rate limited' };
}

/**
 * List scheduled events for a guild (bot must be a member).
 * @param {object} opts
 * @param {string} opts.token
 * @param {string} opts.guildId
 * @param {boolean} [opts.withUserCount]
 * @returns {Promise<{ok:boolean, events:object[], status:number, error?:string}>}
 */
async function fetchGuildScheduledEvents (opts = {}) {
  const token = String(opts.token || '').trim();
  const guildId = String(opts.guildId || DEFAULT_GUILD_ID).trim();
  if (!token) return { ok: false, events: [], status: 0, error: 'missing bot token' };
  if (!guildId) return { ok: false, events: [], status: 0, error: 'missing guildId' };
  const q = opts.withUserCount === false ? '' : '?with_user_count=true';
  const res = await discordGet(`/guilds/${guildId}/scheduled-events${q}`, token, opts);
  if (res.status !== 200 || !Array.isArray(res.json)) {
    return {
      ok: false,
      events: [],
      status: res.status,
      error: (res.json && res.json.message) || ('HTTP ' + res.status)
    };
  }
  const events = res.json.map(serializeScheduledEvent).filter(Boolean);
  return { ok: true, events, status: res.status };
}

/**
 * Fetch one scheduled event by id.
 * @param {object} opts
 * @returns {Promise<{ok:boolean, event:object|null, status:number, error?:string}>}
 */
async function fetchGuildScheduledEvent (opts = {}) {
  const token = String(opts.token || '').trim();
  const guildId = String(opts.guildId || DEFAULT_GUILD_ID).trim();
  const eventId = String(opts.eventId || '').trim();
  if (!token) return { ok: false, event: null, status: 0, error: 'missing bot token' };
  if (!guildId || !eventId) {
    return { ok: false, event: null, status: 0, error: 'guildId and eventId required' };
  }
  const q = opts.withUserCount === false ? '' : '?with_user_count=true';
  const res = await discordGet(
    `/guilds/${guildId}/scheduled-events/${eventId}${q}`,
    token,
    opts
  );
  if (res.status !== 200 || !res.json || res.json.id == null) {
    return {
      ok: false,
      event: null,
      status: res.status,
      error: (res.json && res.json.message) || ('HTTP ' + res.status)
    };
  }
  return { ok: true, event: serializeScheduledEvent(res.json), status: res.status };
}

/**
 * Resolve many event IDs: store first, then live API for misses.
 * @param {object} opts
 * @param {object} [opts.store]
 * @param {string[]} opts.eventIds
 * @param {string} [opts.guildId]
 * @param {string} [opts.token]
 * @returns {Promise<object>}
 */
async function resolveEventIds (opts = {}) {
  const guildId = String(opts.guildId || DEFAULT_GUILD_ID).trim();
  const ids = (opts.eventIds || []).map((id) => String(id).trim()).filter(Boolean);
  const byId = new Map();
  for (const e of loadScheduledEvents(opts.store, guildId)) {
    if (e && e.id) byId.set(String(e.id), e);
  }
  const missing = ids.filter((id) => !byId.has(id));
  const fetched = [];
  const errors = [];
  if (missing.length && opts.token) {
    for (const eventId of missing) {
      const res = await fetchGuildScheduledEvent({
        token: opts.token,
        guildId,
        eventId,
        fetch: opts.fetch,
        apiBase: opts.apiBase
      });
      if (res.ok && res.event) {
        byId.set(eventId, res.event);
        fetched.push(res.event);
      } else {
        errors.push({ id: eventId, status: res.status, error: res.error });
      }
    }
  }
  return {
    guildId,
    events: ids.map((id) => byId.get(id)).filter(Boolean),
    missing: ids.filter((id) => !byId.has(id)),
    fetched,
    errors
  };
}

/**
 * Merge event list into discordcatalog `guild-events:<guildId>`.
 * @param {object} store
 * @param {string} guildId
 * @param {Array<object>} events
 * @param {object} [meta]
 * @returns {object|null}
 */
function foldScheduledEvents (store, guildId, events, meta = {}) {
  if (!store) return null;
  const key = guildEventsRecordId(guildId);
  if (!key) return null;
  const prev = store.get(COLLECTION, key);
  const byId = new Map();
  for (const row of (prev && prev.events) || []) {
    const clean = serializeScheduledEvent(row);
    if (clean) byId.set(clean.id, clean);
  }
  for (const row of events || []) {
    const clean = serializeScheduledEvent(row);
    if (!clean) continue;
    const prior = byId.get(clean.id);
    byId.set(clean.id, prior ? Object.assign({}, prior, clean) : clean);
  }
  const observedAt = isoNow(meta.observedAt);
  const list = Array.from(byId.values()).sort((a, b) =>
    String(a.scheduledStartTime || '').localeCompare(String(b.scheduledStartTime || ''))
  );
  const record = {
    kind: EVENTS_KIND,
    id: String(guildId),
    guildId: String(guildId),
    events: list,
    count: list.length,
    source: meta.via || (prev && prev.source) || 'bot',
    updatedAt: observedAt,
    observedAt
  };
  store.put(COLLECTION, key, record);
  return record;
}

/**
 * @param {object|null} store
 * @param {string} [guildId]
 * @returns {object[]}
 */
function loadScheduledEvents (store, guildId) {
  if (!store) return [];
  const gid = guildId != null ? String(guildId).trim() : '';
  if (gid) {
    const row = store.get(COLLECTION, guildEventsRecordId(gid));
    return Array.isArray(row && row.events) ? row.events.slice() : [];
  }
  const out = [];
  for (const row of store.all(COLLECTION) || []) {
    if (!row || row.kind !== EVENTS_KIND) continue;
    for (const e of row.events || []) out.push(e);
  }
  return out;
}

/**
 * @param {object|null} store
 * @param {string} eventId
 * @param {string} [guildId]
 * @returns {object|null}
 */
function getScheduledEvent (store, eventId, guildId) {
  const id = String(eventId || '').trim();
  if (!id) return null;
  for (const e of loadScheduledEvents(store, guildId)) {
    if (e && String(e.id) === id) return e;
  }
  return null;
}

/**
 * Resolve Discord bot token + preferred guild without printing secrets.
 * @param {object} [opts]
 * @returns {{token:string|null, settingsDir:string|null, guildId:string, config:object}}
 */
function resolveDiscordEventAuth (opts = {}) {
  const env = opts.env || process.env;
  let localDiscord = opts.localDiscord || {};
  if (!opts.localDiscord) {
    try {
      const localPath = path.resolve(opts.cwd || process.cwd(), 'settings/local.js');
      if (fs.existsSync(localPath)) {
        // eslint-disable-next-line import/no-dynamic-require, global-require
        const local = require(localPath);
        localDiscord = (local && local.discord) || {};
      }
    } catch (_) { /* ignore */ }
  }
  const settingsDir = resolveSettingsDir(opts);
  const config = resolveDiscordConfig({
    localDiscord,
    settingsDir,
    env,
    persisted: opts.persisted || {}
  });
  const guildId = String(
    opts.guildId ||
    env.DISCORD_GUILD_ID ||
    localDiscord.guildId ||
    localDiscord.guild ||
    DEFAULT_GUILD_ID
  ).trim();
  return {
    token: config.token || null,
    settingsDir,
    guildId,
    config
  };
}

/**
 * Format times for CT (America/Chicago) + UTC labels.
 * @param {string} iso
 * @returns {{utc:string, ct:string}|null}
 */
function formatEventTimes (iso) {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const utc = d.toISOString().replace(/\.\d{3}Z$/, 'Z');
  let ct = utc;
  try {
    ct = new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/Chicago',
      weekday: 'short',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
      timeZoneName: 'short'
    }).format(d);
  } catch (_) { /* ignore */ }
  return { utc, ct };
}

module.exports = {
  COLLECTION,
  EVENTS_KIND,
  DEFAULT_GUILD_ID,
  ENTITY_TYPE,
  STATUS,
  WEEKDAY,
  guildEventsRecordId,
  candidateSettingsDirs,
  resolveSettingsDir,
  resolveRegisterPath,
  serializeScheduledEvent,
  serializeRecurrence,
  inferWeekday,
  categorizeEvent,
  buildWeekSchedule,
  describeCadence,
  discordGet,
  fetchGuildScheduledEvents,
  fetchGuildScheduledEvent,
  resolveEventIds,
  foldScheduledEvents,
  loadScheduledEvents,
  getScheduledEvent,
  resolveDiscordEventAuth,
  formatEventTimes
};
