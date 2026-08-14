'use strict';

/**
 * Local `settings.linkedDevices` rows after a mutual fabric://link.
 * Non-secret metadata only — IdentityCrossSign is the mesh proof.
 */

function mergeLinkedDevice (list, entry) {
  const rows = Array.isArray(list) ? list.slice() : [];
  if (!entry || !entry.peerFabricId) return rows;
  const peer = String(entry.peerFabricId);
  const idx = rows.findIndex((d) => d && String(d.peerFabricId) === peer);
  const row = {
    kind: entry.kind || 'device-link',
    peerFabricId: peer,
    peerXpub: entry.peerXpub || null,
    peerPubkey: entry.peerPubkey || entry.peerPubkeyHex || null,
    nonce: entry.nonce || null,
    label: entry.label || 'Linked device',
    hubOrigin: entry.hubOrigin || null,
    linkedAt: entry.linkedAt || new Date().toISOString(),
    role: entry.role || 'responder'
  };
  if (idx >= 0) rows[idx] = Object.assign({}, rows[idx], row);
  else rows.push(row);
  return rows;
}

module.exports = { mergeLinkedDevice };
