'use strict';

/**
 * Reproducible HTML guide to G00N SQUAD Discord roles.
 *
 * Taxonomy mirrors goon.vc/contracts/roles.dot (+ structure / promotions),
 * filled with live holder counts from DiscordGuildRoles (GoonCitizen API).
 *
 *   npm run discord:roles-guide
 *   npm run discord:roles-guide -- --from-json reports/probes/goon-squad-roles.json
 */

const DEFAULT_GUILD_ID = '1190527980120850493';
const DEFAULT_GUILD_NAME = 'G00N SQUAD';

const INK = Object.freeze({
  bg: '#0c0c0d',
  panel: '#161618',
  panelAlt: '#1c1c1f',
  line: '#2c2c30',
  ink: '#f4f1ea',
  muted: '#9a9488',
  faint: '#6b665c',
  red: '#c81e1e',
  redDark: '#6e1010',
  redMid: '#9b1616',
  cream: '#e8dcc8',
  green: '#3f7d4e',
  blue: '#3a6ea5'
});

/**
 * Guide sections — Discord role names as they appear on G00N SQUAD.
 * `names` may be a string or string[] (aliases); first match wins for counts.
 * @type {ReadonlyArray<{id:string, title:string, blurb:string, rows:Array<{names:string|string[], label?:string, note?:string}>}>}
 */
const SECTIONS = Object.freeze([
  {
    id: 'entry',
    title: 'Entry & identity',
    blurb: 'Everyone lands here first. GREENBACKS is the open door; Star Citizens tags the game identity.',
    rows: [
      { names: 'GREENBACKS', note: 'Default community role — apply to join the RSI org when ready.' },
      { names: 'Star Citizens', note: 'In-game / SC player tag.' },
      { names: 'PERMAFLEET GUESTS', note: 'Visiting alliance guests before full PERMAFLEET.' },
      { names: 'NORMIES', note: 'Casual / off-meta hangout tag.' }
    ]
  },
  {
    id: 'membership',
    title: 'PERMAFLEET membership',
    blurb: 'Official alliance membership. From contracts/roles.dot: GREENBACK → PERMAFLEET (apply to join the RSI organization).',
    rows: [
      { names: 'PERMAFLEET', note: 'Alliance member — first rank in the PERMAFLEET program.' },
      { names: 'G00N SQUAD', note: 'Core org membership chip.' },
      { names: 'Enlisted', note: 'Broad enlisted bucket (pre-[E1] / legacy).' }
    ]
  },
  {
    id: 'prospect',
    title: 'Prospect track',
    blurb: 'Promotion ladder inside PERMAFLEET. Leadership advances Prospects; Prospect IV unlocks select-unit and officer paths.',
    rows: [
      { names: '[P] Prospect I', label: 'Prospect I', note: 'First Prospect rank.' },
      { names: '[P2] Prospect II', label: 'Prospect II', note: 'Promoted by leadership.' },
      { names: '[P3] Prospect III', label: 'Prospect III', note: 'Promoted by leadership.' },
      { names: '[P4] Prospect IV', label: 'Prospect IV', note: 'Branch point — teams, units, or officer school.' },
      { names: '[P5] Prospect V', label: 'Prospect V', note: 'Promoted by leadership.' },
      { names: '[P6] Prospect VI', label: 'Prospect VI', note: 'Top Prospect rank.' }
    ]
  },
  {
    id: 'enlisted',
    title: 'Enlisted performance',
    blurb: 'Selected into an official team from Prospect IV+. Rewarded for performance and skill (roles.dot).',
    rows: [
      { names: '[E1] Enlisted 1', label: 'Enlisted 1', note: 'Selected into an official team.' },
      { names: '[E2] Enlisted 2', label: 'Enlisted 2', note: 'Rewarded for performance and skill.' },
      { names: '[E3] Enlisted 3', label: 'Enlisted 3', note: 'Top enlisted performance rank.' }
    ]
  },
  {
    id: 'units',
    title: 'Select units',
    blurb: 'Specialty paths from Prospect IV — infantry, fighters, piracy, and special operators.',
    rows: [
      { names: 'TURTLE BRIGADE', note: 'Basic infantry training.' },
      { names: 'SHELLBACK', note: 'Elite infantry (from Turtle Brigade).' },
      { names: 'BRAVO SQUADRON', note: 'Fighter squadron.' },
      { names: 'ALPHA SQUADRON', note: 'Top ~5% of Bravo.' },
      { names: 'RAT SQUADRON', note: 'Piracy unit.' },
      { names: 'GHOST SQUADRON', note: 'Ghost / special flight path.' },
      { names: '[SO] SPECIAL OPERATORS', label: 'Special Operators', note: 'Special operations cadre.' }
    ]
  },
  {
    id: 'officers',
    title: 'Officer & command',
    blurb: 'Officer school → commissioned ranks → admiralty / command. Structure.dot: Enlisted → Candidate → Officer → Admiral.',
    rows: [
      { names: '[PO] PERMAFLEET OFFICERS', label: 'PERMAFLEET Officers', note: 'Officer training track.' },
      { names: '[O1] Officer 1', label: 'Officer 1', note: 'Junior officer.' },
      { names: '[O2] Officer 2', label: 'Officer 2', note: 'Senior junior officer.' },
      { names: '[LT] Lieutenant', label: 'Lieutenant', note: 'Selected by a Captain.' },
      { names: '[CPT] Captain', label: 'Captain', note: 'Selected by a Major.' },
      { names: '[MAJ] Major', label: 'Major', note: 'Promoted by leadership.' },
      { names: '[RADM] Rear Admiral', label: 'Rear Admiral', note: 'Flag rank.' },
      { names: ['[VADM] Vice Admiral', 'Vice Admiral'], label: 'Vice Admiral', note: 'Flag rank.' },
      { names: '[ADM] WARLORDS', label: 'Warlords / Admiral', note: 'Senior admiralty.' },
      { names: '[FADM] Fleet Admiral', label: 'Fleet Admiral', note: 'Top fleet command.' },
      { names: 'COMMAND', note: 'Command staff.' },
      { names: 'LEADERSHIP', note: 'Org leadership.' }
    ]
  },
  {
    id: 'orgs',
    title: 'Member organizations',
    blurb: 'Alliance member-org chips on Discord (RSI SIDs correlate in the PERMAFLEET membership report).',
    rows: [
      { names: '[INFN] INFINITY INDUSTRIES', label: 'Infinity Industries' },
      { names: '[TRDE] TRANS-GALACTIC', label: 'Transgalactic Trade' },
      { names: '[LCRP] LEGACY CORP', label: 'LEGACY' },
      { names: 'BLACK EXODUS', label: 'Black Exodus' },
      { names: 'TURTLE BRIGADE', label: 'Turtle Brigade (unit + org)' },
      { names: 'RAT SQUADRON', label: 'RAT' }
    ]
  },
  {
    id: 'interest',
    title: 'Interest & ops tags',
    blurb: 'Self-select playstyle and activity tags — not a promotion ladder.',
    rows: [
      { names: 'RED ARMY', note: 'PvP / combat-focused.' },
      { names: 'PVP INQUISITORS', note: 'PvP inquisitor track.' },
      { names: 'INDUSTRIAL INQUISITORS', note: 'Industry / economy track.' },
      { names: 'SALT MINERS', note: 'Mining community.' },
      { names: 'LOGISTICS', note: 'Hauling / logistics.' },
      { names: 'MERCHANTS', note: 'Trade.' },
      { names: 'Trainers', note: 'Training staff.' },
      { names: 'Ambassadors', note: 'External relations.' },
      { names: 'Event Planners', note: 'Ops / event coordination.' },
      { names: 'RECRUITERS', note: 'Recruitment.' },
      { names: 'ORG STEWARDS', note: 'Org stewardship.' }
    ]
  },
  {
    id: 'celebration',
    title: 'Recognition',
    blurb: 'Celebration and achievement roles — earned, not ladder ranks.',
    rows: [
      { names: 'OG GOON' },
      { names: 'GOON CORE' },
      { names: 'VETERANS' },
      { names: 'CONFIRMED ACES' },
      { names: 'Confirmed John Wicks' },
      { names: '1v1 Champion' },
      { names: 'Flight School Certified' },
      { names: 'PATRON' },
      { names: 'Medal' }
    ]
  }
]);

/**
 * Compact ladder steps for the hero diagram (roles.dot spine).
 * @type {ReadonlyArray<{label:string, names:string|string[]}>}
 */
const LADDER_STEPS = Object.freeze([
  { label: 'GREENBACKS', names: 'GREENBACKS' },
  { label: 'PERMAFLEET', names: 'PERMAFLEET' },
  { label: 'Prospect I–VI', names: ['[P] Prospect I', '[P2] Prospect II', '[P3] Prospect III', '[P4] Prospect IV', '[P5] Prospect V', '[P6] Prospect VI'] },
  { label: 'Enlisted / Units', names: ['[E1] Enlisted 1', 'TURTLE BRIGADE', 'BRAVO SQUADRON', 'RAT SQUADRON'] },
  { label: 'Officers', names: ['[PO] PERMAFLEET OFFICERS', '[LT] Lieutenant', '[CPT] Captain', '[MAJ] Major'] },
  { label: 'Command', names: ['COMMAND', 'LEADERSHIP', '[FADM] Fleet Admiral'] }
]);

/**
 * @param {string} s
 * @returns {string}
 */
function escapeHtml (s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * @param {string|string[]} names
 * @returns {string[]}
 */
function nameList (names) {
  return (Array.isArray(names) ? names : [names])
    .map((n) => String(n || '').trim())
    .filter(Boolean);
}

/**
 * @param {object} payload DiscordGuildRoles data (or roster-shaped)
 * @returns {{byName: Map<string, object>, roleCounts: Record<string, number>, roles: object[]}}
 */
function indexRoles (payload) {
  const roles = Array.isArray(payload && payload.roles)
    ? payload.roles
    : (Array.isArray(payload && payload.roleCatalog) ? payload.roleCatalog : []);
  const roleCounts = (payload && payload.roleCounts && typeof payload.roleCounts === 'object')
    ? payload.roleCounts
    : {};
  const byName = new Map();
  for (const r of roles) {
    if (!r || r.name == null) continue;
    const holders = r.holders != null
      ? Number(r.holders)
      : (roleCounts[r.name] != null ? Number(roleCounts[r.name]) : null);
    const row = Object.assign({}, r, { holders });
    if (!byName.has(r.name)) byName.set(String(r.name), row);
  }
  // Fill counts-only names missing from catalog
  for (const [name, count] of Object.entries(roleCounts)) {
    if (!byName.has(name)) {
      byName.set(name, { name, holders: Number(count) || 0, position: -1 });
    }
  }
  return { byName, roleCounts, roles };
}

/**
 * @param {Map<string, object>} byName
 * @param {string|string[]} names
 * @returns {object|null}
 */
function resolveRole (byName, names) {
  for (const n of nameList(names)) {
    if (byName.has(n)) return byName.get(n);
  }
  return null;
}

/**
 * @param {Map<string, object>} byName
 * @param {string|string[]} names
 * @returns {number}
 */
function holdersFor (byName, names) {
  let total = 0;
  let any = false;
  for (const n of nameList(names)) {
    const r = byName.get(n);
    if (r && r.holders != null) {
      total += Number(r.holders) || 0;
      any = true;
    }
  }
  return any ? total : 0;
}

/**
 * Roles in the live catalog that are not named in any guide section.
 * @param {Map<string, object>} byName
 * @returns {object[]}
 */
function uncategorizedRoles (byName) {
  const known = new Set();
  for (const section of SECTIONS) {
    for (const row of section.rows) {
      for (const n of nameList(row.names)) known.add(n);
    }
  }
  const skip = new Set(['@everyone', 'new role']);
  const out = [];
  for (const [name, row] of byName) {
    if (known.has(name) || skip.has(name)) continue;
    if (row.managed === true) continue;
    out.push(row);
  }
  out.sort((a, b) => {
    const hb = b.holders != null ? Number(b.holders) : -1;
    const ha = a.holders != null ? Number(a.holders) : -1;
    if (hb !== ha) return hb - ha;
    return String(a.name).localeCompare(String(b.name));
  });
  return out;
}

/**
 * @param {object} payload
 * @param {Object} [opts]
 * @param {string} [opts.generatedAt]
 * @param {string} [opts.source]
 * @returns {object}
 */
function buildGuideModel (payload, opts = {}) {
  const { byName, roles } = indexRoles(payload || {});
  const guildId = String((payload && (payload.guildId || payload.id)) || DEFAULT_GUILD_ID);
  const guildName = String((payload && (payload.guildName || payload.name)) || DEFAULT_GUILD_NAME);
  const memberCount = payload && payload.memberCount != null
    ? Number(payload.memberCount)
    : null;
  const sections = SECTIONS.map((section) => {
    const rows = section.rows.map((row) => {
      const hit = resolveRole(byName, row.names);
      const primary = nameList(row.names)[0];
      return {
        name: primary,
        label: row.label || primary,
        note: row.note || '',
        holders: holdersFor(byName, row.names),
        present: !!hit,
        colorHex: hit && hit.colorHex ? hit.colorHex : null,
        position: hit && hit.position != null ? hit.position : null
      };
    });
    return {
      id: section.id,
      title: section.title,
      blurb: section.blurb,
      rows,
      holders: rows.reduce((n, r) => n + (r.holders || 0), 0)
    };
  });
  const ladder = LADDER_STEPS.map((step) => ({
    label: step.label,
    holders: holdersFor(byName, step.names)
  }));
  const other = uncategorizedRoles(byName).map((r) => ({
    name: r.name,
    holders: r.holders != null ? Number(r.holders) : 0,
    colorHex: r.colorHex || null,
    position: r.position
  }));
  return {
    guildId,
    guildName,
    memberCount,
    roleCount: roles.length || byName.size,
    countsSource: (payload && payload.countsSource) || null,
    generatedAt: opts.generatedAt || new Date().toISOString(),
    source: opts.source || 'DiscordGuildRoles',
    ladder,
    sections,
    other
  };
}

/**
 * @param {object} model from buildGuideModel
 * @returns {string}
 */
function renderRolesGuideHtml (model) {
  const m = model || buildGuideModel({});
  const when = new Date(m.generatedAt).toLocaleString('en-US', {
    timeZone: 'America/Chicago',
    dateStyle: 'medium',
    timeStyle: 'short'
  });
  const memberLabel = m.memberCount != null
    ? `${m.memberCount.toLocaleString()} members`
    : 'roster size unknown';

  const ladderHtml = m.ladder.map((step, i) => {
    const arrow = i < m.ladder.length - 1
      ? '<span class="ladder-arrow" aria-hidden="true">→</span>'
      : '';
    return `<div class="ladder-step"><strong>${escapeHtml(step.label)}</strong>` +
      `<span class="count">${Number(step.holders).toLocaleString()}</span></div>${arrow}`;
  }).join('');

  const sectionsHtml = m.sections.map((section) => {
    const rows = section.rows.map((row) => {
      const missing = row.present ? '' : ' missing';
      const swatch = row.colorHex
        ? `<span class="swatch" style="background:${escapeHtml(row.colorHex)}"></span>`
        : '<span class="swatch empty"></span>';
      return `<tr class="${missing.trim()}">` +
        `<td class="role">${swatch}<span>${escapeHtml(row.label)}</span>` +
        (row.name !== row.label
          ? `<code class="discord-name">${escapeHtml(row.name)}</code>`
          : '') +
        `</td>` +
        `<td class="holders">${Number(row.holders).toLocaleString()}</td>` +
        `<td class="note">${escapeHtml(row.note || (row.present ? '' : 'Not found on live Discord'))}</td>` +
        `</tr>`;
    }).join('\n');
    return `
<section class="block" id="${escapeHtml(section.id)}">
  <header>
    <h2>${escapeHtml(section.title)}</h2>
    <p>${escapeHtml(section.blurb)}</p>
  </header>
  <table>
    <thead><tr><th>Role</th><th>Holders</th><th>Meaning</th></tr></thead>
    <tbody>
${rows}
    </tbody>
  </table>
</section>`;
  }).join('\n');

  const otherRows = (m.other || []).slice(0, 120).map((row) => {
    const swatch = row.colorHex
      ? `<span class="swatch" style="background:${escapeHtml(row.colorHex)}"></span>`
      : '<span class="swatch empty"></span>';
    return `<tr><td class="role">${swatch}<span>${escapeHtml(row.name)}</span></td>` +
      `<td class="holders">${Number(row.holders).toLocaleString()}</td></tr>`;
  }).join('\n');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1"/>
  <title>${escapeHtml(m.guildName)} — Discord Roles Guide</title>
  <style>
    :root {
      --bg: ${INK.bg};
      --panel: ${INK.panel};
      --panel-alt: ${INK.panelAlt};
      --line: ${INK.line};
      --ink: ${INK.ink};
      --muted: ${INK.muted};
      --faint: ${INK.faint};
      --red: ${INK.red};
      --red-dark: ${INK.redDark};
      --cream: ${INK.cream};
    }
    * { box-sizing: border-box; }
    html, body {
      margin: 0; padding: 0;
      background:
        radial-gradient(1200px 600px at 10% -10%, #2a1010 0%, transparent 55%),
        radial-gradient(900px 500px at 100% 0%, #1a1210 0%, transparent 50%),
        var(--bg);
      color: var(--ink);
      font-family: "Helvetica Neue", Helvetica, Arial, sans-serif;
      line-height: 1.45;
    }
    .wrap { max-width: 980px; margin: 0 auto; padding: 48px 24px 96px; }
    .hero {
      border-bottom: 1px solid var(--line);
      padding-bottom: 28px;
      margin-bottom: 36px;
    }
    .hero .bar { height: 6px; width: 120px; background: var(--red); margin-bottom: 28px; }
    .hero h1 {
      margin: 0;
      font-family: "Arial Black", "Helvetica Neue", Helvetica, Arial, sans-serif;
      font-size: clamp(2rem, 5vw, 3rem);
      letter-spacing: 0.08em;
      font-weight: 900;
    }
    .hero .kicker {
      margin: 10px 0 0;
      color: var(--red);
      font-weight: 700;
      letter-spacing: 0.28em;
      font-size: 0.85rem;
      text-transform: uppercase;
    }
    .hero .lede {
      margin: 18px 0 0;
      max-width: 42rem;
      color: var(--muted);
      font-size: 1.05rem;
    }
    .meta {
      margin-top: 18px;
      display: flex; flex-wrap: wrap; gap: 10px 18px;
      color: var(--faint); font-size: 0.85rem;
    }
    .meta strong { color: var(--cream); font-weight: 700; }
    .ladder {
      display: flex; flex-wrap: wrap; align-items: stretch; gap: 8px;
      margin: 36px 0 8px;
    }
    .ladder-step {
      background: var(--panel);
      border: 1px solid var(--line);
      border-left: 4px solid var(--red);
      padding: 12px 14px;
      min-width: 7.5rem;
    }
    .ladder-step strong { display: block; font-size: 0.82rem; letter-spacing: 0.04em; }
    .ladder-step .count { display: block; margin-top: 6px; color: var(--cream); font-weight: 700; }
    .ladder-arrow { color: var(--red); align-self: center; font-size: 1.2rem; padding: 0 2px; }
    nav.toc {
      margin: 28px 0 8px;
      display: flex; flex-wrap: wrap; gap: 8px;
    }
    nav.toc a {
      color: var(--cream);
      text-decoration: none;
      border: 1px solid var(--line);
      background: var(--panel-alt);
      padding: 6px 10px;
      font-size: 0.8rem;
      letter-spacing: 0.04em;
    }
    nav.toc a:hover { border-color: var(--red); }
    .block {
      margin-top: 40px;
      background: var(--panel);
      border: 1px solid var(--line);
      padding: 22px 22px 8px;
    }
    .block header h2 {
      margin: 0;
      font-size: 1.25rem;
      letter-spacing: 0.06em;
      text-transform: uppercase;
    }
    .block header p {
      margin: 8px 0 16px;
      color: var(--muted);
      font-size: 0.95rem;
    }
    table { width: 100%; border-collapse: collapse; margin-bottom: 12px; }
    th, td {
      text-align: left;
      padding: 10px 8px;
      border-top: 1px solid var(--line);
      vertical-align: top;
    }
    th {
      color: var(--faint);
      font-size: 0.72rem;
      letter-spacing: 0.14em;
      text-transform: uppercase;
      font-weight: 700;
    }
    td.holders {
      width: 5.5rem;
      font-variant-numeric: tabular-nums;
      color: var(--cream);
      font-weight: 700;
    }
    td.note { color: var(--muted); font-size: 0.9rem; }
    td.role { display: flex; align-items: flex-start; gap: 10px; font-weight: 600; }
    td.role span { display: inline; }
    .discord-name {
      display: block;
      margin-top: 4px;
      font-size: 0.72rem;
      color: var(--faint);
      font-weight: 500;
    }
    .swatch {
      width: 12px; height: 12px; margin-top: 4px; flex: 0 0 auto;
      background: var(--red-dark); border: 1px solid var(--line);
    }
    .swatch.empty { background: transparent; }
    tr.missing td.role span { color: var(--faint); }
    tr.missing td.holders { color: var(--faint); }
    .footnote {
      margin-top: 48px;
      color: var(--faint);
      font-size: 0.82rem;
      max-width: 40rem;
    }
    .footnote code {
      color: var(--cream);
      font-size: 0.8rem;
    }
    @media (max-width: 720px) {
      .wrap { padding: 28px 16px 64px; }
      td.note { display: none; }
      .ladder-arrow { display: none; }
    }
  </style>
</head>
<body>
  <main class="wrap">
    <header class="hero">
      <div class="bar" aria-hidden="true"></div>
      <h1>${escapeHtml(m.guildName)}</h1>
      <p class="kicker">Discord Roles Guide</p>
      <p class="lede">How the G00N SQUAD / PERMAFLEET role ladder works — entry, Prospects, enlisted &amp; select units, officers, and recognition — with live holder counts from Discord.</p>
      <div class="meta">
        <span><strong>${escapeHtml(memberLabel)}</strong></span>
        <span><strong>${Number(m.roleCount).toLocaleString()} roles</strong> in catalog</span>
        <span>As of <strong>${escapeHtml(when)} CT</strong></span>
        <span>Source: <strong>${escapeHtml(m.source || 'DiscordGuildRoles')}</strong></span>
      </div>
      <div class="ladder" aria-label="Promotion ladder overview">${ladderHtml}</div>
      <nav class="toc" aria-label="Sections">
        ${m.sections.map((s) =>
    `<a href="#${escapeHtml(s.id)}">${escapeHtml(s.title)}</a>`).join('\n        ')}
        <a href="#other">Other roles</a>
      </nav>
    </header>

${sectionsHtml}

    <section class="block" id="other">
      <header>
        <h2>Other live roles</h2>
        <p>Additional Discord roles present on the server (excluding bots/managed integrations and names already covered above). Useful as a full inventory — not all are part of the promotion path.</p>
      </header>
      <table>
        <thead><tr><th>Role</th><th>Holders</th></tr></thead>
        <tbody>
${otherRows || '<tr><td colspan="2">No additional roles.</td></tr>'}
        </tbody>
      </table>
    </section>

    <p class="footnote">
      Regenerated from the local GoonCitizen API
      (<code>GET /services/star-citizen/discord/guilds/${escapeHtml(m.guildId)}/roles</code>)
      and the PERMAFLEET ladder in <code>goon.vc/contracts/roles.dot</code>.
      Run <code>npm run discord:roles-guide</code> to refresh.
    </p>
  </main>
</body>
</html>
`;
}

module.exports = {
  DEFAULT_GUILD_ID,
  DEFAULT_GUILD_NAME,
  INK,
  SECTIONS,
  LADDER_STEPS,
  escapeHtml,
  indexRoles,
  resolveRole,
  holdersFor,
  uncategorizedRoles,
  buildGuideModel,
  renderRolesGuideHtml
};
