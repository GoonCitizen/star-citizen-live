'use strict';
const fs = require('fs');
const { Resvg } = require('@resvg/resvg-js');
const { figs } = require('./diagrams');
const {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell, ImageRun,
  Footer, AlignmentType, LevelFormat, HeadingLevel, BorderStyle, WidthType,
  ShadingType, PageNumber, PageBreak, ExternalHyperlink
} = require('docx');

// ---- render diagrams to PNG (in memory) ----
const png = {};
const dim = {};
for (const f of figs) {
  png[f.name] = new Resvg(f.svg, { fitTo: { mode: 'width', value: f.w * 2 }, font: { loadSystemFonts: true } }).render().asPng();
  dim[f.name] = { w: f.w, h: f.h };
}

const CW = 9360;                       // content width (US Letter, 1" margins) in DXA
const IMGW = 624;                      // image display width in px (6.5in)
const C = { blue: '1d4a7a', green: '1f5237', amber: '8a5d10', ink: '1a2230', grey: '5b6472', rule: '2f6db0' };

// ---- helpers ----
const H1 = (t) => new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun(t)] });
const H2 = (t) => new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun(t)] });
const H3 = (t) => new Paragraph({ heading: HeadingLevel.HEADING_3, children: [new TextRun(t)] });
function P (runs, opts) {
  const children = (typeof runs === 'string') ? [new TextRun(runs)] : runs;
  return new Paragraph(Object.assign({ spacing: { after: 120, line: 276 }, children }, opts || {}));
}
const T = (t, o) => new TextRun(Object.assign({ text: t }, o || {}));
const bold = (t) => new TextRun({ text: t, bold: true });
function bullet (runs, level) {
  const children = (typeof runs === 'string') ? [new TextRun(runs)] : runs;
  return new Paragraph({ numbering: { reference: 'b', level: level || 0 }, spacing: { after: 60 }, children });
}
function num (runs) {
  const children = (typeof runs === 'string') ? [new TextRun(runs)] : runs;
  return new Paragraph({ numbering: { reference: 'n', level: 0 }, spacing: { after: 60 }, children });
}
function fig (name, caption) {
  const d = dim[name];
  const h = Math.round(IMGW * d.h / d.w);
  return [
    new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 120, after: 40 }, children: [
      new ImageRun({ type: 'png', data: png[name], transformation: { width: IMGW, height: h }, altText: { title: caption, description: caption, name } })
    ] }),
    new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 160 }, children: [new TextRun({ text: caption, italics: true, size: 19, color: C.grey })] })
  ];
}
const border = { style: BorderStyle.SINGLE, size: 1, color: 'CCCCCC' };
const borders = { top: border, bottom: border, left: border, right: border, insideHorizontal: border, insideVertical: border };
function cell (text, w, opts) {
  opts = opts || {};
  const runs = Array.isArray(text) ? text : [new TextRun({ text: String(text), bold: !!opts.bold, color: opts.color || (opts.head ? 'FFFFFF' : C.ink), size: 19 })];
  return new TableCell({
    width: { size: w, type: WidthType.DXA },
    shading: { fill: opts.head ? C.rule : (opts.fill || 'FFFFFF'), type: ShadingType.CLEAR },
    margins: { top: 60, bottom: 60, left: 110, right: 110 },
    children: [new Paragraph({ children: runs })]
  });
}
function table (headers, rows, widths) {
  const trs = [new TableRow({ tableHeader: true, children: headers.map((h, i) => cell(h, widths[i], { head: true, bold: true })) })];
  for (const r of rows) trs.push(new TableRow({ children: r.map((c, i) => cell(c, widths[i], typeof c === 'object' && !Array.isArray(c) ? c : {})) }));
  return new Table({ width: { size: CW, type: WidthType.DXA }, columnWidths: widths, borders, rows: trs });
}
const rule = () => new Paragraph({ border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: C.rule, space: 1 } }, spacing: { after: 120 } });
const space = (a) => new Paragraph({ spacing: { after: a || 80 }, children: [] });

// ---- document body ----
const body = [];
// Title block
body.push(new Paragraph({ spacing: { after: 40 }, children: [new TextRun({ text: 'Permafleet Mission Platform', bold: true, size: 48, color: C.blue, font: 'Arial' })] }));
body.push(new Paragraph({ spacing: { after: 40 }, children: [new TextRun({ text: 'Solution Brief', size: 32, color: C.ink })] }));
body.push(new Paragraph({ spacing: { after: 200 }, children: [new TextRun({ text: 'A live Star Citizen activity relay + an officer-validated mission register for the org. Prepared 13 June 2026 · Status: working prototype, expanding.', italics: true, size: 20, color: C.grey })] }));
body.push(rule());

// Contents
body.push(H2('Contents'));
['Origin & original requirements (from the master)', 'How this fork has deviated (and why)',
 'Executive summary', '1. What this is', '2. Where we are now', '3. What users can do', '4. The mission register & lifecycle',
 '5. The Discord Events hook', '6. Making a busy feed useful — filters, grouping, metrics', '7. Future web UI (Discord-role-gated)',
 '8. Packaging & distribution (.exe) and virus-scan trust', '9. Future option — decentralized deployment',
 '10. External dependencies & indicative costs', '11. Roadmap', '12. Decisions for the product owner', '13. Honest limitations'].forEach((s) => body.push(bullet(s)));
body.push(new Paragraph({ children: [new PageBreak()] }));

// Origin & original requirements
body.push(H1('Origin & original requirements (from the master)'));
body.push(P([T('This project originates from the master repository established under the org’s direction (upstream: GoonCitizen/star-citizen-live; fork basis: martindale/star-citizen-live, branch feature/fabric-0.1.0; package @rsi/star-citizen; MIT licence). The work in this fork (Neorion/star-citizen-live, branch feature/fabric-free-m1) continues that project. This section records the requirements as defined in the master so that the subsequent changes can be read against them.')]));
body.push(P([bold('Requirements as defined in the master:')]));
[
  'Watch the Star Citizen Game.log live, read-only.',
  'Relay events to a Discord channel as rich embeds (activities, kills, player joins, missions, applications).',
  'Expose a REST API (port 3041) with collections: activities, players, vehicles, kills, messages/logs, missions, applications, status.',
  'Detect specific in-game events from the log (e.g. kills, player joins, vehicle destruction).',
  'Provide a missions/contracts system: members post missions (bounty / cargo / exploration) with UEC rewards; others apply; contracts cryptographically signed — single-signer or multisig (secp256k1 / musig2).',
  'Run on the Fabric framework as a decentralized peer-to-peer service (signed, content-addressed objects), extending a Fabric Hub.',
  'Provide a web user interface (React / server-rendered Semantic UI).'
].forEach((t) => body.push(num(t)));

// Deviations
body.push(H1('How this fork has deviated (and why)'));
body.push(P([T('The fork pursues the same goals. The changes below were made for the technical reasons stated; each is recorded in '), bold('DECISIONS.md (D-001…D-005)'), T(' and '), bold('PROGRESS.md'), T('.')]));
body.push(table(
  ['Area', 'Master (original)', 'This fork', 'Reason'],
  [
    ['Framework', 'Fabric (p2p), extends Hub', 'Standard Node.js built-ins (http, events, crypto)', 'Fabric ~400 MB incl. a headless browser; deps installed over SSH GitHub URLs that failed on clean machines; a core package absent from the dependency list; install never completed in a clean environment (D-002).'],
    ['Hosting / trust', 'Trustless p2p network', 'One central service on a VPS; Discord for identity', 'The required functions (watch log, post to Discord, share contracts) do not require p2p; the org has a defined authority (D-003).'],
    ['Mission contracts', 'Crypto single/multisig contracts', 'Central register with officer validation; crypto/multisig deferred (seam + types/Mission.js retained)', 'A player’s log is self-reported and cannot prove completion; an officer validates (D-005).'],
    ['Kill detection', '“Kills announced to Discord”', 'Mission/objective tracking + combat-objective proxy', 'SC 4.8.0 client log records no kills or ship destruction (verified against real logs) (M3, M3.5).'],
    ['Install footprint', '~400 MB Fabric dependency tree', 'Zero runtime dependencies', 'Removing Fabric eliminated the dependency tree (M2, M3.7).'],
    ['Web UI', 'React / Semantic UI shell', 'Built-in HTML dashboard; Discord-role-gated web UI planned', 'Rebuilt without the Fabric/React stack.'],
    ['Decentralization', 'Core requirement (Fabric)', 'Optional future federation via signed gossip (not the Fabric framework)', 'Retained as an opt-in path, decoupled from the fragile transport (D-004).']
  ],
  [1500, 2500, 2680, 2680]
));
body.push(new Paragraph({ children: [new PageBreak()] }));

// Executive summary
body.push(H1('Executive summary'));
body.push(P([T('The system has two parts: a '), bold('live activity relay'), T(' that each member runs locally to read the Star Citizen game log, and a '), bold('central mission register'), T(' where officers post missions and fleet actions, members apply, and '), bold('officers validate'), T(' on completion. All state changes are written to a tamper-evident audit log. '), bold('Discord is the primary interface.')]));
body.push(P([T('Testing across '), bold('193 logs from two players (builds 4.7.0–4.8.0)'), T(' established that the game records only the kills that '), bold('involve the running player'), T(' (your kills and your deaths) — not third-party kills. Our parser was '), bold('verified on 417 real kills'), T(' from a member’s logs — but only in SC ≤ 4.3.0; '), bold('CIG removed kill logging after 4.3.0'), T(', so it is not available in the current game (confirmed across ~290 later files from three players). '), bold('Player-downs (incapacitation)'), T(' are also detected. A player’s own log is self-reported, so the register uses '), bold('officer validation'), T(' as the authority for completion, with log activity attached as supporting evidence. The same model applies to '), bold('out-of-game missions and fleet actions'), T(', which have no log signal.')]));
body.push(P([T('Current status: the live relay and dashboard are built and tested; the mission register engine is built and verified end-to-end. Remaining work: a web API and a Discord bot to operate the register, and hosting on an always-on server. A planned integration uses '), bold('Discord Scheduled Events'), T(' to capture interest, attendance and in-window activity.')]));
body.push(P([T('A '), bold('federated deployment'), T(' — members’ machines exchanging signed updates with no single point of failure — is retained as an optional future path (D-004), separate from the original Fabric framework. It is not required for the current scope.')]));

// 1. What this is
body.push(H1('1. What this is'));
body.push(P([T('Think of it as two halves that work together but are kept separate: a '), bold('Live Relay'), T(' on each member’s PC (the only place the game log exists), and a '), bold('Central Service'), T(' in the cloud that holds the shared mission register, the activity feed, and the audit trail. '), bold('Discord is the front door'), T(' everyone already uses.')]));
body.push(...fig('architecture', 'Figure 1 — How the pieces fit together.'));

// 2. Where we are now
body.push(H1('2. Where we are now'));
body.push(P('An honest snapshot of what a user can actually do today versus what is planned:'));
body.push(table(
  ['Capability', 'Status'],
  [
    ['Live dashboard — sessions, players, missions (from the log), combat-objective progress, notifications', { bold: false, fill: 'E7F4EC' }].length ? ['Live dashboard — sessions, players, missions, combat-progress, notifications', 'Built & tested'] : [],
    ['Auto-detect game install & channel (LIVE / PTU / HOTFIX), survive restarts', 'Built & tested'],
    ['Group missions by mission, with objectives nested', 'Built & tested'],
    ['Mission-type classification (Bounty / Mercenary / Mining / …)', 'Built & tested'],
    ['Player-down (incapacitation) detection', 'Built & tested'],
    ['Regression testing against real player-log corpus', 'Built & tested'],
    ['Live activity posted to Discord (one-way webhook)', 'Working once connected'],
    ['Mission register engine — create / apply / assign / claim / officer-validate + audit', 'Built (engine), proven end-to-end'],
    ['Mission register over a web API', 'Next (M5.2)'],
    ['Mission register inside Discord (slash commands + Events hook)', 'Planned (M5.3)'],
    ['Always-on cloud hosting', 'Planned (M4)'],
    ['Kill detection (your kills/deaths) — historical logs only', 'Parser verified on 417 real kills (SC ≤ 4.3.0); CIG removed kill logging after 4.3.0 — not in current builds'],
    ['Detecting third-party kills (others’ fights)', 'Not possible — the game stopped logging them in 4.0.2'],
    ['Decentralized / no-central-server', 'Optional, later']
  ].filter((r) => r.length),
  [6600, 2760]
));

// 3. What users can do
body.push(H1('3. What users can do'));
body.push(H3('Member'));
['Browse missions and fleet actions (reward, requirements, deadline).', 'Apply from Discord; get assigned when an officer accepts.', 'Mark a mission complete and (optionally) attach evidence the relay captured.', 'See their own participation history.'].forEach((t) => body.push(bullet(t)));
body.push(H3('Officer / administrator'));
['Post missions and fleet actions — including out-of-game ones the game cannot see.', 'Accept or reject applications.', 'Validate completions — the core authority step that approves the reward.', 'Manage who is an officer via a Discord role.', 'See a tamper-evident audit trail of who created, applied to and approved everything.'].forEach((t) => body.push(bullet(t)));

// 4. lifecycle
body.push(H1('4. The mission register & lifecycle'));
body.push(P([T('Every mission moves through an auditable lifecycle. The '), bold('officer validation'), T(' step is the authority for completion: because the log cannot prove completion, an officer confirms it.')]));
body.push(...fig('lifecycle', 'Figure 2 — Mission lifecycle, from posting to officer-validated completion.'));

// 5. Discord events
body.push(H1('5. The Discord Events hook'));
body.push(P([T('Officers already create '), bold('Discord Scheduled Events'), T(' and members already click “Interested.” We can build on that instead of inventing a new workflow. Discord’s API lets us read the interested list; the relay supplies who actually turned up and what they did during the event window.')]));
body.push(...fig('events', 'Figure 3 — Using Discord Events to capture interest, attendance and activity.'));
body.push(P([T('This produces a participation record per event — interested, turned-up and in-window activity — from a workflow already in use. The prerequisite is a one-time link between each member’s relay and their Discord identity so activity can be attributed to the correct person.')]));

// 6. filters / grouping / metrics
body.push(H1('6. Making a busy feed useful — filters, grouping, metrics'));
body.push(P('At fleet scale the feed is high-volume. Three controls reduce it:'));
body.push(H3('Filter by mission type or operation'));
body.push(P('In-game mission types (Bounty, Mercenary/Defense, Hauling, Recovery, Mining, FPS/Facility, and others) are classified from the log’s mission generator/template names — built and validated against a 193-log corpus. Org “operations” (e.g. “Tactical Strike Group” — a real announced Star Citizen feature) are officer-named labels that in-game activity rolls up under.'));
body.push(H3('Group, don’t spam'));
['Group by mission (one card per mission, not per line).', 'Roll up to operation level (one card per op).', 'Edit a single message as it progresses, or use one thread per operation.', 'Optional periodic digest instead of live events.'].forEach((t) => body.push(bullet(t)));
body.push(H3('Metrics — what the log allows'));
body.push(P([T('Register data is validated by officers; log-derived data is inferred and labelled as such. Measures:')]));
body.push(table(
  ['Metric', 'Source', 'Confidence'],
  [
    ['Operation participation (distinct members active)', 'relays', 'inferred'],
    ['Active-player-minutes per operation', 'relays', 'inferred'],
    ['Objectives advanced / combat-progress per op', 'relays', 'inferred (proxy)'],
    ['Player-downs (incapacitations) per session / op', 'relays', 'inferred'],
    ['Missions completed per week; completion rate', 'register', 'validated'],
    ['Average time-to-complete / time-to-validate', 'register', 'validated'],
    ['Interest → turn-up conversion; no-show rate', 'Discord + relays', 'mixed'],
    ['Member leaderboard (participation, not kills)', 'register', 'validated']
  ],
  [5200, 2080, 2080]
));

// 7. future web UI
body.push(H1('7. Future web UI (Discord-role-gated)'));
body.push(P([T('Discord remains the primary interface. A '), bold('web front end on the VPS'), T(' is a planned future addition (e.g. a validation queue and metrics dashboards). Members '), bold('log in with Discord'), T(' (no separate accounts) and their '), bold('Discord roles determine what they see'), T(' — officers get the admin views, members get their own. This is a placeholder for planning; not yet built.')]));
body.push(...fig('webui', 'Figure 4 — Placeholder concept: a VPS web front end gated by Discord roles.'));

// 8. packaging
body.push(H1('8. Packaging & distribution (Windows & Linux) and virus-scan trust'));
body.push(P([T('For non-technical members the relay should be a '), bold('single download that just runs'), T(' — no Node.js install, no terminal. We need '), bold('both a Windows and a Linux'), T(' build: many members play on Windows, a growing number play via Proton/Wine on Linux, and the central service itself runs on a Linux server.')]));
body.push(...fig('packaging', 'Figure 5 — From source code to a trusted, cross-platform install (Windows & Linux).'));
body.push(H3('Packaging — three targets'));
body.push(table(
  ['Target', 'What we ship', 'How it runs'],
  [
    ['Windows relay', 'A single .exe (Node.js Single Executable App; alt: pkg/nexe)', 'Double-click; optional auto-start as a background task'],
    ['Linux relay', 'A self-contained binary + install script (tarball; optionally .deb / AppImage)', 'One-line install; optional auto-start as a systemd user service'],
    ['Server (VPS)', 'The central service installed as a Linux systemd service', 'Runs always-on; survives reboots']
  ],
  [1900, 4560, 2900]
));
['First-run setup writes a tiny config (member’s Discord ID, the server address) on either OS.', 'The relay auto-detects the game log: Windows drive paths today; the Linux build adds Proton/Wine prefix detection (e.g. under the Steam/Lutris compat folder).'].forEach((t) => body.push(bullet(t)));
body.push(H3('Virus-scan & trust'));
body.push(P('Windows: bundled-Node executables from an unknown publisher commonly trigger SmartScreen warnings and occasional antivirus false positives. Linux: no SmartScreen, but we still want verifiable, signed downloads. The trust stack covers both:'));
[
  [bold('Signing'), T(' — Windows: an Authenticode (ideally EV) certificate earns instant SmartScreen reputation — the real fix for “unknown publisher” (~$200–600/yr). Linux: GPG-sign the binaries (and, for a .deb, a GPG-signed apt repo) — free.')],
  [bold('VirusTotal'), T(' — upload each release (free, ~70 engines) and publish the report link so members can verify, on both platforms.')],
  [bold('GitHub Releases + SHA-256 checksums'), T(' — members confirm the file is unmodified; the build is auditable because the source is open.')],
  [bold('False-positive submission'), T(' — if Microsoft Defender (or a Linux AV) flags a release, submit it for review to clear it.')]
].forEach((r) => body.push(bullet(r)));
body.push(P([bold('Honest note: '), T('false positives are normal for this kind of executable; the combination of signing + VirusTotal + checksums + open source is how we establish trust, not a single silver bullet.')]));

// 9. decentralized
body.push(H1('9. Future option — decentralized deployment'));
body.push(P([T('The current plan uses one central server the org runs. The architecture also supports a '), bold('federated'), T(' version: members’ own machines exchange '), bold('signed'), T(' updates so there is no single point of failure, with the cloud server becoming one node among several and Discord still the front door.')]));
body.push(...fig('decentralized', 'Figure 6 — Optional future: a federated network with no single point of failure.'));
body.push(P([bold('Status: '), T('optional and deferred. The cryptographic building blocks already exist in the codebase (types/Mission.js). It is a sizeable effort and is not required for the current scope. It is revisited only if removing reliance on the single server becomes a requirement, or to federate across multiple orgs (D-004).')]));

// 10. dependencies
body.push(H1('10. External dependencies & indicative costs'));
body.push(table(
  ['Dependency', 'What it’s for', 'Cost / effort'],
  [
    ['Small cloud server (VPS)', 'Hosts the always-on register & feed', '~$5–10 / month'],
    ['Discord bot', 'Two-way commands & the Events hook (a webhook can only post out)', 'Free; ~30 min setup'],
    ['Discord server + Officer role', 'Identity and who-can-validate', 'Free; your existing server'],
    ['Each member runs the relay', 'Reads their local game log (Windows or Linux)', 'Free; small download'],
    ['Code-signing certificate', 'Trusted Windows .exe (no SmartScreen); Linux uses free GPG', '~$200–600 / yr (Windows, optional)'],
    ['Domain name', 'Friendly web address (web UI)', '~$10–15 / year (optional)']
  ],
  [2500, 4360, 2500]
));
body.push(P([bold('Deliberately not needed: '), T('no blockchain, no cryptocurrency, no paid database, no app-store apps.')]));

// 11. roadmap
body.push(H1('11. Roadmap'));
[
  [bold('M4 — Stand up the cloud server'), T(' (a home for the register). Needs: hosting choice/budget.')],
  [bold('M5 — Mission register'), T(': API (M5.2) then Discord bot + Events hook (M5.3). Needs: create the Discord bot, define the Officer role.')],
  [bold('M6 — Officer roles + signed audit trail'), T(' (cryptographically signed validations).')],
  [bold('Ongoing — improve what the relay recognises'), T(' (never blocks the register).')],
  [bold('Later / optional — web UI and/or decentralization'), T('.')]
].forEach((r) => body.push(num(r)));

// 12. decisions
body.push(H1('12. Decisions for the product owner'));
['Hosting provider and monthly budget.', 'Approve creating the Discord bot; choose which role = Officer.', 'Live-feed channel: public or private.', 'Confirm rewards are informational only (no real money / no blockchain).', 'Whether to buy a code-signing certificate for the .exe (improves member trust).'].forEach((t) => body.push(num(t)));

// 13. limitations
body.push(H1('13. Honest limitations'));
['Kill logging was removed by CIG after SC 4.3.0. Our parser is verified on 417 real kills from ≤4.3.0 logs, but the current game (4.8.0) logs no kills at all — confirmed across ~290 later files from three players (combat happened, no kill lines). Player-down (incapacitation) IS still detected in current builds.', 'In-game “activity” is only visible for members who run the relay.', 'Activity attribution needs a one-time link between a member’s relay and their Discord ID.', 'Cross-player correlation of a shared mission is by type + operation + time window, unless the game exposes a shared id (to be confirmed against a real capture).', 'A player’s own log is self-reported — which is exactly why officer validation is the authority.'].forEach((t) => body.push(bullet(t)));
body.push(space(120));
body.push(P([new TextRun({ text: 'Prepared by the build team with Claude Code. Source and living technical docs (DESIGN-missions-mvp, DECISIONS, PROGRESS) are in the project repository.', italics: true, size: 18, color: C.grey })]));

// ---- assemble ----
const doc = new Document({
  styles: {
    default: { document: { run: { font: 'Arial', size: 22, color: '202020' } } },
    paragraphStyles: [
      { id: 'Heading1', name: 'Heading 1', basedOn: 'Normal', next: 'Normal', quickFormat: true, run: { size: 30, bold: true, color: C.blue, font: 'Arial' }, paragraph: { spacing: { before: 280, after: 140 }, outlineLevel: 0 } },
      { id: 'Heading2', name: 'Heading 2', basedOn: 'Normal', next: 'Normal', quickFormat: true, run: { size: 25, bold: true, color: C.ink, font: 'Arial' }, paragraph: { spacing: { before: 180, after: 100 }, outlineLevel: 1 } },
      { id: 'Heading3', name: 'Heading 3', basedOn: 'Normal', next: 'Normal', quickFormat: true, run: { size: 22, bold: true, color: C.rule, font: 'Arial' }, paragraph: { spacing: { before: 140, after: 60 }, outlineLevel: 2 } }
    ]
  },
  numbering: {
    config: [
      { reference: 'b', levels: [{ level: 0, format: LevelFormat.BULLET, text: '•', alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 540, hanging: 280 } } } }, { level: 1, format: LevelFormat.BULLET, text: '◦', alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 1080, hanging: 280 } } } }] },
      { reference: 'n', levels: [{ level: 0, format: LevelFormat.DECIMAL, text: '%1.', alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 540, hanging: 280 } } } }] }
    ]
  },
  sections: [{
    properties: { page: { size: { width: 12240, height: 15840 }, margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 } } },
    footers: { default: new Footer({ children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: 'Permafleet Mission Platform — Solution Brief    ·    Page ', size: 16, color: '9099A6' }), new TextRun({ children: [PageNumber.CURRENT], size: 16, color: '9099A6' })] })] }) },
    children: body
  }]
});

Packer.toBuffer(doc).then((buf) => {
  const out = 'C:/Users/Kev29/Claude/Projects/Star-citizen-live/Permafleet-Solution-Brief.docx';
  fs.writeFileSync(out, buf);
  console.log('WROTE', out, buf.length, 'bytes');
});
