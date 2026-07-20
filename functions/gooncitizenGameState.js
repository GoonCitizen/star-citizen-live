'use strict';

/**
 * Compact GoonCitizen game-state snapshot for Hub sidechain / statechain sync.
 *
 * Shape is written to Hub `sidechain/STATE` content at `/gooncitizen` and sealed
 * into Beacon epochs (`payload.sidechain.stateDigest` + `sidechain/SNAPSHOTS`).
 *
 * Keep this small and deterministic — it is public mesh state, not a raw log.
 */

const crypto = require('crypto');
const { gooncitizenContractId } = require('../contracts/gooncitizen');
const cumulativeHistory = require('./cumulativeHistory');

const SCHEMA_VERSION = 1;
const MAX_MISSIONS = 500;
const MAX_DEATHS = 500;

function canonicalStringify (value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalStringify).join(',')}]`;
  const keys = Object.keys(value).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalStringify(value[k])}`).join(',')}}`;
}

function digestOf (obj) {
  return crypto.createHash('sha256').update(canonicalStringify(obj)).digest('hex');
}

/**
 * Build a sidechain-ready game-state document from cumulative history (+ opts).
 * @param {Object} history cumulativeHistory document
 * @param {{ source?: string|null, sources?: Object, contractId?: string }} [opts]
 * @returns {Object}
 */
function buildGameStateSnapshot (history, opts = {}) {
  const h = cumulativeHistory.normalizeHistory(history || {});
  const counts = cumulativeHistory.cumulativeCounts(h);
  const missions = (h.missions || []).slice(-MAX_MISSIONS).map((m) => ({
    id: m.id || null,
    type: m.type || null,
    faction: m.faction || null,
    outcome: m.outcome || null,
    player: m.player || null,
    ts: m.ts || null
  }));
  const deaths = (h.deaths || []).slice(-MAX_DEATHS).map((d) => ({
    id: d.id || null,
    player: d.player || null,
    ts: d.ts || null
  }));

  const body = {
    '@type': 'GoonCitizenGameState',
    schemaVersion: SCHEMA_VERSION,
    contractId: opts.contractId || gooncitizenContractId(),
    updatedAt: new Date().toISOString(),
    counts,
    pilots: (h.players || []).slice().sort(),
    missions,
    deaths,
    sessions: (h.sessions || []).length,
    heat: h.heat || {},
    meta: {
      files: (h.meta && h.meta.files) || 0,
      lines: (h.meta && h.meta.lines) || 0,
      generatedAt: (h.meta && (h.meta.lastFlushAt || h.meta.generatedAt)) || null
    }
  };
  if (opts.source) body.source = String(opts.source);
  if (opts.sources && typeof opts.sources === 'object') body.sources = opts.sources;

  // Digest is over durable fields only (exclude wall-clock updatedAt / digest).
  const forDigest = {
    '@type': body['@type'],
    schemaVersion: body.schemaVersion,
    contractId: body.contractId,
    counts: body.counts,
    pilots: body.pilots,
    missions: body.missions,
    deaths: body.deaths,
    sessions: body.sessions,
    heat: body.heat,
    meta: {
      files: body.meta.files,
      lines: body.meta.lines,
      generatedAt: body.meta.generatedAt
    },
    source: body.source || null,
    sources: body.sources || null
  };
  body.digest = digestOf(forDigest);
  return body;
}

/**
 * RFC6902 patches to publish `snap` at `/gooncitizen` on sidechain content.
 * Also seals a namespace head at `/namespaces/<contractId>` (D-016 / ADR-001)
 * when the snapshot carries a `contractId` + `digest`.
 * @param {Object|null|undefined} existingContent sidechain content object
 * @param {Object} snap
 * @returns {object[]}
 */
function patchesForGameState (existingContent, snap) {
  const patches = [];
  const has = existingContent && Object.prototype.hasOwnProperty.call(existingContent, 'gooncitizen');
  if (has) {
    const prev = existingContent.gooncitizen;
    if (!(prev && prev.digest && snap && snap.digest && prev.digest === snap.digest)) {
      patches.push({ op: 'replace', path: '/gooncitizen', value: snap });
    }
  } else {
    patches.push({ op: 'add', path: '/gooncitizen', value: snap });
  }

  // Parent seal for the GoonCitizen Contract namespace (same Statechain type).
  const contractId = snap && snap.contractId ? String(snap.contractId).trim().toLowerCase() : '';
  if (contractId && snap && snap.digest) {
    try {
      const contractSidechain = require('./contractSidechain');
      const head = {
        contractId,
        clock: 0,
        stateDigest: String(snap.digest),
        name: 'GoonCitizen',
        parentContractId: null,
        kind: 'GoonCitizenGameState'
      };
      const prevNs = existingContent && existingContent.namespaces && existingContent.namespaces[contractId];
      if (prevNs && Number.isFinite(Number(prevNs.clock))) {
        head.clock = Number(prevNs.clock) + (patches.length ? 1 : 0);
      } else if (patches.length) {
        head.clock = 1;
      }
      patches.push(...contractSidechain.patchesForNamespaceHead(existingContent, contractId, head));
    } catch (_) {
      /* contract sidechain helper optional */
    }
  }

  return patches;
}

/**
 * Merge a peer-sourced snapshot into hub cumulative history (idempotent records).
 * @returns {Boolean} changed
 */
function mergeSnapshotIntoHistory (history, index, snap, sourcePubkey) {
  if (!snap || !history || !index) return false;
  let changed = false;
  const handleHint = null;
  for (const m of snap.missions || []) {
    if (!m || !m.ts) continue;
    const ev = {
      kind: 'mission:end',
      timestamp: m.ts,
      completionType: m.outcome,
      player: m.player,
      missionId: m.missionId || m.id,
      generator: null
    };
    if (cumulativeHistory.applyEvent(history, index, ev, {
      handle: m.player || handleHint,
      generators: {},
      countHeat: false
    })) changed = true;
  }
  for (const d of snap.deaths || []) {
    if (!d || !d.ts) continue;
    if (cumulativeHistory.applyEvent(history, index, {
      kind: 'player:death',
      timestamp: d.ts,
      player: d.player,
      bodyId: d.bodyId || null
    }, { handle: d.player, countHeat: false })) changed = true;
  }
  for (const p of snap.pilots || []) {
    if (cumulativeHistory.applyEvent(history, index, { kind: 'player:login', handle: p }, { countHeat: false })) {
      changed = true;
    }
  }
  // Merge heat buckets (max — avoids double-count inflation from partial resends).
  if (snap.heat && typeof snap.heat === 'object') {
    for (const [k, n] of Object.entries(snap.heat)) {
      const v = Number(n) || 0;
      if (v <= 0) continue;
      const cur = history.heat[k] || 0;
      if (v > cur) {
        history.heat[k] = v;
        changed = true;
      }
    }
  }
  if (sourcePubkey && snap.counts) {
    history._sources = history._sources || {};
    history._sources[sourcePubkey] = {
      pubkey: sourcePubkey,
      counts: snap.counts,
      digest: snap.digest || null,
      updatedAt: snap.updatedAt || new Date().toISOString()
    };
  }
  return changed;
}

module.exports = {
  SCHEMA_VERSION,
  MAX_MISSIONS,
  MAX_DEATHS,
  buildGameStateSnapshot,
  patchesForGameState,
  mergeSnapshotIntoHistory,
  digestOf,
  canonicalStringify
};
