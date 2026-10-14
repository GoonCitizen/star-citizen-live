'use strict';

/**
 * Shared mission-outcome chart helpers (Home stats + Missions tab).
 */

const OUTCOMES = {
  Complete: { c: '#3fb950', t: 'Complete' },
  Abandon: { c: '#d29922', t: 'Abandon' },
  Fail: { c: '#f85149', t: 'Fail' },
  Deactivate: { c: '#6e7681', t: 'Deactivate' }
};
const OUTCOME_KEYS = ['Complete', 'Abandon', 'Fail', 'Deactivate'];

/**
 * @param {Array<{ outcome?: string }>} missions
 * @param {{ selected?: Set<string>|null }} [opts]
 * @returns {string} SVG or empty HTML
 */
function renderOutcomesDonut (missions, opts = {}) {
  const selected = opts.selected || null;
  const co = {};
  let tot = 0;
  (missions || []).forEach((m) => {
    if (m && m.outcome) {
      co[m.outcome] = (co[m.outcome] || 0) + 1;
      tot++;
    }
  });
  if (!tot) return '<div class="empty">no ended missions in range yet</div>';
  const cx = 70;
  const cy = 72;
  const r = 56;
  let a = -Math.PI / 2;
  let s = '<svg width="100%" viewBox="0 0 280 150" style="max-width:280px">';
  OUTCOME_KEYS.forEach((o) => {
    const n = co[o] || 0;
    if (!n) return;
    const f = n / tot;
    const a1 = a + f * Math.PI * 2;
    const x0 = cx + r * Math.cos(a);
    const y0 = cy + r * Math.sin(a);
    const x1 = cx + r * Math.cos(a1);
    const y1 = cy + r * Math.sin(a1);
    const lg = (a1 - a) > Math.PI ? 1 : 0;
    const op = (!selected || !selected.size || selected.has(o)) ? 1 : 0.3;
    s += '<path d="M' + cx + ' ' + cy + ' L' + x0.toFixed(1) + ' ' + y0.toFixed(1) +
      ' A' + r + ' ' + r + ' 0 ' + lg + ' 1 ' + x1.toFixed(1) + ' ' + y1.toFixed(1) +
      ' Z" fill="' + OUTCOMES[o].c + '" fill-opacity="' + op + '" data-oc="' + o + '"/>';
    a = a1;
  });
  s += '<circle cx="' + cx + '" cy="' + cy + '" r="34" fill="var(--panel)"/>' +
    '<text x="' + cx + '" y="' + (cy - 1) + '" text-anchor="middle" font-size="21" font-weight="650" fill="var(--text)">' +
    tot + '</text>' +
    '<text x="' + cx + '" y="' + (cy + 14) + '" text-anchor="middle" font-size="10" fill="var(--muted)">missions</text>';
  let i = 0;
  OUTCOME_KEYS.forEach((o) => {
    const n = co[o] || 0;
    if (!n) return;
    const y = 32 + i * 25;
    i++;
    s += '<rect x="156" y="' + y + '" width="11" height="11" rx="2" fill="' + OUTCOMES[o].c + '"/>' +
      '<text x="173" y="' + (y + 10) + '" font-size="12" fill="var(--muted)">' + OUTCOMES[o].t + '</text>' +
      '<text x="270" y="' + (y + 10) + '" text-anchor="end" font-size="12" font-weight="650" fill="var(--text)">' +
      n + '</text>';
  });
  return s + '</svg>';
}

/**
 * Rank pilots by completed Game.log missions, then total missions.
 * @param {Array<{ player?: string, outcome?: string }>} missions
 * @param {Array<{ player?: string }>} [deaths]
 * @param {{ limit?: number }} [opts]
 * @returns {Array<{ n: string, tot: number, done: number, deaths: number }>}
 */
function topPilots (missions, deaths, opts) {
  const limit = (opts && opts.limit) || 10;
  const by = {};
  (missions || []).forEach((m) => {
    if (!m || !m.player) return;
    const b = by[m.player] || (by[m.player] = { tot: 0, done: 0, deaths: 0 });
    b.tot++;
    if (m.outcome === 'Complete') b.done++;
  });
  (deaths || []).forEach((d) => {
    if (!d || !d.player) return;
    const b = by[d.player] || (by[d.player] = { tot: 0, done: 0, deaths: 0 });
    b.deaths++;
  });
  return Object.keys(by).map((k) => Object.assign({ n: k }, by[k]))
    .sort((a, b) => (b.done - a.done) || (b.tot - a.tot) || a.n.localeCompare(b.n))
    .slice(0, limit);
}

module.exports = {
  OUTCOMES,
  OUTCOME_KEYS,
  renderOutcomesDonut,
  topPilots
};
