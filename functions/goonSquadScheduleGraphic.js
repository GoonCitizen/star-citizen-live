'use strict';

/**
 * G00N SQUAD week-ops infographic (SVG + standalone HTML).
 *
 * Regenerated from Discord Guild Scheduled Events:
 *   npm run discord:events -- graphic
 *   npm run discord:events -- graphic --fetch
 *
 * Dark industrial red/black — not the Fabric purple lettermark.
 */

const { WEEKDAY, buildWeekSchedule, formatEventTimes } = require('./discordScheduledEvents');

const WIDTH = 1920;
const HEIGHT = 1080;

const INK = {
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
  cream: '#e8dcc8'
};

const DAY_SHORT = Object.freeze({
  Monday: 'MON',
  Tuesday: 'TUE',
  Wednesday: 'WED',
  Thursday: 'THU',
  Friday: 'FRI',
  Saturday: 'SAT',
  Sunday: 'SUN'
});

/**
 * @param {*} value
 * @returns {string}
 */
function escapeXml (value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * @param {string} text
 * @param {number} maxChars
 * @param {number} [maxLines]
 * @returns {string[]}
 */
function wrapWords (text, maxChars, maxLines = 3) {
  const words = String(text || '').trim().split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  const lines = [];
  let cur = '';
  for (const word of words) {
    const next = cur ? (cur + ' ' + word) : word;
    if (next.length > maxChars && cur) {
      lines.push(cur);
      cur = word;
      if (lines.length === maxLines) break;
    } else {
      cur = next;
    }
  }
  if (cur && lines.length < maxLines) lines.push(cur);
  if (lines.length === maxLines && words.join(' ').length > lines.join(' ').length) {
    const last = lines[maxLines - 1];
    lines[maxLines - 1] = last.length > 3 ? (last.replace(/[,:;]+$/, '') + '…') : last;
  }
  return lines;
}

/**
 * @param {string} iso
 * @returns {string}
 */
function clockCt (iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  try {
    return new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/Chicago',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true
    }).format(d);
  } catch (_) {
    const times = formatEventTimes(iso);
    return times ? times.ct : '';
  }
}

/**
 * @param {string} iso
 * @returns {string}
 */
function dateCt (iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  try {
    return new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/Chicago',
      month: 'short',
      day: 'numeric'
    }).format(d);
  } catch (_) {
    return '';
  }
}

/**
 * @param {string} iso
 * @returns {string}
 */
function asOfLabel (iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  try {
    return new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/Chicago',
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
      timeZoneName: 'short'
    }).format(d);
  } catch (_) {
    return String(iso);
  }
}

/**
 * @param {string} desc
 * @param {number} [max]
 * @returns {string}
 */
function oneLine (desc, max = 46) {
  const s = String(desc || '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/[#*_`>]/g, '')
    .replace(/:[a-z0-9_+]+:/gi, ' ')
    .replace(/https?:\/\/\S+/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!s) return '';
  if (s.length <= max) return s;
  return s.slice(0, max - 1).replace(/\s+\S*$/, '') + '…';
}

/**
 * @param {object} row categorizeEvent-shaped
 * @returns {string|null}
 */
function badgeFor (row) {
  if (!row) return null;
  const cadence = String(row.cadence || '').toLowerCase();
  const status = String(row.statusName || '').toLowerCase();
  const reason = String(row.reason || '').toLowerCase();
  if (status === 'active') return 'LIVE';
  if (cadence.indexOf('monthly') !== -1) return 'MONTHLY';
  if (cadence.indexOf('every 2') !== -1 || cadence.indexOf('biweek') !== -1) return 'BIWEEKLY';
  if (row.kind === 'timed') return 'TRAIN';
  if (reason.indexOf('tournament') !== -1) return 'PVP';
  if (row.kind === 'special') return 'OPS';
  return null;
}

/**
 * @param {object} day buildWeekSchedule.days[name]
 * @returns {object[]}
 */
function overlaySlots (day) {
  if (!day) return [];
  return []
    .concat(day.timed || [])
    .concat(day.special || [])
    .concat(day.other || []);
}

/**
 * Copy RSVP counts from the raw event list onto categorized rows.
 * @param {object} schedule
 * @param {Array<object>} events
 * @returns {object}
 */
function enrichSchedule (schedule, events) {
  const byId = new Map();
  for (const e of events || []) {
    if (e && e.id != null) byId.set(String(e.id), e);
  }
  const bump = (row) => {
    if (!row) return row;
    const src = byId.get(String(row.id)) || {};
    const userCount = row.userCount != null ? row.userCount : src.userCount;
    return Object.assign({}, row, {
      userCount: userCount != null ? Number(userCount) : null,
      statusName: row.statusName || src.statusName || null,
      description: row.description != null ? row.description : src.description
    });
  };
  const days = {};
  for (const name of WEEKDAY) {
    const src = (schedule && schedule.days && schedule.days[name]) || {
      theme: null, timed: [], special: [], other: []
    };
    days[name] = {
      theme: bump(src.theme),
      timed: (src.timed || []).map(bump),
      special: (src.special || []).map(bump),
      other: (src.other || []).map(bump)
    };
  }
  return Object.assign({}, schedule, { days });
}

function tspans (lines, x, startY, lineHeight) {
  return lines.map((line, i) => (
    `<tspan x="${x}" y="${startY + i * lineHeight}">${escapeXml(line)}</tspan>`
  )).join('');
}

function roundRect (x, y, w, h, r, fill, extra) {
  const rr = Math.min(r, h / 2, w / 2);
  return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${rr}" ry="${rr}" fill="${fill}"${extra ? ' ' + extra : ''}/>`;
}

/**
 * Render the week board as SVG.
 * @param {object} [opts]
 * @param {object} [opts.schedule]
 * @param {Array<object>} [opts.events]
 * @param {string} [opts.fetchedAt]
 * @param {string} [opts.guildName]
 * @returns {{svg:string, width:number, height:number}}
 */
function renderWeekScheduleSvg (opts = {}) {
  const events = opts.events || [];
  const schedule = enrichSchedule(
    opts.schedule || buildWeekSchedule(events),
    events
  );
  const fetchedAt = opts.fetchedAt || schedule.generatedAt || new Date().toISOString();
  const guildName = opts.guildName || 'G00N SQUAD';

  const margin = 28;
  const headerH = 112;
  const footerH = 64;
  const gap = 14;
  const inner = WIDTH - margin * 2;
  const colW = Math.floor((inner - gap * 6) / 7);
  const used = colW * 7 + gap * 6;
  const originX = margin + Math.floor((inner - used) / 2);
  const originY = margin + headerH + 8;
  const bodyH = HEIGHT - margin * 2 - headerH - footerH - 8;
  const themeH = 168;
  let maxSlots = 1;
  for (const name of WEEKDAY) {
    maxSlots = Math.max(maxSlots, overlaySlots(schedule.days[name]).length);
  }
  const slotGap = 10;
  const slotArea = bodyH - themeH - slotGap;
  const slotH = Math.max(
    108,
    Math.min(148, Math.floor((slotArea - (maxSlots - 1) * slotGap) / maxSlots))
  );

  const parts = [];
  parts.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}" role="img" aria-label="${escapeXml(guildName)} weekly ops">`);
  parts.push(`<title>${escapeXml(guildName)} Weekly Ops</title>`);
  parts.push(`<rect width="${WIDTH}" height="${HEIGHT}" fill="${INK.bg}"/>`);
  parts.push(`<rect x="0" y="0" width="${WIDTH}" height="6" fill="${INK.red}"/>`);

  parts.push(`<text x="${margin + 4}" y="${margin + 42}" fill="${INK.ink}" font-family="Arial Black, Helvetica Neue, Helvetica, Arial, sans-serif" font-size="38" letter-spacing="4">${escapeXml(guildName)}</text>`);
  parts.push(`<text x="${margin + 4}" y="${margin + 74}" fill="${INK.red}" font-family="Helvetica Neue, Helvetica, Arial, sans-serif" font-size="18" font-weight="700" letter-spacing="6">WEEKLY OPS</text>`);
  parts.push(`<text x="${margin + 4}" y="${margin + 98}" fill="${INK.muted}" font-family="Helvetica Neue, Helvetica, Arial, sans-serif" font-size="13">PERMAFLEET · day theme + afternoon / evening blocks · Discord scheduled events</text>`);

  parts.push(`<text x="${WIDTH - margin}" y="${margin + 48}" text-anchor="end" fill="${INK.cream}" font-family="Helvetica Neue, Helvetica, Arial, sans-serif" font-size="16" font-weight="700">AMERICA/CHICAGO</text>`);
  parts.push(`<text x="${WIDTH - margin}" y="${margin + 72}" text-anchor="end" fill="${INK.muted}" font-family="Helvetica Neue, Helvetica, Arial, sans-serif" font-size="13">As of ${escapeXml(asOfLabel(fetchedAt))}</text>`);

  WEEKDAY.forEach((name, i) => {
    const x = originX + i * (colW + gap);
    const day = schedule.days[name];
    const theme = day.theme;
    const slots = overlaySlots(day);
    const monthly = slots.some((s) => String(s.cadence || '').toLowerCase().indexOf('monthly') !== -1);
    const colStroke = monthly ? `stroke="${INK.red}" stroke-width="2"` : `stroke="${INK.line}" stroke-width="1"`;

    parts.push(roundRect(x, originY - 28, colW, bodyH + 28, 10, INK.panel, colStroke));

    parts.push(`<text x="${x + 14}" y="${originY - 8}" fill="${INK.faint}" font-family="Helvetica Neue, Helvetica, Arial, sans-serif" font-size="12" font-weight="700" letter-spacing="3">${DAY_SHORT[name]}</text>`);

    const ty = originY + 8;
    if (theme) {
      parts.push(roundRect(x + 10, ty, colW - 20, themeH, 8, INK.redDark));
      parts.push(`<rect x="${x + 10}" y="${ty}" width="6" height="${themeH}" fill="${INK.red}" rx="2"/>`);
      const themeLines = wrapWords(theme.name, 14, 3);
      parts.push(`<text fill="${INK.ink}" font-family="Arial Black, Helvetica Neue, Helvetica, Arial, sans-serif" font-size="18">${tspans(themeLines, x + 24, ty + 36, 22)}</text>`);
      const tClock = clockCt(theme.scheduledStartTime);
      const tDate = dateCt(theme.scheduledStartTime);
      if (String(theme.statusName || '').toLowerCase() === 'active') {
        const bw = 40;
        const bx = x + colW - 22 - bw;
        parts.push(roundRect(bx, ty + 10, bw, 18, 3, INK.red));
        parts.push(`<text x="${bx + bw / 2}" y="${ty + 23}" text-anchor="middle" fill="${INK.ink}" font-family="Helvetica Neue, Helvetica, Arial, sans-serif" font-size="9" font-weight="700" letter-spacing="0.8">LIVE</text>`);
      }
      parts.push(`<text x="${x + 24}" y="${ty + themeH - 36}" fill="${INK.cream}" font-family="Helvetica Neue, Helvetica, Arial, sans-serif" font-size="14" font-weight="700">${escapeXml(tClock || 'All day')}</text>`);
      parts.push(`<text x="${x + 24}" y="${ty + themeH - 16}" fill="${INK.muted}" font-family="Helvetica Neue, Helvetica, Arial, sans-serif" font-size="11">${escapeXml(theme.cadence || 'weekly')}${tDate ? ' · ' + escapeXml(tDate) : ''}</text>`);
    } else {
      parts.push(roundRect(x + 10, ty, colW - 20, themeH, 8, INK.panelAlt, `stroke="${INK.line}" stroke-width="1" stroke-dasharray="4 4"`));
      parts.push(`<text x="${x + 24}" y="${ty + 48}" fill="${INK.faint}" font-family="Arial Black, Helvetica Neue, Helvetica, Arial, sans-serif" font-size="16">NO THEME</text>`);
      parts.push(`<text x="${x + 24}" y="${ty + 72}" fill="${INK.muted}" font-family="Helvetica Neue, Helvetica, Arial, sans-serif" font-size="12">Open play / training only</text>`);
    }

    slots.forEach((slot, si) => {
      const sy = ty + themeH + slotGap + si * (slotH + slotGap);
      const badge = badgeFor(slot);
      const isMonthly = badge === 'MONTHLY';
      const fill = isMonthly ? '#241111' : INK.panelAlt;
      const extra = isMonthly
        ? `stroke="${INK.red}" stroke-width="1.5"`
        : `stroke="${INK.line}" stroke-width="1"`;
      parts.push(roundRect(x + 10, sy, colW - 20, slotH, 8, fill, extra));
      const edge = slot.kind === 'timed' ? '#3f7d4e' : INK.red;
      parts.push(`<rect x="${x + 10}" y="${sy}" width="5" height="${slotH}" fill="${edge}" rx="2"/>`);

      const clock = clockCt(slot.scheduledStartTime);
      parts.push(`<text x="${x + 24}" y="${sy + 22}" fill="${INK.cream}" font-family="Helvetica Neue, Helvetica, Arial, sans-serif" font-size="12" font-weight="700">${escapeXml(clock)}</text>`);
      if (badge) {
        const bw = Math.round(badge.length * 7.2 + 12);
        const bx = x + colW - 20 - bw;
        const badgeFill = badge === 'TRAIN'
          ? '#3f7d4e'
          : (badge === 'MONTHLY' || badge === 'LIVE' ? INK.red : INK.redMid);
        parts.push(roundRect(bx, sy + 8, bw, 18, 3, badgeFill));
        parts.push(`<text x="${bx + bw / 2}" y="${sy + 21}" text-anchor="middle" fill="${INK.ink}" font-family="Helvetica Neue, Helvetica, Arial, sans-serif" font-size="9" font-weight="700" letter-spacing="0.8">${escapeXml(badge)}</text>`);
      }

      const nameLines = wrapWords(slot.name, 16, 2);
      parts.push(`<text fill="${INK.ink}" font-family="Helvetica Neue, Helvetica, Arial, sans-serif" font-size="14" font-weight="700">${tspans(nameLines, x + 24, sy + 46, 18)}</text>`);

      const blurb = oneLine(slot.description, 40);
      const meta = [
        dateCt(slot.scheduledStartTime),
        slot.userCount != null && Number.isFinite(Number(slot.userCount))
          ? (slot.userCount + ' in')
          : ''
      ].filter(Boolean).join(' · ');
      const yDesc = sy + slotH - (blurb ? 32 : 16);
      if (blurb) {
        parts.push(`<text x="${x + 24}" y="${yDesc}" fill="${INK.muted}" font-family="Helvetica Neue, Helvetica, Arial, sans-serif" font-size="11">${escapeXml(blurb)}</text>`);
      }
      if (meta) {
        parts.push(`<text x="${x + 24}" y="${sy + slotH - 14}" fill="${INK.faint}" font-family="Helvetica Neue, Helvetica, Arial, sans-serif" font-size="10">${escapeXml(meta)}</text>`);
      }
    });
  });

  const fy = HEIGHT - margin - 18;
  parts.push(`<rect x="${margin}" y="${HEIGHT - footerH - margin + 16}" width="${WIDTH - margin * 2}" height="1" fill="${INK.line}"/>`);
  parts.push(`<text x="${margin + 4}" y="${fy}" fill="${INK.muted}" font-family="Helvetica Neue, Helvetica, Arial, sans-serif" font-size="12"><tspan fill="${INK.red}">&#9608;</tspan> Day theme   <tspan fill="#3f7d4e">&#9608;</tspan> Training   <tspan fill="${INK.redMid}">&#9608;</tspan> Special / ops / monthly   ·   Times in Central   ·   npm run discord:events -- graphic</text>`);

  parts.push('</svg>');
  return { svg: parts.join('\n') + '\n', width: WIDTH, height: HEIGHT };
}

/**
 * Self-contained HTML page wrapping the SVG (open, screenshot, or attach).
 * @param {object} [opts]
 * @returns {string}
 */
function renderWeekScheduleHtml (opts = {}) {
  const rendered = opts.svg
    ? { svg: opts.svg, width: opts.width || WIDTH, height: opts.height || HEIGHT }
    : renderWeekScheduleSvg(opts);
  const title = (opts.guildName || 'G00N SQUAD') + ' Weekly Ops';
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=${rendered.width}"/>
  <title>${escapeXml(title)}</title>
  <style>
    html, body { margin: 0; padding: 0; background: ${INK.bg}; }
    body { display: flex; justify-content: center; }
    .board { width: ${rendered.width}px; height: ${rendered.height}px; }
    .board svg { display: block; width: ${rendered.width}px; height: ${rendered.height}px; }
  </style>
</head>
<body>
  <div class="board">${rendered.svg.trim()}</div>
</body>
</html>
`;
}

/**
 * @param {object} [opts]
 * @returns {{svg:string, html:string, width:number, height:number, baseName:string}}
 */
function renderWeekScheduleGraphic (opts = {}) {
  const svgDoc = renderWeekScheduleSvg(opts);
  const html = renderWeekScheduleHtml(Object.assign({}, opts, svgDoc));
  return {
    svg: svgDoc.svg,
    html,
    width: svgDoc.width,
    height: svgDoc.height,
    baseName: 'goon-squad-schedule'
  };
}

module.exports = {
  WIDTH,
  HEIGHT,
  INK,
  escapeXml,
  wrapWords,
  clockCt,
  dateCt,
  oneLine,
  badgeFor,
  overlaySlots,
  enrichSchedule,
  renderWeekScheduleSvg,
  renderWeekScheduleHtml,
  renderWeekScheduleGraphic
};
