'use strict';

/**
 * Fetch G00N SQUAD Discord roles via the local GoonCitizen API and write a
 * reproducible HTML guide (+ probe JSON).
 *
 * Usage:
 *   npm run discord:roles-guide
 *   npm run discord:roles-guide -- --api http://127.0.0.1:3041
 *   npm run discord:roles-guide -- --from-json reports/probes/goon-squad-roles.json
 *   npm run discord:roles-guide -- --assets --no-counts
 *
 * Prefers:
 *   GET {api}/services/star-citizen/discord/guilds/{guildId}/roles?counts=1
 * Falls back to Discord REST (same bot token resolution as discord-events) when
 * the local roles route is unavailable (e.g. LiveRelay not yet restarted).
 */

const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');

const events = require('../functions/discordScheduledEvents');
const guide = require('../functions/goonSquadRolesGuide');
const { writeAgentProbe } = require('../functions/agentProbeExport');

const ROOT = path.join(__dirname, '..');
const DEFAULT_API = process.env.GOONCITIZEN_API || 'http://127.0.0.1:3041';
const BASE = '/services/star-citizen';

function usage (code = 0) {
  const text = `Usage:
  node scripts/goon-squad-roles-guide.js [--api URL] [--guild ID]
  node scripts/goon-squad-roles-guide.js --from-json FILE
  Options:
    --api URL       GoonCitizen HTTP origin (default ${DEFAULT_API})
    --guild ID      Discord guild snowflake (default G00N SQUAD)
    --from-json F   Skip live fetch; build HTML from a saved roles/roster JSON
    --out-dir DIR   Write HTML here (default reports/)
    --assets        Also copy HTML into assets/
    --no-counts     Skip member pagination (catalog only)
    --refresh       Pass refresh=1 to the local API
`;
  if (code) console.error(text);
  else console.log(text);
  process.exit(code);
}

function parseArgs (argv) {
  const out = {
    api: DEFAULT_API,
    guild: guide.DEFAULT_GUILD_ID,
    fromJson: null,
    outDir: path.join(ROOT, 'reports'),
    assets: false,
    counts: true,
    refresh: false,
    help: false
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--help' || a === '-h') out.help = true;
    else if (a === '--api' && argv[i + 1]) out.api = String(argv[++i]).replace(/\/$/, '');
    else if (a === '--guild' && argv[i + 1]) out.guild = String(argv[++i]).trim();
    else if (a === '--from-json' && argv[i + 1]) out.fromJson = path.resolve(argv[++i]);
    else if (a === '--out-dir' && argv[i + 1]) out.outDir = path.resolve(argv[++i]);
    else if (a === '--assets') out.assets = true;
    else if (a === '--no-counts') out.counts = false;
    else if (a === '--refresh') out.refresh = true;
  }
  return out;
}

function httpJson (url, opts = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const lib = u.protocol === 'https:' ? https : http;
    const req = lib.request({
      hostname: u.hostname,
      port: u.port || (u.protocol === 'https:' ? 443 : 80),
      path: u.pathname + u.search,
      method: opts.method || 'GET',
      headers: opts.headers || {}
    }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf8');
        let data = null;
        try { data = JSON.parse(raw); } catch (_) { data = raw; }
        resolve({ status: res.statusCode || 0, data });
      });
    });
    req.on('error', reject);
    if (opts.body) req.write(opts.body);
    req.end();
  });
}

function sleep (ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function fetchViaLocalApi (args) {
  const q = new URLSearchParams();
  if (args.counts) q.set('counts', '1');
  else q.set('counts', '0');
  if (args.refresh) q.set('refresh', '1');
  const url = `${args.api}${BASE}/discord/guilds/${encodeURIComponent(args.guild)}/roles?${q}`;
  const res = await httpJson(url);
  if (res.status === 200 && res.data && res.data.data) {
    return { payload: res.data.data, source: 'local-api:' + url.split('?')[0] };
  }
  const err = new Error(
    `local API HTTP ${res.status}` +
    (res.data && res.data.error ? `: ${res.data.error}` : '')
  );
  err.status = res.status;
  err.body = res.data;
  throw err;
}

async function fetchViaDiscordRest (args) {
  const resolved = events.resolveDiscordEventAuth({
    guildId: args.guild,
    cwd: ROOT
  });
  const token = resolved.token;
  if (!token) {
    throw new Error('No Discord bot token (DISCORD_BOT_TOKEN or discord.secrets.json)');
  }
  const headers = {
    Authorization: 'Bot ' + token,
    'User-Agent': 'GoonCitizenRolesGuide/1.0'
  };
  const rolesRes = await httpJson(
    `https://discord.com/api/v10/guilds/${args.guild}/roles`,
    { headers }
  );
  if (rolesRes.status !== 200 || !Array.isArray(rolesRes.data)) {
    throw new Error(`Discord roles HTTP ${rolesRes.status}`);
  }
  const roles = rolesRes.data;
  const holderCounts = Object.create(null);
  let memberCount = 0;
  let countsSource = 'none';
  if (args.counts) {
    let after = null;
    for (let page = 0; page < 20; page++) {
      let pathUrl = `https://discord.com/api/v10/guilds/${args.guild}/members?limit=1000`;
      if (after) pathUrl += `&after=${after}`;
      const batch = await httpJson(pathUrl, { headers });
      if (batch.status !== 200 || !Array.isArray(batch.data)) {
        throw new Error(`Discord members HTTP ${batch.status}`);
      }
      if (!batch.data.length) break;
      for (const m of batch.data) {
        memberCount += 1;
        for (const rid of (m.roles || [])) {
          const id = String(rid);
          holderCounts[id] = (holderCounts[id] || 0) + 1;
        }
      }
      after = batch.data[batch.data.length - 1].user &&
        batch.data[batch.data.length - 1].user.id;
      if (batch.data.length < 1000 || !after) break;
      await sleep(350);
    }
    countsSource = 'rest_members';
  }
  const catalog = roles
    .slice()
    .sort((a, b) => (b.position || 0) - (a.position || 0))
    .map((r) => {
      const color = Number(r.color) || 0;
      return {
        id: String(r.id),
        name: String(r.name),
        position: Number(r.position) || 0,
        color,
        colorHex: color > 0 ? ('#' + color.toString(16).padStart(6, '0')) : null,
        hoist: r.hoist === true,
        managed: r.managed === true,
        mentionable: r.mentionable === true,
        holders: args.counts ? (holderCounts[String(r.id)] || 0) : null
      };
    });
  const roleCounts = {};
  for (const r of catalog) {
    if (r.holders == null) continue;
    roleCounts[r.name] = (roleCounts[r.name] || 0) + r.holders;
  }
  return {
    payload: {
      guildId: args.guild,
      guildName: guide.DEFAULT_GUILD_NAME,
      memberCount: memberCount || null,
      roleCount: catalog.length,
      countsSource,
      botReady: true,
      roles: catalog,
      roleCounts,
      observedAt: new Date().toISOString()
    },
    source: 'discord-rest-fallback'
  };
}

function loadFromJson (file) {
  const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  // Accept DiscordGuildRoles envelope, probe wrapper, or roster shape.
  const payload = raw.data && Array.isArray(raw.data.roles)
    ? raw.data
    : (raw.roles || raw.roleCatalog
      ? raw
      : (raw.payload || raw));
  return {
    payload,
    source: 'from-json:' + path.relative(ROOT, file)
  };
}

function writeOutputs (args, payload, source) {
  fs.mkdirSync(args.outDir, { recursive: true });
  const model = guide.buildGuideModel(payload, {
    generatedAt: new Date().toISOString(),
    source
  });
  const html = guide.renderRolesGuideHtml(model);
  const base = 'goon-squad-roles';
  const htmlPath = path.join(args.outDir, base + '.html');
  fs.writeFileSync(htmlPath, html, 'utf8');
  console.error(`[roles-guide] wrote ${htmlPath}`);

  if (args.assets) {
    const assetsDir = path.join(ROOT, 'assets');
    fs.mkdirSync(assetsDir, { recursive: true });
    const assetsPath = path.join(assetsDir, base + '.html');
    fs.writeFileSync(assetsPath, html, 'utf8');
    console.error(`[roles-guide] wrote ${assetsPath}`);
  }

  try {
    const written = writeAgentProbe(base, {
      title: 'G00N SQUAD Discord roles guide',
      generatedAt: model.generatedAt,
      source,
      guildId: model.guildId,
      guildName: model.guildName,
      memberCount: model.memberCount,
      roleCount: model.roleCount,
      countsSource: model.countsSource,
      ladder: model.ladder,
      sections: model.sections.map((s) => ({
        id: s.id,
        title: s.title,
        holders: s.holders,
        roles: s.rows.map((r) => ({
          name: r.name,
          label: r.label,
          holders: r.holders,
          present: r.present
        }))
      })),
      otherCount: (model.other || []).length,
      roles: payload.roles || payload.roleCatalog || [],
      roleCounts: payload.roleCounts || {}
    }, { cwd: ROOT });
    console.error(`[roles-guide] probe → ${written.localPath}`);
  } catch (e) {
    console.error('[roles-guide] probe export failed:', e && e.message ? e.message : e);
  }

  return { htmlPath, model };
}

async function main () {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) usage(0);

  let fetched;
  if (args.fromJson) {
    fetched = loadFromJson(args.fromJson);
  } else {
    try {
      fetched = await fetchViaLocalApi(args);
      console.error(`[roles-guide] local API ok (${fetched.source})`);
    } catch (apiErr) {
      console.error(
        `[roles-guide] local API unavailable (${apiErr && apiErr.message ? apiErr.message : apiErr}); ` +
        'trying Discord REST via bot token'
      );
      try {
        fetched = await fetchViaDiscordRest(args);
        console.error(`[roles-guide] Discord REST ok (${fetched.payload.roleCount} roles, ` +
          `${fetched.payload.memberCount || '?'} members)`);
      } catch (restErr) {
        const rosterPath = path.join(ROOT, 'reports', 'probes', 'goon-squad-discord-roster.json');
        if (fs.existsSync(rosterPath)) {
          console.error(
            `[roles-guide] Discord REST failed (${restErr && restErr.message ? restErr.message : restErr}); ` +
            `using cached roster ${path.relative(ROOT, rosterPath)}`
          );
          fetched = loadFromJson(rosterPath);
        } else {
          throw restErr;
        }
      }
    }
  }

  const { htmlPath, model } = writeOutputs(args, fetched.payload, fetched.source);
  console.log(JSON.stringify({
    ok: true,
    html: path.relative(ROOT, htmlPath),
    guildId: model.guildId,
    guildName: model.guildName,
    memberCount: model.memberCount,
    roleCount: model.roleCount,
    source: fetched.source
  }, null, 2));
}

main().catch((e) => {
  console.error('[roles-guide] failed:', e && e.stack ? e.stack : e);
  process.exit(1);
});
