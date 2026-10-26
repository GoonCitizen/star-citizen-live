#!/usr/bin/env node
'use strict';

/**
 * Reproducible PERMAFLEET membership / promotion / invite-gap report.
 *
 * Pulls:
 *   1. G00N SQUAD Discord roster + roles (bot token from desktop secrets)
 *   2. RSI public org member pages (PERMAFLEET + alliance member orgs)
 *
 * Correlates against goon.vc/contracts/roles.dot:
 *   Prospect I–VI (P1–P6), Enlisted 1–3 (E1–E3), select units, member orgs.
 *
 * Usage:
 *   node scripts/permafleet-membership-report.js
 *   node scripts/permafleet-membership-report.js --skip-rsi   # Discord-only refresh
 *   node scripts/permafleet-membership-report.js --out reports/probes
 *
 * Writes:
 *   permafleet-membership-analysis.json
 *   permafleet-membership-roster.csv
 *   goon-squad-discord-roster.json
 *   permafleet-rsi-orgs.json
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const https = require('https');

const ROOT = path.join(__dirname, '..');
const DEFAULT_OUT = path.join(ROOT, 'reports', 'probes');
const GUILD_ID = '1190527980120850493';
const GUILD_NAME = 'G00N SQUAD';

const RSI_ORGS = [
  ['PERMAFLEET', 'PERMAFLEET'],
  ['GOONSQUAD', 'G00N SQUAD'],
  ['INFN', 'Infinity Industries'],
  ['RAT', 'RAT'],
  ['TRDE', 'Transgalactic Trade'],
  ['LEGACY', 'LEGACY'],
  ['TURTLE', 'Turtle Brigade'],
  ['STARJUMP', 'STARJUMP']
];

const PROSPECT = {
  '[P] Prospect I': 1,
  '[P2] Prospect II': 2,
  '[P3] Prospect III': 3,
  '[P4] Prospect IV': 4,
  '[P5] Prospect V': 5,
  '[P6] Prospect VI': 6
};

const ENLISTED = {
  '[E1] Enlisted 1': 1,
  '[E2] Enlisted 2': 2,
  '[E3] Enlisted 3': 3
};

const OFFICER = new Set([
  '[O1] Officer 1',
  '[O2] Officer 2',
  '[PO] PERMAFLEET OFFICERS',
  '[LT] Lieutenant',
  '[CPT] Captain',
  '[MAJ] Major',
  '[RADM] Rear Admiral',
  '[ADM] WARLORDS',
  '[FADM] Fleet Admiral',
  'COMMAND',
  'LEADERSHIP'
]);

const DISCORD_MEMBER_ORGS = {
  'G00N SQUAD': 'G00N SQUAD',
  '[INFN] INFINITY INDUSTRIES': 'Infinity Industries',
  'RAT SQUADRON': 'RAT',
  '[TRDE] TRANS-GALACTIC': 'Transgalactic Trade',
  '[LCRP] LEGACY CORP': 'LEGACY',
  'BLACK EXODUS': 'Black Exodus',
  'TURTLE BRIGADE': 'Turtle Brigade'
};

const SELECT_UNITS = {
  'TURTLE BRIGADE': 'Turtle Brigade',
  SHELLBACK: 'Shellback',
  'BRAVO SQUADRON': 'Bravo Squadron',
  'ALPHA SQUADRON': 'Alpha Squadron',
  'RAT SQUADRON': 'RAT Squadron',
  'GHOST SQUADRON': 'Ghost Squadron',
  '[SO] SPECIAL OPERATORS': 'Special Operations',
  '[PO] PERMAFLEET OFFICERS': 'PERMAFLEET Officers'
};

const CELEBRATION = [
  'CONFIRMED ACES',
  'OG GOON',
  'GOON CORE',
  'VETERANS',
  'ORG STEWARDS',
  'Event Planners',
  'Trainers',
  'Ambassadors',
  'Flight School Certified',
  '1v1 Champion',
  'Confirmed John Wicks',
  'Medal',
  'PATRON'
];

const RSI_ORG_LABELS = Object.fromEntries(RSI_ORGS);

function parseArgs (argv) {
  const out = { outDir: DEFAULT_OUT, skipRsi: false };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--out' && argv[i + 1]) out.outDir = path.resolve(argv[++i]);
    else if (argv[i] === '--skip-rsi') out.skipRsi = true;
  }
  return out;
}

function sleep (ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function httpsJson (url, opts = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = https.request({
      hostname: u.hostname,
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
        if (res.statusCode >= 400) {
          const err = new Error(`HTTP ${res.statusCode} ${url}`);
          err.status = res.statusCode;
          err.body = data;
          return reject(err);
        }
        resolve(data);
      });
    });
    req.on('error', reject);
    if (opts.body) req.write(opts.body);
    req.end();
  });
}

function findDiscordToken () {
  const secretsPath = path.join(
    os.homedir(),
    'Library/Application Support/@rsi/star-citizen/stores/gooncitizen/discord.secrets.json'
  );
  if (!fs.existsSync(secretsPath)) {
    throw new Error('Discord secrets not found at ' + secretsPath);
  }
  const secrets = JSON.parse(fs.readFileSync(secretsPath, 'utf8'));
  function walk (obj) {
    if (!obj || typeof obj !== 'object') return null;
    if (Array.isArray(obj)) {
      for (const v of obj) {
        const found = walk(v);
        if (found) return found;
      }
      return null;
    }
    for (const [k, v] of Object.entries(obj)) {
      if (typeof v === 'string' && /token/i.test(k) && v.length > 20) return v;
      const found = walk(v);
      if (found) return found;
    }
    return null;
  }
  const token = walk(secrets);
  if (!token) throw new Error('No Discord bot token in secrets file');
  return token;
}

async function fetchDiscordRoster (token) {
  const headers = {
    Authorization: 'Bot ' + token,
    'User-Agent': 'GoonCitizenPermafleetReport/1.0'
  };
  const roles = await httpsJson(`https://discord.com/api/v10/guilds/${GUILD_ID}/roles`, { headers });
  const rid = Object.fromEntries(roles.map((r) => [r.id, r.name]));
  const members = [];
  let after = null;
  for (;;) {
    let url = `https://discord.com/api/v10/guilds/${GUILD_ID}/members?limit=1000`;
    if (after) url += `&after=${after}`;
    const batch = await httpsJson(url, { headers });
    if (!batch.length) break;
    members.push(...batch);
    after = batch[batch.length - 1].user.id;
    if (batch.length < 1000) break;
    await sleep(400);
  }
  const roleCounts = {};
  const slim = members.map((m) => {
    const u = m.user || {};
    const roleNames = (m.roles || []).map((id) => rid[id]).filter(Boolean);
    for (const n of roleNames) roleCounts[n] = (roleCounts[n] || 0) + 1;
    return {
      id: u.id,
      username: u.username,
      globalName: u.global_name || null,
      nick: m.nick || null,
      bot: !!u.bot,
      roles: roleNames
    };
  });
  return {
    fetchedAt: new Date().toISOString(),
    guildId: GUILD_ID,
    guildName: GUILD_NAME,
    memberCount: slim.length,
    roleCatalog: roles
      .slice()
      .sort((a, b) => (b.position || 0) - (a.position || 0))
      .map((r) => ({ id: r.id, name: r.name, position: r.position })),
    roleCounts,
    members: slim
  };
}

function parseRsiMembersHtml (html) {
  const members = [];
  const re = /<li class="member-item[^"]*"([^>]*)>([\s\S]*?)<\/li>/g;
  let m;
  while ((m = re.exec(html))) {
    const attrs = m[1];
    const body = m[2];
    const href = /href="\/citizens\/([^"]+)"/.exec(body);
    const handle = href ? href[1] : null;
    const nickM = /class="[^"]*\bnick\b[^"]*"[^>]*>([^<]+)/.exec(body);
    const rankM = /<span class="rank">([^<]+)<\/span>/.exec(body);
    const rolesBlock = /<ul class="rolelist">([\s\S]*?)<\/ul>/.exec(body);
    let roles = [];
    if (rolesBlock) {
      const li = /<li[^>]*>([\s\S]*?)<\/li>/g;
      let lm;
      while ((lm = li.exec(rolesBlock[1]))) {
        const t = lm[1].replace(/<[^>]+>/g, '').trim();
        if (t) roles.push(t);
      }
    }
    members.push({
      handle,
      nick: nickM ? nickM[1].trim() : handle,
      rank: rankM ? rankM[1].trim() : null,
      roles,
      visibility: attrs.includes('org-main')
        ? 'main'
        : (attrs.includes('org-affiliate') ? 'affiliate' : null)
    });
  }
  return members;
}

async function fetchRsiOrg (symbol) {
  async function page (n) {
    const body = JSON.stringify({
      symbol,
      search: '',
      pagesize: 32,
      page: n
    });
    return httpsJson('https://robertsspaceindustries.com/api/orgs/getOrgMembers', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'User-Agent': 'Mozilla/5.0 (compatible; GoonCitizen/1.0; +https://goon.vc)',
        Origin: 'https://robertsspaceindustries.com',
        Referer: `https://robertsspaceindustries.com/en/orgs/${symbol}/members`
      },
      body
    });
  }

  let first = null;
  for (let attempt = 0; attempt < 6; attempt++) {
    first = await page(1);
    if (first && first.success) break;
    if (first && first.code === 'ErrApiThrottled') await sleep(5000 + attempt * 5000);
    else break;
  }
  if (!first || !first.success) {
    return { ok: false, error: first };
  }
  const total = first.data.totalrows;
  const pages = Math.max(1, Math.ceil(total / 32));
  let all = parseRsiMembersHtml(first.data.html);
  for (let p = 2; p <= pages; p++) {
    await sleep(800);
    let data = null;
    for (let a = 0; a < 5; a++) {
      data = await page(p);
      if (data && data.success) break;
      await sleep(5000 + a * 3000);
    }
    if (data && data.success) all = all.concat(parseRsiMembersHtml(data.data.html));
  }
  const by = {};
  for (const row of all) {
    if (row.handle) by[row.handle.toLowerCase()] = row;
  }
  return {
    ok: true,
    data: {
      symbol,
      totalrows: total,
      unique: Object.keys(by).length,
      members: Object.values(by)
    }
  };
}

function norm (s) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

function buildAnalysis (discord, rsiOrgs) {
  const rsiMembership = new Map();
  const rsiHandles = new Map();
  for (const [sid, data] of Object.entries(rsiOrgs.orgs || {})) {
    const label = RSI_ORG_LABELS[sid] || sid;
    for (const m of data.members || []) {
      if (!m.handle) continue;
      const key = m.handle.toLowerCase();
      rsiHandles.set(key, m.handle);
      if (!rsiMembership.has(key)) rsiMembership.set(key, {});
      rsiMembership.get(key)[label] = {
        sid,
        rank: m.rank || null,
        nick: m.nick || null,
        roles: m.roles || []
      };
    }
  }
  const rsiNorm = new Map();
  for (const h of rsiHandles.keys()) rsiNorm.set(norm(h), h);

  function matchRsiKey (m) {
    for (const c of [m.nick, m.globalName, m.username]) {
      if (!c) continue;
      if (rsiMembership.has(c.toLowerCase())) return c.toLowerCase();
      const n = norm(c);
      if (rsiNorm.has(n)) return rsiNorm.get(n);
    }
    return null;
  }

  const rows = [];
  for (const m of discord.members) {
    if (m.bot) continue;
    const roles = new Set(m.roles || []);
    if (!roles.has('PERMAFLEET')) continue;

    let pLevel = null;
    for (const [name, level] of Object.entries(PROSPECT)) {
      if (roles.has(name)) pLevel = Math.max(pLevel || 0, level);
    }
    let eLevel = null;
    for (const [name, level] of Object.entries(ENLISTED)) {
      if (roles.has(name)) eLevel = Math.max(eLevel || 0, level);
    }
    const officerRoles = [...roles].filter((r) => OFFICER.has(r));
    const discordOrgs = [...roles]
      .filter((r) => DISCORD_MEMBER_ORGS[r])
      .map((r) => DISCORD_MEMBER_ORGS[r])
      .sort();
    const selectUnits = [...roles]
      .filter((r) => SELECT_UNITS[r])
      .map((r) => SELECT_UNITS[r])
      .sort();
    const celebs = CELEBRATION.filter((r) => roles.has(r));

    const rk = matchRsiKey(m);
    let rsiOrgsList = [];
    let rsiRank = null;
    let rsiHandle = null;
    if (rk) {
      rsiHandle = rsiHandles.get(rk) || rk;
      const mem = rsiMembership.get(rk) || {};
      if (mem.PERMAFLEET) rsiRank = mem.PERMAFLEET.rank;
      for (const label of Object.keys(mem)) {
        if (label === 'PERMAFLEET') continue;
        let L = label;
        if (L.startsWith('Infinity')) L = 'Infinity Industries';
        if (!rsiOrgsList.includes(L)) rsiOrgsList.push(L);
      }
      rsiOrgsList.sort();
    }
    const allOrgs = [...new Set([...discordOrgs, ...rsiOrgsList])].sort();

    const promotionCandidate = !!(pLevel && pLevel < 6 && !eLevel);
    const selectionCandidate = !!(
      pLevel && pLevel >= 4 && !eLevel && !selectUnits.length && !allOrgs.length
    );
    const celebrated = !!(celebs.length || (pLevel && pLevel >= 4) || eLevel || officerRoles.length);
    const inviteGap = celebrated && !allOrgs.length;

    rows.push({
      discordId: m.id,
      username: m.username,
      displayName: m.nick || m.globalName || m.username,
      prospect: pLevel,
      prospectLabel: pLevel ? `P${pLevel}` : null,
      enlisted: eLevel,
      enlistedLabel: eLevel ? `E${eLevel}` : null,
      officerRoles,
      discordMemberOrgs: discordOrgs,
      rsiMemberOrgs: rsiOrgsList,
      memberOrgs: allOrgs,
      selectUnits,
      celebrationRoles: celebs,
      rsiHandle,
      rsiRank,
      onRsiPermafleet: !!(rk && rsiMembership.get(rk) && rsiMembership.get(rk).PERMAFLEET),
      promotionCandidate,
      promotionTo: promotionCandidate ? `P${pLevel + 1}` : null,
      selectionCandidate,
      inviteGap,
      celebrated
    });
  }

  const discordMatched = new Set(
    rows.filter((r) => r.rsiHandle).map((r) => r.rsiHandle.toLowerCase())
  );
  const rsiOnly = [];
  for (const [h, mem] of rsiMembership.entries()) {
    if (!mem.PERMAFLEET) continue;
    if (discordMatched.has(h)) continue;
    rsiOnly.push({
      rsiHandle: rsiHandles.get(h),
      rsiRank: mem.PERMAFLEET.rank,
      rsiMemberOrgs: Object.keys(mem).filter((l) => l !== 'PERMAFLEET').sort()
    });
  }

  const orgCov = {};
  for (const r of rows) {
    if (!r.memberOrgs.length) orgCov['(none)'] = (orgCov['(none)'] || 0) + 1;
    for (const o of r.memberOrgs) orgCov[o] = (orgCov[o] || 0) + 1;
  }
  const countBy = (fn) => {
    const c = {};
    for (const r of rows) {
      const k = fn(r);
      if (k == null) continue;
      c[k] = (c[k] || 0) + 1;
    }
    return c;
  };

  const sortMembers = (a, b) =>
    ((b.prospect || 0) - (a.prospect || 0)) ||
    ((b.enlisted || 0) - (a.enlisted || 0)) ||
    String(a.displayName || '').localeCompare(String(b.displayName || ''));

  return {
    generatedAt: new Date().toISOString(),
    sources: {
      localGoonCitizen: 'http://127.0.0.1:3041',
      discordGuild: { name: GUILD_NAME, id: GUILD_ID, fetchedAt: discord.fetchedAt },
      rsiOrgsFetched: Object.fromEntries(
        Object.entries(rsiOrgs.orgs || {}).map(([sid, d]) => [
          sid,
          { totalrows: d.totalrows, unique: d.unique }
        ])
      ),
      rankModel: 'goon.vc/contracts/roles.dot + Discord role names'
    },
    definitions: {
      universe: 'Discord members with PERMAFLEET role',
      promotionCandidate: 'Prospect Pn (n<6), not yet Enlisted → candidate for Pn+1',
      selectionCandidate:
        'Prospect IV+ without Enlisted, without select unit, and without any member-org evidence',
      inviteGap:
        'Celebrated or P4+/E*/officer with no member-org evidence on Discord or RSI'
    },
    summary: {
      permafleetDiscord: rows.length,
      onRsiPermafleetMatched: rows.filter((r) => r.onRsiPermafleet).length,
      rsiPermafleetUnmatchedToDiscord: rsiOnly.length,
      prospectCounts: countBy((r) => (r.prospect ? `P${r.prospect}` : null)),
      enlistedCounts: countBy((r) => (r.enlisted ? `E${r.enlisted}` : null)),
      promotionCandidates: rows.filter((r) => r.promotionCandidate).length,
      promotionByProspect: countBy((r) =>
        r.promotionCandidate ? `P${r.prospect}→P${r.prospect + 1}` : null
      ),
      selectionCandidates: rows.filter((r) => r.selectionCandidate).length,
      inviteGaps: rows.filter((r) => r.inviteGap).length,
      memberOrgCoverage: orgCov,
      rsiRankAmongMatched: countBy((r) => (r.onRsiPermafleet ? r.rsiRank : null))
    },
    members: rows.slice().sort(sortMembers),
    promotionCandidates: rows.filter((r) => r.promotionCandidate).sort(sortMembers),
    selectionCandidates: rows.filter((r) => r.selectionCandidate).sort(sortMembers),
    inviteGaps: rows.filter((r) => r.inviteGap).sort(sortMembers),
    rsiOnlyNotOnDiscordPermafleet: rsiOnly.sort((a, b) =>
      String(a.rsiRank || '').localeCompare(String(b.rsiRank || '')) ||
      String(a.rsiHandle).localeCompare(String(b.rsiHandle))
    )
  };
}

function toCsv (analysis) {
  const fields = [
    'displayName', 'username', 'prospectLabel', 'enlistedLabel', 'rsiHandle', 'rsiRank',
    'onRsiPermafleet', 'memberOrgs', 'discordMemberOrgs', 'rsiMemberOrgs', 'selectUnits',
    'celebrationRoles', 'officerRoles', 'promotionCandidate', 'promotionTo',
    'selectionCandidate', 'inviteGap'
  ];
  const esc = (v) => {
    const s = Array.isArray(v) ? v.join('|') : (v == null ? '' : String(v));
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [fields.join(',')];
  for (const r of analysis.members) {
    lines.push(fields.map((f) => esc(r[f])).join(','));
  }
  return lines.join('\n') + '\n';
}

async function main () {
  const args = parseArgs(process.argv.slice(2));
  fs.mkdirSync(args.outDir, { recursive: true });

  console.log('[permafleet-report] fetching Discord roster…');
  const token = findDiscordToken();
  const discord = await fetchDiscordRoster(token);
  fs.writeFileSync(
    path.join(args.outDir, 'goon-squad-discord-roster.json'),
    JSON.stringify(discord, null, 2)
  );
  console.log(`[permafleet-report] Discord members: ${discord.memberCount}`);

  let rsiOrgs = { fetchedAt: new Date().toISOString(), orgs: {} };
  const rsiPath = path.join(args.outDir, 'permafleet-rsi-orgs.json');
  if (args.skipRsi && fs.existsSync(rsiPath)) {
    rsiOrgs = JSON.parse(fs.readFileSync(rsiPath, 'utf8'));
    console.log('[permafleet-report] reusing cached RSI orgs');
  } else if (!args.skipRsi) {
    for (const [sid] of RSI_ORGS) {
      console.log(`[permafleet-report] RSI ${sid}…`);
      const out = await fetchRsiOrg(sid);
      if (out.ok) {
        rsiOrgs.orgs[sid] = out.data;
        console.log(`  ${out.data.totalrows} rows / ${out.data.unique} unique`);
      } else {
        console.warn(`  FAIL`, out.error && out.error.code);
      }
      await sleep(6000);
    }
    fs.writeFileSync(rsiPath, JSON.stringify(rsiOrgs, null, 2));
  }

  const analysis = buildAnalysis(discord, rsiOrgs);
  fs.writeFileSync(
    path.join(args.outDir, 'permafleet-membership-analysis.json'),
    JSON.stringify(analysis, null, 2)
  );
  fs.writeFileSync(
    path.join(args.outDir, 'permafleet-membership-roster.csv'),
    toCsv(analysis)
  );

  console.log('[permafleet-report] summary');
  console.log(JSON.stringify(analysis.summary, null, 2));
  console.log(`[permafleet-report] wrote ${args.outDir}`);
}

main().catch((err) => {
  console.error('[permafleet-report]', err);
  process.exit(1);
});
