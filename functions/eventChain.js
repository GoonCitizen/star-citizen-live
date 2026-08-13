'use strict';

/**
 * EventChain — thin GoonCitizen helper over gossip-consensus Chain of Blocks (D-018).
 *
 * Observations are Bitcoin-shaped Blocks with arbitrary `data` (`type: 'SCEvent'`).
 * Local analytics still fold into `history.json` (D-014). Digests may feed
 * Statechain / GameStateSnapshot; raw gossip is never Beacon authority.
 */

let Chain = null;
let Block = null;
try {
  Chain = require('@fabric/core/types/chain');
  Block = require('@fabric/core/types/block');
} catch (_) {
  Chain = null;
  Block = null;
}

function _chain () {
  if (!Chain || typeof Chain.create !== 'function') {
    throw new Error('@fabric/core/types/chain required — link local fabric-clean (npm run link:fabric)');
  }
  return Chain;
}

/** @returns {import('@fabric/core/types/chain')} */
function createEmpty () {
  return _chain().create({ consensus: 'gossip' });
}

/**
 * @param {object} [history] cumulativeHistory document
 * @param {string|null} [defaultSource]
 * @returns {import('@fabric/core/types/chain')}
 */
function fromHistory (history, defaultSource = null) {
  const chain = createEmpty();
  for (const d of (history && history.deaths) || []) {
    if (!d) continue;
    appendEvent(chain, {
      id: d.id,
      kind: 'player:death',
      timestamp: d.ts,
      player: d.player,
      bodyId: d.bodyId
    }, { source: defaultSource || d.player || null });
  }
  for (const m of (history && history.missions) || []) {
    if (!m) continue;
    appendEvent(chain, {
      id: m.id,
      kind: 'mission:end',
      timestamp: m.ts,
      player: m.player,
      missionId: m.missionId,
      completionType: m.outcome,
      type: m.type,
      faction: m.faction
    }, { source: defaultSource || m.player || null });
  }
  return chain;
}

function _normalizeFields (fields) {
  const src = fields && typeof fields === 'object' ? fields : {};
  const out = {};
  for (const key of ['player', 'bodyId', 'missionId', 'completionType', 'type', 'faction']) {
    if (src[key] != null && src[key] !== '') out[key] = src[key];
  }
  return out;
}

/**
 * Append one gameplay observation as a data Block (idempotent by content id).
 * @param {import('@fabric/core/types/chain')} chain
 * @param {object} event
 * @param {{ source?: string|null, signWith?: object }} [opts]
 */
function appendEvent (chain, event, opts = {}) {
  if (!chain || !event) return null;
  const source = opts.source || event.source || event.author || null;
  const kind = event.kind || event.type || 'event';
  const timestamp = event.timestamp || event.ts || null;
  const fields = _normalizeFields(event.fields || {
    player: event.player,
    bodyId: event.bodyId,
    missionId: event.missionId,
    completionType: event.completionType || event.outcome,
    type: event.missionType || null,
    faction: event.faction
  });
  const id = event.id || _chain().eventId({
    source: source || '',
    kind,
    fields,
    timestamp: timestamp || ''
  });
  const data = {
    kind,
    timestamp,
    source,
    fields,
    collection: event.collection || null,
    data: event.data || null
  };
  const appendOpts = {};
  if (opts.signWith) appendOpts.signWith = opts.signWith;

  if (Block) {
    return chain.append(new Block({
      type: 'SCEvent',
      id,
      author: source,
      data
    }), appendOpts);
  }

  return chain.append({
    type: 'SCEvent',
    id,
    author: source,
    data
  }, appendOpts);
}

/**
 * Merge an SCEventBatch-shaped list into the local gossip chain.
 * @param {import('@fabric/core/types/chain')} chain
 * @param {Array<{ collection?: string, data?: object, id?: string }>} events
 * @param {string} source Author pubkey
 */
function mergeBatch (chain, events, source) {
  if (!chain) return chain;
  const other = createEmpty();
  for (const ev of events || []) {
    if (!ev) continue;
    const data = ev.data || {};
    appendEvent(other, {
      id: ev.id,
      kind: data.kind || ev.collection || 'event',
      timestamp: data.timestamp || data.ts || null,
      player: data.player,
      bodyId: data.bodyId,
      missionId: data.missionId,
      completionType: data.completionType || data.outcome,
      collection: ev.collection,
      data
    }, { source: source || null });
  }
  chain.merge(other);
  return chain;
}

function replay (chain, opts) {
  return chain ? chain.replay(opts || {}) : [];
}

function split (chain, opts) {
  if (!chain) return { head: createEmpty(), tail: createEmpty() };
  return chain.split(opts || {});
}

function merge (a, b) {
  if (!a) return b;
  if (!b) return a;
  return a.merge(b);
}

function digest (chain) {
  return chain ? chain.digest() : null;
}

function eventId (args) {
  return _chain().eventId(args || {});
}

/**
 * Fold chain blocks back into compact history-shaped records (tests / tooling).
 * @param {import('@fabric/core/types/chain')} chain
 * @returns {{ deaths: object[], missions: object[] }}
 */
function foldToHistoryRecords (chain) {
  const deaths = [];
  const missions = [];
  for (const e of replay(chain)) {
    const p = e.data || e.payload || {};
    const f = p.fields || {};
    if (p.kind === 'player:death' || p.kind === 'deaths') {
      deaths.push({
        id: e.id,
        player: f.player,
        ts: p.timestamp,
        bodyId: f.bodyId || null
      });
    } else if (p.kind === 'mission:end' || p.kind === 'missionlog') {
      missions.push({
        id: e.id,
        player: f.player,
        ts: p.timestamp,
        outcome: f.completionType || null,
        missionId: f.missionId || null,
        type: f.type || null,
        faction: f.faction || null
      });
    }
  }
  return { deaths, missions };
}

module.exports = {
  createEmpty,
  fromHistory,
  appendEvent,
  mergeBatch,
  replay,
  split,
  merge,
  digest,
  eventId,
  foldToHistoryRecords,
  /** @returns {boolean} */
  get available () {
    return !!(Chain && typeof Chain.create === 'function' &&
      (Chain.CONSENSUS_GOSSIP || Chain.SEAL_GOSSIP));
  }
};
