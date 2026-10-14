'use strict';

/**
 * Activity heatmap helpers shared by the operator profile ("When you fly") and peer profiles.
 * Cells are { ym, d, h, n } — Monday-first weekday index (0–6), hour 0–23.
 */

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const ACCENT = '#3b82f6';
const GRAY = '#6e7681';

/**
 * Build heatcells from timestamped records (missions, sessions, deaths, …).
 * @param {Array<{ ts?: string, player?: string }>} events
 * @param {{ player?: string|null }} [opts]
 * @returns {{ ym: string, d: number, h: number, n: number }[]}
 */
function heatcellsFromEvents (events, opts = {}) {
  const player = opts.player ? String(opts.player) : null;
  const heat = Object.create(null);
  const list = Array.isArray(events) ? events : [];
  for (const ev of list) {
    if (!ev || !ev.ts) continue;
    if (player && ev.player && String(ev.player) !== player) continue;
    const t = Date.parse(ev.ts);
    if (Number.isNaN(t)) continue;
    const d = new Date(t);
    const ym = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
    const key = ym + '|' + ((d.getDay() + 6) % 7) + '|' + d.getHours();
    heat[key] = (heat[key] || 0) + 1;
  }
  return Object.keys(heat).map((k) => {
    const p = k.split('|');
    return { ym: p[0], d: +p[1], h: +p[2], n: heat[k] };
  });
}

/**
 * Collect heatcells from an analytics payload, optionally scoped to one pilot
 * or a keep() predicate (rebuild from local-origin rows for "My logs").
 * When `player` or `rebuild` is set, rebuild from event streams (aggregate heat
 * has no player / provenance).
 * @param {object|null} analytics
 * @param {{ player?: string|null, months?: Set<string>|null, rebuild?: boolean, keep?: function }} [opts]
 */
function resolveHeatcells (analytics, opts = {}) {
  const player = opts.player ? String(opts.player) : null;
  const rebuild = !!(player || opts.rebuild);
  let cells;
  if (rebuild && analytics) {
    let streams = [].concat(
      analytics.missions || [],
      analytics.sessions || [],
      analytics.deaths || [],
      analytics.quantum || [],
      analytics.incap || [],
      analytics.crimestat || []
    );
    if (typeof opts.keep === 'function') streams = streams.filter(opts.keep);
    cells = heatcellsFromEvents(streams, { player });
  } else {
    cells = Array.isArray(analytics && analytics.heatcells) ? analytics.heatcells.slice() : [];
  }
  if (opts.months && opts.months.size) {
    cells = cells.filter((c) => opts.months.has(c.ym));
  }
  return cells;
}

/**
 * Render SVG (or empty HTML) for a week×hour activity heatmap.
 * @param {{ ym: string, d: number, h: number, n: number }[]} heatcells
 * @param {{ accent?: string, gray?: string, emptyHtml?: string }} [opts]
 * @returns {string}
 */
function renderHeatSvg (heatcells, opts = {}) {
  const accent = opts.accent || ACCENT;
  const gray = opts.gray || GRAY;
  const H = Array.from({ length: 7 }, () => new Array(24).fill(0));
  let mx = 0;
  (heatcells || []).forEach((c) => {
    if (c && c.d >= 0 && c.d < 7 && c.h >= 0 && c.h < 24) {
      H[c.d][c.h] += c.n || 0;
    }
  });
  H.forEach((r) => r.forEach((v) => { if (v > mx) mx = v; }));
  if (!mx) {
    return opts.emptyHtml || '<div class="empty">no activity in range yet</div>';
  }
  const lw = 30;
  const cw = 22;
  const ch = 15;
  const top = 16;
  const W = lw + 24 * cw;
  const Ht = top + 7 * ch + 4;
  let s = '<svg width="100%" viewBox="0 0 ' + W + ' ' + Ht + '" style="max-width:' + W + 'px">';
  [0, 6, 12, 18].forEach((h) => {
    s += '<text x="' + (lw + h * cw) + '" y="11" font-size="10" fill="' + gray + '">' + h + ':00</text>';
  });
  for (let r = 0; r < 7; r++) {
    s += '<text x="0" y="' + (top + r * ch + 11) + '" font-size="10.5" fill="var(--muted)">' + DAYS[r] + '</text>';
    for (let h = 0; h < 24; h++) {
      const v = H[r][h];
      const op = v ? (0.15 + 0.85 * v / mx).toFixed(2) : 0;
      s += '<rect x="' + (lw + h * cw) + '" y="' + (top + r * ch) + '" width="' + (cw - 2) +
        '" height="' + (ch - 2) + '" rx="2" fill="' + accent + '" fill-opacity="' + op +
        '" stroke="var(--line)" stroke-width="0.5"/>';
    }
  }
  return s + '</svg>';
}

module.exports = {
  DAYS,
  ACCENT,
  GRAY,
  heatcellsFromEvents,
  resolveHeatcells,
  renderHeatSvg
};
