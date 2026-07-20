'use strict';
const fs = require('fs');
const { Resvg } = require('@resvg/resvg-js');

const W = 1080, H = 1300;
const CY = '#36d3e6', CY2 = '#1b9fb4', AM = '#f3a92e', INK = '#eaf3fb', MUT = '#8ba2b8', PANEL = '#10203b', LINE = '#24405f';
const FONT = 'Arial, Helvetica, sans-serif';
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
function txt (x, y, s, o) {
  o = o || {};
  return `<text x="${x}" y="${y}" font-family="${FONT}" font-size="${o.size || 16}" font-weight="${o.w || 400}" fill="${o.fill || INK}" text-anchor="${o.a || 'start'}"${o.ls ? ` letter-spacing="${o.ls}"` : ''}${o.op ? ` opacity="${o.op}"` : ''}>${esc(s)}</text>`;
}

// deterministic starfield
function stars () {
  let seed = 1337; const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
  let s = '';
  for (let i = 0; i < 90; i++) {
    const x = Math.round(rnd() * W), y = Math.round(rnd() * H), r = (rnd() * 1.6 + 0.3).toFixed(2), o = (rnd() * 0.6 + 0.15).toFixed(2);
    s += `<circle cx="${x}" cy="${y}" r="${r}" fill="#cfe6ff" opacity="${o}"/>`;
  }
  return s;
}

// HUD corner brackets around a rect
function brackets (x, y, w, h, c, len) {
  len = len || 16; const sw = 2;
  const L = (px, py, dx, dy) => `<path d="M${px + dx * len},${py} L${px},${py} L${px},${py + dy * len}" fill="none" stroke="${c}" stroke-width="${sw}"/>`;
  return L(x, y, 1, 1) + L(x + w, y, -1, 1) + L(x, y + h, 1, -1) + L(x + w, y + h, -1, -1);
}

// Permafleet Protectorate emblem: hex shield + 4-point star
function emblem (cx, cy, s) {
  const hex = [];
  for (let i = 0; i < 6; i++) { const a = Math.PI / 180 * (60 * i - 90); hex.push(`${(cx + Math.cos(a) * s).toFixed(1)},${(cy + Math.sin(a) * s).toFixed(1)}`); }
  const star = (r1, r2) => { let p = ''; for (let i = 0; i < 8; i++) { const a = Math.PI / 180 * (45 * i - 90); const r = i % 2 ? r2 : r1; p += `${(cx + Math.cos(a) * r).toFixed(1)},${(cy + Math.sin(a) * r).toFixed(1)} `; } return p.trim(); };
  return `<polygon points="${hex.join(' ')}" fill="#0b1830" stroke="${CY}" stroke-width="3"/>`
    + `<polygon points="${hex.join(' ')}" fill="none" stroke="${CY2}" stroke-width="1" transform="translate(${cx} ${cy}) scale(0.8) translate(${-cx} ${-cy})"/>`
    + `<polygon points="${star(s * 0.6, s * 0.24)}" fill="${CY}"/>`
    + `<circle cx="${cx}" cy="${cy}" r="${s * 0.12}" fill="${AM}"/>`;
}

function tag (x, y, label) {
  return `<rect x="${x}" y="${y - 15}" width="${label.length * 9 + 26}" height="22" rx="3" fill="none" stroke="${CY2}"/>`
    + `<rect x="${x}" y="${y - 15}" width="6" height="22" fill="${CY}"/>`
    + txt(x + 16, y + 1, label, { size: 13, w: 700, fill: CY, ls: 2 });
}

let b = '';
// background
b += `<defs><linearGradient id="bg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#0a1426"/><stop offset="0.55" stop-color="#0b1830"/><stop offset="1" stop-color="#091324"/></linearGradient>`
  + `<radialGradient id="glow" cx="0.5" cy="0.5" r="0.5"><stop offset="0" stop-color="${CY}" stop-opacity="0.18"/><stop offset="1" stop-color="${CY}" stop-opacity="0"/></radialGradient></defs>`;
b += `<rect width="${W}" height="${H}" fill="url(#bg)"/>`;
b += stars();
b += `<ellipse cx="${W / 2}" cy="120" rx="640" ry="220" fill="url(#glow)"/>`;
b += brackets(20, 20, W - 40, H - 40, '#2a4straussbad', 0); // placeholder replaced below
b = b.replace('#2a4straussbad', LINE);

// ---- header ----
b += emblem(78, 96, 46);
b += txt(150, 78, 'PERMAFLEET', { size: 50, w: 800, ls: 4 });
b += txt(152, 120, 'PROTECTORATE', { size: 30, w: 700, fill: CY, ls: 8 });
b += txt(150, 152, 'DIGITAL FLEET OPERATIONS PLATFORM', { size: 15, w: 600, fill: MUT, ls: 3 });
b += `<rect x="1010" y="56" width="0" height="0"/>`;
b += `<rect x="828" y="58" width="200" height="58" rx="4" fill="${PANEL}" stroke="${LINE}"/>`;
b += txt(928, 84, 'RELEASE', { size: 12, w: 600, fill: MUT, a: 'middle', ls: 3 });
b += txt(928, 106, 'v0.1', { size: 22, w: 800, fill: AM, a: 'middle' });
b += `<line x1="40" y1="186" x2="1040" y2="186" stroke="${LINE}" stroke-width="1.5"/>`;

// ---- roadmap ----
b += tag(40, 232, 'MISSION ROADMAP');
b += txt(40, 268, 'From v0.1 today, releasing patch by patch toward Star Citizen 1.0 — and beyond.', { size: 17, fill: INK });
const ly = 372, lx0 = 75, lx1 = 1005;
b += `<line x1="${lx0}" y1="${ly}" x2="${lx1}" y2="${ly}" stroke="${LINE}" stroke-width="3"/>`;
b += `<line x1="${lx0}" y1="${ly}" x2="190" y2="${ly}" stroke="${CY}" stroke-width="3"/>`;
const ms = [
  { x: 110, v: 'v0.1', t: 'FOUNDATION', d: 'Live relay + mission core', now: true },
  { x: 290, v: 'v0.2', t: 'ALWAYS-ON', d: 'Hosted ops server' },
  { x: 470, v: 'v0.3', t: 'DISCORD OPS', d: 'Missions & events in Discord' },
  { x: 650, v: 'v0.4', t: 'FLEET INTEL', d: 'Metrics & web portal' },
  { x: 840, v: 'v1.0', t: 'FULL OPS', d: 'At Star Citizen 1.0', star: true },
  { x: 985, v: '∞', t: 'BEYOND', d: 'Expansion', beyond: true }
];
for (const m of ms) {
  const c = m.now ? CY : (m.star ? AM : (m.beyond ? MUT : '#3a5b7e'));
  if (m.now) b += `<circle cx="${m.x}" cy="${ly}" r="16" fill="${CY}" opacity="0.25"/>`;
  if (m.star) b += `<circle cx="${m.x}" cy="${ly}" r="16" fill="${AM}" opacity="0.2"/>`;
  b += `<circle cx="${m.x}" cy="${ly}" r="9" fill="#0b1830" stroke="${c}" stroke-width="3"/>`;
  if (m.now || m.star) b += `<circle cx="${m.x}" cy="${ly}" r="3.5" fill="${c}"/>`;
  b += txt(m.x, ly + 34, m.v, { size: m.beyond ? 22 : 18, w: 800, fill: c, a: 'middle' });
  b += txt(m.x, ly + 54, m.t, { size: 11.5, w: 700, fill: INK, a: 'middle', ls: 1 });
  // wrap desc to <= ~18 chars
  const words = m.d.split(' '); let line = '', lines = [];
  for (const w of words) { if ((line + ' ' + w).trim().length > 18) { lines.push(line.trim()); line = w; } else line += ' ' + w; }
  lines.push(line.trim());
  lines.forEach((ln, i) => { b += txt(m.x, ly + 72 + i * 15, ln, { size: 11, fill: MUT, a: 'middle' }); });
}
// YOU ARE HERE marker
b += `<path d="M110,${ly - 24} l-7,-12 l14,0 z" fill="${CY}"/>`;
b += `<rect x="58" y="${ly - 62}" width="104" height="24" rx="3" fill="${CY}"/>`;
b += txt(110, ly - 45, 'YOU ARE HERE', { size: 12, w: 800, fill: '#06202c', a: 'middle', ls: 1 });

// ---- what we're building ----
b += tag(40, 520, 'WHAT WE ARE BUILDING');
const cards = [
  { icon: '📡', t: 'Live Activity Relay', d: 'See the fleet in action — sessions, missions and combat progress, streamed live to Discord.' },
  { icon: '🛡️', t: 'Mission Register', d: 'Officers post ops, members apply, officers validate. Out-of-game fleet actions too.' },
  { icon: '🗓️', t: 'Discord Operations', d: 'Built on Discord Events — who is interested, who turned up, and what they did.' },
  { icon: '📊', t: 'Fleet Intelligence', d: 'Participation, turnout and engagement metrics to plan better operations.' }
];
const cw = 478, ch = 168, gx = 44, x0 = 40, cy0 = 548;
cards.forEach((card, i) => {
  const cx = x0 + (i % 2) * (cw + gx), cyy = cy0 + Math.floor(i / 2) * (ch + 26);
  b += `<rect x="${cx}" y="${cyy}" width="${cw}" height="${ch}" rx="8" fill="${PANEL}" stroke="${LINE}"/>`;
  b += brackets(cx, cyy, cw, ch, CY2, 14);
  b += `<rect x="${cx}" y="${cyy}" width="5" height="${ch}" fill="${CY}"/>`;
  b += txt(cx + 30, cyy + 56, card.icon, { size: 34 });
  b += txt(cx + 86, cyy + 50, card.t, { size: 23, w: 800 });
  // wrap desc
  const words = card.d.split(' '); let line = '', lines = [];
  for (const w of words) { if ((line + ' ' + w).trim().length > 46) { lines.push(line.trim()); line = w; } else line += ' ' + w; }
  lines.push(line.trim());
  lines.forEach((ln, j) => { b += txt(cx + 30, cyy + 92 + j * 23, ln, { size: 15.5, fill: MUT }); });
});

// ---- vision band ----
const vy = 928;
b += `<rect x="40" y="${vy}" width="1000" height="150" rx="8" fill="#0d1d36" stroke="${CY2}"/>`;
b += brackets(40, vy, 1000, 150, CY, 18);
b += tag(64, vy + 36, 'OUR DIGITAL AMBITION');
b += txt(64, vy + 78, 'This is v0.1 — the first patch of our digital fleet. Like Star Citizen itself, we begin in', { size: 17, fill: INK });
b += txt(64, vy + 102, 'alpha and build, release by release, toward 1.0 and beyond. Every op, every mission and', { size: 17, fill: INK });
b += txt(64, vy + 126, 'every member counts from day one. We are not waiting for the ‘verse to be finished — we', { size: 17, fill: INK });
b += txt(64, vy + 150, 'are building the tools to lead it.', { size: 17, fill: INK });

// ---- footer ----
const fy = 1118;
b += `<line x1="40" y1="${fy}" x2="1040" y2="${fy}" stroke="${LINE}" stroke-width="1.5"/>`;
b += emblem(70, fy + 60, 26);
b += txt(108, fy + 50, 'PERMAFLEET PROTECTORATE', { size: 17, w: 800, ls: 2 });
b += txt(108, fy + 74, 'Digital Operations Initiative', { size: 13, fill: MUT, ls: 1 });
b += txt(1040, fy + 46, 'v0.1 · codename “FIRST WATCH”', { size: 15, w: 700, fill: AM, a: 'end' });
b += txt(1040, fy + 70, 'VIGILANCE · UNITY · THE FLEET', { size: 12, w: 600, fill: MUT, a: 'end', ls: 2 });
b += txt(1040, fy + 92, 'Star Citizen — Permafleet Protectorate · 2026', { size: 11, fill: '#5e7794', a: 'end' });

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${b}</svg>`;
fs.writeFileSync('poster.svg', svg);
const png = new Resvg(svg, { fitTo: { mode: 'width', value: W * 2 }, font: { loadSystemFonts: true } }).render().asPng();
fs.writeFileSync('C:/Users/Kev29/Claude/Projects/Star-citizen-live/Permafleet-Protectorate-Vision.png', png);
console.log('WROTE Permafleet-Protectorate-Vision.png', png.length, 'bytes', W * 2 + 'x' + H * 2);
