'use strict';

/**
 * UI model for the Linked signers page.
 *
 * Stages (pairing → mutual identity grants → LAN/WebRTC discovery → DeviceDataShare):
 *   this, unpaired, waiting-grant, waiting-sync, lan, webrtc, synced
 */

const { xOnly } = require('./clusterMesh');
const clusterInventory = require('./clusterInventory');

function _pk (row) {
  if (!row) return '';
  if (typeof row === 'string') return xOnly(row);
  return xOnly(row.peerPubkey || row.peerFabricId || row.pubkey || row.id || '');
}

function _label (row) {
  if (!row || typeof row !== 'object') return 'Linked signer';
  return String(row.label || row.name || 'Linked signer').slice(0, 64);
}

function pendingFor (cluster, localPubkey) {
  const local = xOnly(localPubkey);
  const out = [];
  const raw = cluster && cluster.pending;
  const list = Array.isArray(raw)
    ? raw
    : (raw && typeof raw === 'object' ? Object.values(raw) : []);
  for (const rec of list) {
    if (!rec) continue;
    const from = xOnly(rec.local || rec.from || rec.localPubkey);
    const to = xOnly(rec.peer || rec.to || rec.peerPubkey);
    if (!from || !to) continue;
    if (from !== local && to !== local) continue;
    out.push({ from, to, grant: rec.grant || null });
  }
  return out;
}

function pendingFromClusterInstance (identityCluster, localPubkey) {
  if (!identityCluster || typeof identityCluster.toJSON !== 'function') return [];
  const j = identityCluster.toJSON() || {};
  const pending = [];
  const rows = Array.isArray(j.pending) ? j.pending : [];
  for (const entry of rows) {
    const rec = Array.isArray(entry) ? entry[1] : entry;
    if (!rec) continue;
    pending.push({
      local: rec.local,
      peer: rec.peer,
      grant: rec.grant
    });
  }
  return pendingFor({ pending }, localPubkey);
}

/**
 * @param {Object} opts
 * @param {string} opts.localPubkey
 * @param {Array<object>} [opts.linkedDevices] linked signers `{ pubkey, label, linkedAt }`
 * @param {object} [opts.cluster] { members, edges, pending }
 * @param {object} [opts.sync] ClusterSync data
 * @param {object} [opts.mesh] { registered, discovered }
 * @returns {{ thisDevice: object, devices: object[], stage: string }}
 */
function mergeDeviceRows (opts = {}) {
  const local = String(opts.localPubkey || '').trim();
  const localX = xOnly(local);
  const linked = Array.isArray(opts.linkedDevices) ? opts.linkedDevices : [];
  const cluster = opts.cluster || {};
  const members = Array.isArray(cluster.members) ? cluster.members : (local ? [local] : []);
  const pending = pendingFor(cluster, local);
  const sync = opts.sync && opts.sync.data && !opts.sync.local ? opts.sync.data : (opts.sync || {});
  const mesh = opts.mesh || {};
  const discovered = Array.isArray(mesh.discovered) ? mesh.discovered : [];
  const peerRows = Array.isArray(sync.peers) ? sync.peers : [];
  const inventorySnap = sync.inventory && typeof sync.inventory === 'object'
    ? sync.inventory
    : {};
  const inboundByPk = new Map();
  const inboundList = Array.isArray(inventorySnap.inbound) ? inventorySnap.inbound : [];
  for (const row of inboundList) {
    const x = xOnly(row && (row.pubkey || row.fromPubkey));
    if (x) inboundByPk.set(x, clusterInventory.sanitizeStats(row));
  }
  const localCandidates = (sync.local && Array.isArray(sync.local.candidates))
    ? sync.local.candidates
    : [];
  const frames = sync.collection && Number(sync.collection.count) > 0
    ? Number(sync.collection.count)
    : 0;
  const fabric = sync.fabric || {};

  const byPk = new Map();
  const ensure = (pk, extra) => {
    const x = xOnly(pk);
    if (!x) return null;
    if (!byPk.has(x)) {
      byPk.set(x, {
        pubkey: pk,
        xonly: x,
        kind: x === localX ? 'this' : 'sibling',
        label: x === localX ? 'This app' : 'Linked signer',
        pairing: false,
        cluster: members.some((m) => xOnly(m) === x),
        pending: false,
        candidates: [],
        webrtc: false,
        lastSeen: null
      });
    }
    const row = byPk.get(x);
    if (extra) Object.assign(row, extra);
    return row;
  };

  if (local) {
    ensure(local, {
      kind: 'this',
      label: 'This app',
      pairing: true,
      cluster: true,
      candidates: localCandidates.slice(),
      webrtc: Array.isArray(mesh.registered) ? mesh.registered.length > 0 : !!mesh.registered,
      fabricReady: fabric.ready === true,
      fabricConnected: Number(fabric.connected) || 0
    });
  }

  for (const m of members) {
    const row = ensure(m);
    if (row) row.cluster = true;
  }

  for (const d of linked) {
    const pk = d.peerPubkey || d.peerFabricId || d.pubkey;
    const row = ensure(pk, {
      pairing: true,
      label: _label(d),
      linkedAt: d.linkedAt || null
    });
    if (row && row.kind !== 'this') row.pairing = true;
  }

  for (const p of pending) {
    const other = p.from === localX ? p.to : p.from;
    const row = ensure(other, { pending: true });
    if (row && !row.cluster) row.pending = true;
  }

  for (const p of peerRows) {
    const row = ensure(p.pubkey);
    if (!row) continue;
    if (Array.isArray(p.candidates) && p.candidates.length) {
      row.candidates = p.candidates.slice();
    }
    row.lastSeen = p.observedAt || row.lastSeen;
    if (p.inventory && typeof p.inventory === 'object') {
      inboundByPk.set(row.xonly, clusterInventory.sanitizeStats(p.inventory));
    }
  }

  for (const hit of discovered) {
    const row = ensure(hit.pubkey, { webrtc: true });
    if (!row) continue;
    row.webrtc = true;
    if (Array.isArray(hit.candidates) && hit.candidates.length && !row.candidates.length) {
      row.candidates = hit.candidates.slice();
    }
    row.lastSeen = hit.lastSeen || row.lastSeen;
    if (hit.hub) row.webrtcHub = hit.hub;
  }

  const devices = Array.from(byPk.values()).sort((a, b) => {
    if (a.kind === 'this') return -1;
    if (b.kind === 'this') return 1;
    return String(a.label).localeCompare(String(b.label));
  });

  const localInventory = inventorySnap.local
    ? clusterInventory.sanitizeStats(inventorySnap.local, { fill: true })
    : null;
  const outboundInventory = inventorySnap.outbound
    ? clusterInventory.sanitizeStats(inventorySnap.outbound)
    : null;

  for (const row of devices) {
    row.stage = stageFor(row, { frames, memberCount: members.length });
    if (row.kind === 'this') {
      row.inventory = localInventory;
      row.published = outboundInventory;
    } else {
      row.inventory = inboundByPk.get(row.xonly) || null;
      row.published = null;
    }
  }

  const siblings = devices.filter((d) => d.kind !== 'this');
  let stage = 'unpaired';
  if (!siblings.length) stage = 'unpaired';
  else if (siblings.every((d) => d.stage === 'synced') && frames) stage = 'synced';
  else if (siblings.some((d) => d.stage === 'waiting-grant' || d.pending)) stage = 'waiting-grant';
  else if (siblings.some((d) => d.webrtc || d.candidates.length)) stage = 'lan';
  else stage = 'waiting-sync';

  return {
    thisDevice: devices.find((d) => d.kind === 'this') || null,
    devices,
    stage,
    frames,
    pending
  };
}

function stageFor (row, ctx = {}) {
  if (row.kind === 'this') return 'this';
  if (row.cluster && ctx.frames) return 'synced';
  if (row.cluster && (row.candidates.length || row.webrtc)) {
    return row.webrtc && !row.candidates.length ? 'webrtc' : 'lan';
  }
  if (row.cluster) return 'waiting-sync';
  if (row.pairing || row.pending) return 'waiting-grant';
  return 'unpaired';
}

function stageLabel (stage) {
  switch (stage) {
    case 'this': return 'This app';
    case 'synced': return 'Account synced';
    case 'lan': return 'LAN advertised';
    case 'webrtc': return 'Hub coordinator';
    case 'waiting-sync': return 'Waiting for DeviceDataShare';
    case 'waiting-grant': return 'Waiting for the other side to grant identity';
    default: return 'Link a signer';
  }
}

module.exports = {
  xOnly,
  pendingFor,
  pendingFromClusterInstance,
  mergeDeviceRows,
  stageFor,
  stageLabel
};
