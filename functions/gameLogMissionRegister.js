'use strict';

/**
 * Map Star Citizen Game.log mission lifecycle into MissionManager register rows.
 * Log rows are evidence (D-005) — reward stays 0; officers still validate payouts.
 */

const { missionType, missionFaction } = require('./parser');

const ZERO_MISSION = '00000000-0000-0000-0000-000000000000';

function isTrackableMissionId (missionId) {
  const id = String(missionId || '').trim();
  return !!(id && id !== ZERO_MISSION);
}

/** Register id: prefer SC MissionId UUID; fall back to gamelog:<hash>. */
function registerIdForGameLog (opts = {}) {
  const sc = String(opts.scMissionId || opts.missionId || '').trim();
  if (isTrackableMissionId(sc)) return sc;
  const hid = String(opts.historyId || opts.id || '').trim();
  if (hid) return 'gamelog:' + hid;
  return null;
}

function humanizeGenerator (generator) {
  const raw = String(generator || '').trim();
  if (!raw) return null;
  const without = raw.replace(/_Generator$/i, '').replace(/_/g, ' ');
  return without
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/\s+/g, ' ')
    .trim() || null;
}

/**
 * Build a stable title for a log-sourced register row.
 * @param {Object} opts
 * @param {string} [opts.generator]
 * @param {string} [opts.text] latest objective / notification text
 * @param {string} [opts.title]
 */
function titleForGameLog (opts = {}) {
  if (opts.title && String(opts.title).trim()) return String(opts.title).trim();
  if (opts.text && String(opts.text).trim()) {
    const t = String(opts.text).trim();
    return t.length > 120 ? (t.slice(0, 117) + '…') : t;
  }
  const pretty = humanizeGenerator(opts.generator);
  if (pretty) return pretty;
  const type = missionType(opts.generator);
  const faction = missionFaction(opts.generator);
  if (type && type !== 'Other') {
    return faction && faction !== 'Unknown' ? `${faction} · ${type}` : type;
  }
  return 'In-game mission';
}

/**
 * Map SC CompletionType / lifecycle to register status.
 * @param {Object} opts
 * @param {string} [opts.outcome] Complete|Abandon|Fail|Deactivate
 * @param {boolean} [opts.started]
 */
function statusForGameLog (opts = {}) {
  const outcome = String(opts.outcome || opts.completionType || '').trim();
  if (outcome === 'Complete') return 'completed';
  if (outcome === 'Abandon' || outcome === 'Fail' || outcome === 'Deactivate') {
    return 'cancelled';
  }
  if (opts.started || opts.startedAt) return 'in_progress';
  return 'in_progress';
}

/**
 * Snapshot suitable for MissionManager.upsertFromGameLog.
 * @param {Object} opts
 */
function snapshotFromGameLog (opts = {}) {
  const scMissionId = isTrackableMissionId(opts.scMissionId || opts.missionId)
    ? String(opts.scMissionId || opts.missionId).trim()
    : null;
  const id = registerIdForGameLog(opts);
  if (!id) return null;
  const generator = opts.generator || null;
  const typeRaw = missionType(generator);
  // Register type enum is loosely free-text in createMission; keep classifier label.
  const type = String(typeRaw || 'bounty').toLowerCase().replace(/[^a-z0-9]+/g, '-') || 'bounty';
  const status = statusForGameLog(opts);
  const player = opts.player || opts.handle || null;
  const title = titleForGameLog(opts);
  return {
    id,
    scMissionId,
    title,
    type,
    description: opts.description ||
      (generator ? `Game.log · ${generator}` : 'Accepted / tracked from Game.log'),
    reward: 0,
    outOfGame: false,
    status,
    outcome: opts.outcome || opts.completionType || null,
    reason: opts.reason || null,
    generator,
    faction: missionFaction(generator),
    contractId: opts.contractId || null,
    player,
    startedAt: opts.startedAt || null,
    endedAt: opts.endedAt || null,
    createdAt: opts.startedAt || opts.firstSeen || opts.ts || opts.createdAt || null,
    source: 'gamelog',
    participantIds: player ? [String(player)] : []
  };
}

/**
 * History.json compact mission row → register snapshot.
 * @param {Object} row
 */
function snapshotFromHistoryRow (row = {}) {
  if (!row) return null;
  return snapshotFromGameLog({
    historyId: row.id,
    missionId: row.missionId,
    scMissionId: row.missionId,
    generator: row.generator || null,
    outcome: row.outcome,
    player: row.player,
    ts: row.ts,
    title: row.type && row.faction
      ? `${row.faction} · ${row.type}`
      : (row.type || null),
    description: row.faction
      ? `Game.log history · ${row.faction}${row.type ? ' · ' + row.type : ''}`
      : 'Game.log history'
  });
}

module.exports = {
  ZERO_MISSION,
  isTrackableMissionId,
  registerIdForGameLog,
  humanizeGenerator,
  titleForGameLog,
  statusForGameLog,
  snapshotFromGameLog,
  snapshotFromHistoryRow
};
