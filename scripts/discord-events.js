'use strict';

/**
 * Discord scheduled events — fetch / list / categorize for GoonCitizen agents.
 *
 * Uses the local bot token from `stores/.../discord.secrets.json` (Electron
 * userData preferred) or `DISCORD_BOT_TOKEN`, and persists into the Fabric
 * Store `discordcatalog` collection as `guild-events:<guildId>`.
 *
 * Usage:
 *   node scripts/discord-events.js fetch [--guild ID] [--register PATH]
 *   node scripts/discord-events.js list [--guild ID]
 *   node scripts/discord-events.js get <eventId>
 *   node scripts/discord-events.js categorize [--ids id,id] [--json]
 *   node scripts/discord-events.js resolve <id> [<id>…]
 *   node scripts/discord-events.js graphic [--fetch] [--from-json FILE] [--out-dir DIR]
 *
 * Env:
 *   DISCORD_BOT_TOKEN, DISCORD_GUILD_ID, SC_SETTINGS_DIR, SC_REGISTER_DIR
 */

const fs = require('fs');
const path = require('path');

const { spawnSync } = require('child_process');
const { Store } = require('../types/Store');
const events = require('../functions/discordScheduledEvents');
const { writeAgentProbe } = require('../functions/agentProbeExport');
const graphic = require('../functions/goonSquadScheduleGraphic');

function dumpProbe (name, payload) {
  try {
    const written = writeAgentProbe(name, payload, {
      cwd: path.join(__dirname, '..')
    });
    console.error(`[discord-events] probe → ${written.localPath}` +
      (written.publishPath ? ` (published ${written.publishPath})` : ''));
  } catch (e) {
    console.error('[discord-events] probe export failed:', e && e.message ? e.message : e);
  }
}

function usage (code = 0) {
  const text = `Usage:
  node scripts/discord-events.js fetch [--guild ID] [--no-store] [--out FILE]
  node scripts/discord-events.js list [--guild ID] [--json]
  node scripts/discord-events.js get <eventId> [--guild ID]
  node scripts/discord-events.js categorize [--ids id,id] [--json]
  node scripts/discord-events.js resolve <id> [<id>…] [--guild ID] [--json]
  node scripts/discord-events.js graphic [--fetch] [--from-json FILE] [--out-dir DIR] [--assets] [--png]

Persists under discordcatalog key guild-events:<guildId>.
Graphic writes goon-squad-schedule.svg + .html (optional PNG via Chrome).
Secrets: DISCORD_BOT_TOKEN or settingsDir/discord.secrets.json
`;
  if (code) console.error(text);
  else console.log(text);
  process.exit(code);
}

function parseArgs (argv) {
  const args = {
    cmd: null,
    guild: null,
    register: null,
    settingsDir: null,
    ids: [],
    out: null,
    json: false,
    store: true,
    fetch: false,
    png: false,
    assets: false,
    fromJson: null,
    outDir: null,
    rest: []
  };
  const list = argv.slice(2);
  if (!list.length || list[0] === '-h' || list[0] === '--help') usage(0);
  args.cmd = list.shift();
  while (list.length) {
    const a = list.shift();
    if (a === '--guild') args.guild = list.shift();
    else if (a === '--register') args.register = list.shift();
    else if (a === '--settings-dir') args.settingsDir = list.shift();
    else if (a === '--ids') {
      const raw = list.shift() || '';
      args.ids = raw.split(/[,\s]+/).map((s) => s.trim()).filter(Boolean);
    } else if (a === '--out') args.out = list.shift();
    else if (a === '--out-dir') args.outDir = list.shift();
    else if (a === '--from-json') args.fromJson = list.shift();
    else if (a === '--json') args.json = true;
    else if (a === '--fetch') args.fetch = true;
    else if (a === '--png') args.png = true;
    else if (a === '--assets') args.assets = true;
    else if (a === '--no-store') args.store = false;
    else if (a.startsWith('-')) {
      console.error('Unknown flag', a);
      usage(2);
    } else {
      args.rest.push(a);
    }
  }
  return args;
}

async function openStore (args) {
  const registerPath = events.resolveRegisterPath({
    registerPath: args.register,
    settingsDir: args.settingsDir,
    cwd: path.join(__dirname, '..')
  });
  // Prefer writable register: if Electron LevelDB is locked, fall back to repo.
  const candidates = [registerPath];
  const repoReg = path.join(__dirname, '..', 'stores/gooncitizen/register');
  if (path.resolve(registerPath) !== path.resolve(repoReg)) candidates.push(repoReg);

  let lastErr = null;
  for (const p of candidates) {
    try {
      fs.mkdirSync(p, { recursive: true });
      const store = new Store({ path: p });
      await store.start();
      return { store, registerPath: p };
    } catch (e) {
      lastErr = e;
      const msg = e && e.message ? e.message : String(e);
      if (/lock|Resource temporarily unavailable|LEVEL_LOCKED/i.test(msg)) {
        console.error(`[discord-events] register locked, trying next: ${p}`);
        continue;
      }
      throw e;
    }
  }
  throw lastErr || new Error('could not open register store');
}

function printEvent (e) {
  const times = events.formatEventTimes(e.scheduledStartTime);
  const cat = events.categorizeEvent(e);
  console.log(`${e.name}`);
  console.log(`  id        ${e.id}`);
  console.log(`  kind      ${cat.kind} (${cat.reason})`);
  console.log(`  weekday   ${cat.weekday || '—'}`);
  console.log(`  cadence   ${cat.cadence}`);
  console.log(`  start     ${times ? times.ct + ' / ' + times.utc : e.scheduledStartTime}`);
  console.log(`  status    ${e.statusName || e.status}`);
  console.log(`  channel   ${e.channelId || '—'} (${e.entityTypeName || '—'})`);
  if (e.description) {
    const d = String(e.description).replace(/\s+/g, ' ').slice(0, 160);
    console.log(`  desc      ${d}`);
  }
  console.log('');
}

async function cmdFetch (args) {
  const auth = events.resolveDiscordEventAuth({
    guildId: args.guild,
    settingsDir: args.settingsDir,
    cwd: path.join(__dirname, '..')
  });
  if (!auth.token) {
    console.error('No Discord bot token. Set DISCORD_BOT_TOKEN or add discord.secrets.json under the settings dir.');
    console.error('Tried settings dirs:', events.candidateSettingsDirs({ cwd: path.join(__dirname, '..') }).join(', '));
    process.exit(2);
  }
  console.error(`[discord-events] settingsDir=${auth.settingsDir || '(none)'} guild=${auth.guildId} token=yes`);
  const res = await events.fetchGuildScheduledEvents({
    token: auth.token,
    guildId: auth.guildId
  });
  if (!res.ok) {
    console.error('Fetch failed:', res.status, res.error);
    process.exit(1);
  }
  let record = null;
  let registerPath = null;
  if (args.store) {
    const opened = await openStore(args);
    registerPath = opened.registerPath;
    record = events.foldScheduledEvents(opened.store, auth.guildId, res.events, { via: 'bot' });
    await opened.store.stop();
    console.error(`[discord-events] stored ${record.count} events → ${registerPath} (${events.COLLECTION}/${events.guildEventsRecordId(auth.guildId)})`);
  }
  const schedule = events.buildWeekSchedule(res.events);
  const payload = {
    guildId: auth.guildId,
    fetchedAt: new Date().toISOString(),
    registerPath,
    count: res.events.length,
    events: res.events,
    schedule
  };
  if (args.out) {
    fs.mkdirSync(path.dirname(path.resolve(args.out)), { recursive: true });
    fs.writeFileSync(args.out, JSON.stringify(payload, null, 2) + '\n');
    console.error(`[discord-events] wrote ${args.out}`);
  }
  dumpProbe('discord-scheduled-events', {
    title: 'G00N SQUAD Discord scheduled events',
    guildId: auth.guildId,
    fetchedAt: payload.fetchedAt,
    registerPath: payload.registerPath,
    count: payload.count,
    schedule: payload.schedule,
    events: payload.events
  });
  if (args.json) {
    console.log(JSON.stringify(payload, null, 2));
  } else {
    console.log(`Fetched ${res.events.length} scheduled events for guild ${auth.guildId}\n`);
    for (const e of res.events) printEvent(e);
    console.log('Week themes:');
    for (const day of events.WEEKDAY) {
      const d = schedule.days[day];
      const theme = d.theme ? d.theme.name : '(none)';
      const extras = [...d.timed, ...d.special].map((x) => x.name).join(', ');
      console.log(`  ${day}: ${theme}${extras ? ' + ' + extras : ''}`);
    }
  }
}

async function cmdList (args) {
  const opened = await openStore(args);
  const guildId = args.guild || events.DEFAULT_GUILD_ID;
  const list = events.loadScheduledEvents(opened.store, guildId);
  await opened.store.stop();
  if (args.json) {
    console.log(JSON.stringify({ guildId, count: list.length, events: list }, null, 2));
    return;
  }
  console.log(`${list.length} stored events (guild ${guildId}) from ${opened.registerPath}\n`);
  for (const e of list) printEvent(e);
}

async function cmdGet (args) {
  const eventId = args.rest[0];
  if (!eventId) usage(2);
  const opened = await openStore(args);
  let row = events.getScheduledEvent(opened.store, eventId, args.guild);
  if (!row) {
    const auth = events.resolveDiscordEventAuth({
      guildId: args.guild,
      settingsDir: args.settingsDir,
      cwd: path.join(__dirname, '..')
    });
    if (auth.token) {
      const res = await events.fetchGuildScheduledEvent({
        token: auth.token,
        guildId: auth.guildId,
        eventId
      });
      if (res.ok) {
        row = res.event;
        events.foldScheduledEvents(opened.store, auth.guildId, [row], { via: 'bot' });
      }
    }
  }
  await opened.store.stop();
  if (!row) {
    console.error('Event not found in store or API:', eventId);
    process.exit(1);
  }
  if (args.json) console.log(JSON.stringify(row, null, 2));
  else printEvent(row);
}

async function cmdCategorize (args) {
  const opened = await openStore(args);
  const guildId = args.guild || events.DEFAULT_GUILD_ID;
  let list = events.loadScheduledEvents(opened.store, guildId);
  if (args.ids.length) {
    const want = new Set(args.ids);
    list = list.filter((e) => want.has(String(e.id)));
  }
  await opened.store.stop();
  const schedule = events.buildWeekSchedule(list);
  dumpProbe('discord-events-schedule', {
    title: 'G00N SQUAD Discord week schedule',
    guildId,
    schedule,
    events: list.map(events.categorizeEvent)
  });
  if (args.json) {
    console.log(JSON.stringify({ guildId, schedule, events: list.map(events.categorizeEvent) }, null, 2));
    return;
  }
  console.log(`Categorized ${list.length} events\n`);
  for (const day of events.WEEKDAY) {
    const d = schedule.days[day];
    console.log(`## ${day}`);
    if (d.theme) {
      console.log(`  THEME   ${d.theme.name} — ${d.theme.cadence}`);
    } else {
      console.log('  THEME   (none)');
    }
    for (const t of d.timed) console.log(`  TIMED   ${t.name} — ${t.cadence}`);
    for (const s of d.special) console.log(`  SPECIAL ${s.name} — ${s.cadence}`);
    console.log('');
  }
  if (schedule.unassigned.length) {
    console.log('## Unassigned');
    for (const u of schedule.unassigned) console.log(`  ${u.kind} ${u.name} (${u.id})`);
  }
}

async function cmdResolve (args) {
  const ids = args.rest.length ? args.rest : args.ids;
  if (!ids.length) usage(2);
  const auth = events.resolveDiscordEventAuth({
    guildId: args.guild,
    settingsDir: args.settingsDir,
    cwd: path.join(__dirname, '..')
  });
  const opened = await openStore(args);
  const result = await events.resolveEventIds({
    store: opened.store,
    eventIds: ids,
    guildId: auth.guildId,
    token: auth.token
  });
  if (result.fetched.length) {
    events.foldScheduledEvents(opened.store, auth.guildId, result.fetched, { via: 'bot' });
  }
  await opened.store.stop();
  const schedule = events.buildWeekSchedule(result.events);
  const payload = { ...result, schedule };
  dumpProbe('discord-events-resolved', {
    title: 'G00N SQUAD Discord event resolve',
    guildId: result.guildId,
    missing: result.missing,
    errors: result.errors,
    schedule,
    events: result.events
  });
  if (args.json) {
    console.log(JSON.stringify(payload, null, 2));
    return;
  }
  console.log(`Resolved ${result.events.length}/${ids.length}; missing ${result.missing.length}\n`);
  for (const e of result.events) printEvent(e);
  if (result.missing.length) {
    console.log('Missing:');
    for (const id of result.missing) {
      const err = result.errors.find((x) => x.id === id);
      console.log(`  ${id}${err ? ' — ' + err.error : ''}`);
    }
  }
}

function findChrome () {
  const names = [
    process.env.CHROME_PATH,
    process.env.PUPPETEER_EXECUTABLE_PATH,
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge'
  ].filter(Boolean);
  for (const p of names) {
    if (fs.existsSync(p)) return p;
  }
  return null;
}

function writeGraphicFiles (dir, rendered) {
  fs.mkdirSync(dir, { recursive: true });
  const svgPath = path.join(dir, rendered.baseName + '.svg');
  const htmlPath = path.join(dir, rendered.baseName + '.html');
  fs.writeFileSync(svgPath, rendered.svg);
  fs.writeFileSync(htmlPath, rendered.html);
  return { svgPath, htmlPath };
}

function rasterizePng (htmlPath, pngPath) {
  const chrome = findChrome();
  if (!chrome) {
    return { ok: false, error: 'Chrome/Edge not found (set CHROME_PATH)' };
  }
  const absHtml = path.resolve(htmlPath);
  const absPng = path.resolve(pngPath);
  const fileUrl = 'file://' + absHtml;
  const result = spawnSync(chrome, [
    '--headless=new',
    '--disable-gpu',
    '--hide-scrollbars',
    '--no-first-run',
    '--no-default-browser-check',
    `--window-size=${graphic.WIDTH},${graphic.HEIGHT}`,
    `--screenshot=${absPng}`,
    fileUrl
  ], { encoding: 'utf8', timeout: 45000 });
  if (result.status !== 0) {
    const err = (result.stderr || result.stdout || result.error || 'chrome failed');
    return { ok: false, error: String(err).slice(0, 400) };
  }
  if (!fs.existsSync(absPng)) {
    return { ok: false, error: 'chrome exited 0 but PNG was not written' };
  }
  return { ok: true, path: absPng, chrome };
}

async function loadGraphicEvents (args) {
  const guildId = args.guild || events.DEFAULT_GUILD_ID;
  if (args.fromJson) {
    const file = path.resolve(args.fromJson);
    const payload = JSON.parse(fs.readFileSync(file, 'utf8'));
    const list = Array.isArray(payload) ? payload : (payload.events || []);
    return {
      guildId: payload.guildId || guildId,
      fetchedAt: payload.fetchedAt || (payload.schedule && payload.schedule.generatedAt) || null,
      events: list,
      schedule: payload.schedule || null,
      source: file
    };
  }
  if (args.fetch) {
    const auth = events.resolveDiscordEventAuth({
      guildId: args.guild,
      settingsDir: args.settingsDir,
      cwd: path.join(__dirname, '..')
    });
    if (!auth.token) {
      console.error('No Discord bot token. Set DISCORD_BOT_TOKEN or add discord.secrets.json.');
      process.exit(2);
    }
    const res = await events.fetchGuildScheduledEvents({
      token: auth.token,
      guildId: auth.guildId
    });
    if (!res.ok) {
      console.error('Fetch failed:', res.status, res.error);
      process.exit(1);
    }
    if (args.store) {
      try {
        const opened = await openStore(args);
        events.foldScheduledEvents(opened.store, auth.guildId, res.events, { via: 'bot' });
        await opened.store.stop();
      } catch (e) {
        console.error('[discord-events] store fold skipped:', e && e.message ? e.message : e);
      }
    }
    return {
      guildId: auth.guildId,
      fetchedAt: new Date().toISOString(),
      events: res.events,
      schedule: null,
      source: 'discord'
    };
  }
  const opened = await openStore(args);
  const list = events.loadScheduledEvents(opened.store, guildId);
  await opened.store.stop();
  if (!list.length) {
    console.error('[discord-events] store empty, fetching from Discord…');
    args.fetch = true;
    return loadGraphicEvents(args);
  }
  return {
    guildId,
    fetchedAt: null,
    events: list,
    schedule: null,
    source: opened.registerPath
  };
}

async function cmdGraphic (args) {
  const loaded = await loadGraphicEvents(args);
  if (!loaded.events.length) {
    console.error('No scheduled events to render.');
    process.exit(1);
  }
  const schedule = loaded.schedule || events.buildWeekSchedule(loaded.events);
  const rendered = graphic.renderWeekScheduleGraphic({
    events: loaded.events,
    schedule,
    fetchedAt: loaded.fetchedAt || schedule.generatedAt,
    guildName: 'G00N SQUAD'
  });
  const cwd = path.join(__dirname, '..');
  const outDir = path.resolve(args.outDir || path.join(cwd, 'reports'));
  const written = writeGraphicFiles(outDir, rendered);
  console.error(`[discord-events] graphic → ${written.svgPath}`);
  console.error(`[discord-events] graphic → ${written.htmlPath}`);
  if (args.assets) {
    const assetsDir = path.join(cwd, 'assets');
    const copied = writeGraphicFiles(assetsDir, rendered);
    console.error(`[discord-events] assets → ${copied.svgPath}`);
    console.error(`[discord-events] assets → ${copied.htmlPath}`);
  }
  if (args.png) {
    const pngPath = path.join(outDir, rendered.baseName + '.png');
    const png = rasterizePng(written.htmlPath, pngPath);
    if (!png.ok) {
      console.error('[discord-events] PNG skipped:', png.error);
    } else {
      console.error(`[discord-events] graphic → ${png.path}`);
      if (args.assets) {
        fs.copyFileSync(png.path, path.join(cwd, 'assets', rendered.baseName + '.png'));
        console.error(`[discord-events] assets → ${path.join(cwd, 'assets', rendered.baseName + '.png')}`);
      }
    }
  }
  dumpProbe('goon-squad-schedule', {
    title: 'G00N SQUAD weekly ops infographic',
    guildId: loaded.guildId,
    source: loaded.source,
    fetchedAt: loaded.fetchedAt || schedule.generatedAt,
    count: loaded.events.length,
    files: {
      svg: written.svgPath,
      html: written.htmlPath
    },
    schedule: {
      generatedAt: schedule.generatedAt,
      counts: schedule.counts
    }
  });
  if (args.json) {
    console.log(JSON.stringify({
      guildId: loaded.guildId,
      count: loaded.events.length,
      svg: written.svgPath,
      html: written.htmlPath
    }, null, 2));
    return;
  }
  console.log(`Wrote ${guildLabel(loaded)} infographic (${loaded.events.length} events)\n`);
  console.log(`  SVG   ${written.svgPath}`);
  console.log(`  HTML  ${written.htmlPath}`);
  console.log('Re-run: npm run discord:events -- graphic --fetch --png --assets');
}

function guildLabel (loaded) {
  return 'G00N SQUAD (' + loaded.guildId + ')';
}

(async () => {
  const args = parseArgs(process.argv);
  if (args.cmd === 'fetch') await cmdFetch(args);
  else if (args.cmd === 'list') await cmdList(args);
  else if (args.cmd === 'get') await cmdGet(args);
  else if (args.cmd === 'categorize') await cmdCategorize(args);
  else if (args.cmd === 'resolve') await cmdResolve(args);
  else if (args.cmd === 'graphic') await cmdGraphic(args);
  else {
    console.error('Unknown command', args.cmd);
    usage(2);
  }
})().catch((e) => {
  console.error('Error:', e && e.stack ? e.stack : e);
  process.exit(1);
});
