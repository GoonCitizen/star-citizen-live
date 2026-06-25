'use strict';
// SVG flowchart definitions for the solution brief. Clean, flat, print-friendly.

const FONT = 'Arial, Helvetica, sans-serif';
const PAL = {
  done:    { fill: '#e7f4ec', stroke: '#2e7d52', text: '#1f5237', sub: '#3f6b53' },
  plan:    { fill: '#e8f0f9', stroke: '#2f6db0', text: '#1d4a7a', sub: '#3f648a' },
  future:  { fill: '#eef0f2', stroke: '#8b94a0', text: '#3b434f', sub: '#5b6472' },
  discord: { fill: '#ebedfd', stroke: '#5865F2', text: '#2f3aa6', sub: '#4b54b8' },
  warn:    { fill: '#fbf1e0', stroke: '#c98a23', text: '#8a5d10', sub: '#9a6f24' },
  ink:     { fill: '#1a2230', stroke: '#1a2230', text: '#1a2230', sub: '#5b6472' }
};
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function rect (x, y, w, h, p, dash) {
  return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="10" fill="${p.fill}" stroke="${p.stroke}" stroke-width="1.6"${dash ? ' stroke-dasharray="7 5"' : ''}/>`;
}
function node (x, y, w, h, title, subs, pal, dash) {
  const p = PAL[pal];
  subs = subs || [];
  const titleY = subs.length ? y + 26 : y + h / 2 + 5;
  let t = `<text x="${x + w / 2}" y="${titleY}" text-anchor="middle" font-family="${FONT}" font-size="15" font-weight="700" fill="${p.text}">${esc(title)}</text>`;
  subs.forEach((s, i) => { t += `<text x="${x + w / 2}" y="${y + 46 + i * 15}" text-anchor="middle" font-family="${FONT}" font-size="11.5" fill="${p.sub}">${esc(s)}</text>`; });
  return rect(x, y, w, h, p, dash) + t;
}
function label (x, y, text, size, color, weight, anchor) {
  return `<text x="${x}" y="${y}" text-anchor="${anchor || 'middle'}" font-family="${FONT}" font-size="${size || 12}" font-weight="${weight || 400}" fill="${color || '#5b6472'}">${esc(text)}</text>`;
}
function arrow (x1, y1, x2, y2, text) {
  let s = `<path d="M${x1},${y1} L${x2},${y2}" fill="none" stroke="#9099a6" stroke-width="2" marker-end="url(#ah)"/>`;
  if (text) { const mx = (x1 + x2) / 2, my = (y1 + y2) / 2; s += `<rect x="${mx - text.length * 3.4 - 6}" y="${my - 18}" width="${text.length * 6.8 + 12}" height="16" rx="4" fill="#ffffff" opacity="0.95"/>` + label(mx, my - 6, text, 11, '#41607e', 600); }
  return s;
}
function svg (w, h, body) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">`
    + `<defs><marker id="ah" markerWidth="10" markerHeight="10" refX="7" refY="4.5" orient="auto"><path d="M0,0 L8,4.5 L0,9 Z" fill="#9099a6"/></marker></defs>`
    + `<rect width="${w}" height="${h}" fill="#ffffff"/>` + body + '</svg>';
}

// ---- Fig 1: architecture ----
function figArchitecture () {
  let b = '';
  b += label(160, 30, "Each member's PC", 13, '#3b434f', 700);
  b += label(500, 30, 'Cloud — one small server (VPS)', 13, '#3b434f', 700);
  b += label(860, 30, 'Discord', 13, '#3b434f', 700);
  b += node(40, 70, 240, 90, 'Local Relay', ['watches Game.log (read-only)', 'one per member'], 'done');
  b += label(160, 185, 'the game log only exists here', 11, '#9a6f24', 600);
  b += node(360, 55, 280, 60, 'Mission Register', ['create / apply / assign / validate'], 'plan');
  b += node(360, 125, 280, 50, 'Live Activity Feed', ['sessions · missions · combat proxy'], 'plan');
  b += node(360, 185, 280, 50, 'Audit Trail', ['tamper-evident record'], 'plan');
  b += node(720, 70, 240, 60, 'Discord bot + webhook', ['commands in · posts out'], 'discord');
  b += node(720, 150, 240, 60, 'Members & Officers', ['use Discord as the front door'], 'discord');
  b += arrow(280, 115, 360, 95, 'activity / evidence');
  b += arrow(640, 100, 720, 100, 'posts / commands');
  b += arrow(840, 130, 840, 150, '');
  return svg(1000, 250, b);
}

// ---- Fig 2: mission lifecycle ----
function figLifecycle () {
  let b = '';
  const y = 90;
  b += node(20, y, 120, 60, 'OPEN', ['officer posts'], 'plan');
  b += node(220, y, 140, 60, 'APPLICATIONS', ['members apply'], 'plan');
  b += node(440, y, 130, 60, 'ASSIGNED', ['officer accepts'], 'plan');
  b += node(650, y, 120, 60, 'CLAIM', ['assignee: done'], 'plan');
  b += node(850, y, 130, 60, 'COMPLETED', ['officer validates ✓'], 'done');
  b += arrow(140, y + 30, 220, y + 30, 'apply');
  b += arrow(360, y + 30, 440, y + 30, 'accept');
  b += arrow(570, y + 30, 650, y + 30, 'claim');
  b += arrow(770, y + 30, 850, y + 30, 'validate');
  // reject loop
  b += `<path d="M910,${y} C910,30 650,30 715,${y - 2}" fill="none" stroke="#c98a23" stroke-width="1.8" stroke-dasharray="6 4" marker-end="url(#ah)"/>`;
  b += label(800, 40, 'validate ✗ → back to assigned', 11, '#9a6f24', 600);
  // cancel
  b += node(440, 200, 130, 50, 'CANCELLED', [], 'future');
  b += arrow(505, y + 60, 505, 200, 'officer cancel');
  b += label(500, 285, 'Every step is written to the tamper-evident audit trail.', 12, '#5b6472', 600);
  return svg(1000, 300, b);
}

// ---- Fig 3: Discord events hook ----
function figEvents () {
  let b = '';
  b += node(40, 40, 180, 56, 'Officer', ['plans an op'], 'discord');
  b += node(300, 40, 220, 56, 'Discord Event', ['name · time · channel'], 'discord');
  b += arrow(220, 68, 300, 68, 'creates');
  b += node(300, 140, 220, 50, 'Members', ['click "Interested"'], 'discord');
  b += arrow(410, 96, 410, 140, '');
  // three signals
  b += node(620, 30, 330, 56, 'INTERESTED', ['who said yes — read from Discord'], 'done');
  b += node(620, 100, 330, 56, 'TURNED UP', ['relay active during the event window'], 'plan');
  b += node(620, 170, 330, 56, 'ACTIVITY', ['objectives / combat progress in-window'], 'plan');
  b += arrow(520, 68, 620, 58, '');
  b += arrow(520, 165, 620, 128, 'relay');
  b += arrow(520, 165, 620, 198, '');
  b += node(300, 250, 480, 56, 'Operation summary posted to Discord', ['e.g. "8 interested · 5 present · 12 objectives advanced"'], 'discord');
  b += arrow(785, 198, 720, 250, '');
  b += label(500, 300, 'Needs: each relay linked to a Discord ID (one-time) to name who did what.', 11, '#9a6f24', 600);
  return svg(1000, 330, b);
}

// ---- Fig 4: decentralized / federated ----
function figDecentralized () {
  let b = '';
  b += node(380, 30, 240, 54, 'Discord (bridge)', ['still the human front door'], 'discord');
  b += node(70, 150, 200, 80, 'Member Node A', ['watches own Game.log', 'signs + gossips events'], 'future');
  b += node(400, 150, 200, 80, 'VPS Node', ['one node, not the', 'only source of truth'], 'future');
  b += node(730, 150, 200, 80, 'Member Node C', ['watches own Game.log', 'signs + gossips events'], 'future');
  b += arrow(270, 190, 400, 190, 'signed');
  b += arrow(600, 190, 730, 190, 'signed');
  b += `<path d="M170,150 C170,90 480,90 480,84" fill="none" stroke="#9099a6" stroke-width="2" marker-end="url(#ah)"/>`;
  b += `<path d="M830,150 C830,90 520,90 520,84" fill="none" stroke="#9099a6" stroke-width="2" marker-end="url(#ah)"/>`;
  b += label(500, 270, 'If any one node (even the VPS) goes down, the others carry on.', 12, '#5b6472', 600);
  b += label(500, 292, 'Optional, later — only if the org wants no single point of failure.', 11, '#9a6f24', 600);
  return svg(1000, 320, b);
}

// ---- Fig 5: packaging + virus scan ----
function figPackaging () {
  let b = '';
  const y = 60, w = 150, h = 70, gap = 20;
  const steps = [
    ['Source code', ['open on GitHub'], 'done'],
    ['Build binaries', ['Windows .exe + Linux'], 'plan'],
    ['Sign', ['Authenticode + GPG'], 'plan'],
    ['Scan + checksum', ['VirusTotal · SHA-256'], 'plan'],
    ['Publish', ['GitHub Releases'], 'plan'],
    ['Member runs', ['Windows or Linux'], 'done']
  ];
  let x = 20;
  steps.forEach((s, i) => {
    b += node(x, y, w, h, s[0], s[1], s[2]);
    if (i < steps.length - 1) b += arrow(x + w, y + h / 2, x + w + gap, y + h / 2, '');
    x += w + gap;
  });
  b += label(500, 175, 'Cross-platform: a Windows .exe and a Linux installer; the VPS service installs as a Linux systemd service.', 11.5, '#5b6472', 600);
  b += label(500, 195, 'Signing + VirusTotal + checksums establish trust on both platforms.', 11.5, '#5b6472', 600);
  return svg(1040, 220, b);
}

// ---- Fig 6: future web UI (placeholder) ----
function figWebUI () {
  let b = '';
  b += `<rect x="10" y="10" width="980" height="40" rx="8" fill="#fbf1e0" stroke="#c98a23" stroke-width="1.4" stroke-dasharray="7 5"/>`;
  b += label(500, 36, 'FUTURE / PLACEHOLDER — optional web front end on the VPS, gated by Discord roles', 13, '#8a5d10', 700);
  b += node(60, 90, 200, 60, 'Member browser', ['opens the web app'], 'future', true);
  b += node(330, 90, 200, 60, 'Login with Discord', ['OAuth2 — no new password'], 'discord', true);
  b += node(600, 90, 200, 60, 'Check Discord role', ['officer? member?'], 'future', true);
  b += arrow(260, 120, 330, 120, '');
  b += arrow(530, 120, 600, 120, '');
  b += node(560, 200, 200, 70, 'Officer view', ['validate queue · metrics'], 'plan', true);
  b += node(820, 200, 160, 70, 'Member view', ['missions · my activity'], 'plan', true);
  b += arrow(700, 150, 660, 200, 'officer');
  b += arrow(700, 150, 880, 200, 'member');
  b += label(500, 235, 'Discord roles decide what each person sees — no separate accounts to manage.', 11.5, '#5b6472', 600);
  return svg(1000, 290, b);
}

module.exports = {
  figs: [
    { name: 'architecture', svg: figArchitecture(), w: 1000, h: 250 },
    { name: 'lifecycle', svg: figLifecycle(), w: 1000, h: 300 },
    { name: 'events', svg: figEvents(), w: 1000, h: 330 },
    { name: 'webui', svg: figWebUI(), w: 1000, h: 290 },
    { name: 'packaging', svg: figPackaging(), w: 1040, h: 220 },
    { name: 'decentralized', svg: figDecentralized(), w: 1000, h: 320 }
  ]
};
