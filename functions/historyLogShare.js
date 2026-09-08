'use strict';

/**
 * Map local cumulative history into SCEventBatch uplink rows so enabling
 * shareLogs (after a first-time corpus sync) can publish already-read logs.
 */

const { isLocalHistoryRecord } = require('./cumulativeHistory');

/** Soft cap so a multi-year corpus cannot blow the 5000-entry uplink queue. */
const DEFAULT_MAX_PER_COLLECTION = 2000;

/**
 * @param {object} [history]
 * @param {{ maxPerCollection?: number }} [opts]
 * @returns {{ collection: string, data: object }[]}
 */
function eventsFromLocalHistory (history, opts = {}) {
  const max = Number.isFinite(opts.maxPerCollection) && opts.maxPerCollection > 0
    ? Math.floor(opts.maxPerCollection)
    : DEFAULT_MAX_PER_COLLECTION;
  const h = history && typeof history === 'object' ? history : {};
  const out = [];

  const takeLocal = (rows) => {
    const local = (Array.isArray(rows) ? rows : []).filter(isLocalHistoryRecord);
    return local.length > max ? local.slice(-max) : local;
  };

  for (const m of takeLocal(h.missions)) {
    out.push({
      collection: 'missionlog',
      data: {
        id: m.id || null,
        kind: 'mission:end',
        timestamp: m.ts || null,
        player: m.player || null,
        completionType: m.outcome || null,
        outcome: m.outcome || null,
        missionId: m.missionId || null,
        generator: m.type || null
      }
    });
  }

  for (const d of takeLocal(h.deaths)) {
    out.push({
      collection: 'deaths',
      data: {
        id: d.id || null,
        kind: 'player:death',
        timestamp: d.ts || null,
        player: d.player || null,
        bodyId: d.bodyId || null
      }
    });
  }

  for (const i of takeLocal(h.incap)) {
    out.push({
      collection: 'incaps',
      data: {
        id: i.id || null,
        kind: 'player:incap',
        timestamp: i.ts || null,
        player: i.player || null,
        text: i.text || null
      }
    });
  }

  for (const q of takeLocal(h.quantum)) {
    const phase = q.phase === 'arrive' ? 'arrive' : 'select';
    out.push({
      collection: 'quantum',
      data: {
        id: q.id || null,
        kind: phase === 'arrive' ? 'quantum:arrive' : 'quantum:select',
        timestamp: q.ts || null,
        player: q.player || null,
        destination: q.destination || null,
        vehicle: q.vehicle || null
      }
    });
  }

  for (const c of takeLocal(h.crimestat)) {
    out.push({
      collection: 'crimestat',
      data: {
        id: c.id || null,
        kind: 'player:crimestat',
        timestamp: c.ts || null,
        player: c.player || null,
        rating: c.rating,
        delta: c.delta
      }
    });
  }

  for (const name of (Array.isArray(h.players) ? h.players : []).filter(Boolean).slice(-max)) {
    out.push({
      collection: 'players',
      data: { name: String(name), timestamp: null }
    });
  }

  return out;
}

module.exports = {
  eventsFromLocalHistory,
  DEFAULT_MAX_PER_COLLECTION
};
