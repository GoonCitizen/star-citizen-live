'use strict';

/**
 * Group-owner summaries of online member ships + locations from PeerPresence.
 */

function presenceFor (roster, pubkey) {
  if (!roster || !pubkey) return null;
  if (roster[pubkey]) return roster[pubkey];
  const lower = String(pubkey).toLowerCase();
  for (const [key, row] of Object.entries(roster)) {
    if (String(key).toLowerCase() === lower) return row;
  }
  return null;
}

function locLabel (loc) {
  if (!loc || typeof loc !== 'object') return null;
  return loc.name || loc.slug || null;
}

function shipLabel (ship) {
  if (!ship || typeof ship !== 'object') return null;
  return ship.name || ship.slug || null;
}

/**
 * @param {string[]} memberPubkeys
 * @param {object} roster PeerPresence by pubkey
 * @returns {object}
 */
function summarizeOnlineMembers (memberPubkeys, roster) {
  const members = [];
  const ships = Object.create(null);
  const types = Object.create(null);
  const locations = Object.create(null);
  let online = 0;
  for (const pk of memberPubkeys || []) {
    const p = presenceFor(roster, pk);
    const isOnline = !!(p && p.online);
    if (isOnline) online += 1;
    const ship = (p && p.ship) || null;
    const location = (p && p.location) || null;
    const destination = (p && p.destination) || null;
    if (isOnline) {
      const sn = shipLabel(ship);
      if (sn) ships[sn] = (ships[sn] || 0) + 1;
      const st = ship && ship.type ? String(ship.type) : null;
      if (st) types[st] = (types[st] || 0) + 1;
      const ln = locLabel(location);
      if (ln) locations[ln] = (locations[ln] || 0) + 1;
    }
    members.push({
      pubkey: pk,
      nickname: (p && p.nickname) || null,
      online: isOnline,
      ship,
      shipType: (ship && ship.type) || null,
      location,
      destination,
      statusText: (p && p.statusText) || null,
      lastEventAt: (p && p.lastEventAt) || null
    });
  }
  const asRows = (obj) => Object.keys(obj)
    .map((n) => ({ n, c: obj[n] }))
    .sort((a, b) => b.c - a.c || a.n.localeCompare(b.n));
  return {
    online,
    total: (memberPubkeys || []).length,
    ships: asRows(ships),
    shipTypes: asRows(types),
    locations: asRows(locations),
    members
  };
}

function resolvePlaceLabel (value) {
  if (!value) return null;
  if (typeof value === 'object') return value.name || value.slug || null;
  return String(value);
}

function isGroupOwner (group, pubkey) {
  if (!group) return false;
  if (group.role === 'creator') return true;
  if (!pubkey || !group.creator) return false;
  return String(group.creator).toLowerCase() === String(pubkey).toLowerCase();
}

/**
 * Short chip for a presence roster row (online · ship · location).
 * @param {object|null} p
 * @returns {string}
 */
function presenceChipLabel (p) {
  if (!p) return '—';
  if (!p.online) return 'offline';
  const bits = ['online'];
  const ship = shipLabel(p.ship);
  if (ship) bits.push(ship);
  const loc = locLabel(p.location);
  if (loc) bits.push(loc);
  const dest = locLabel(p.destination);
  if (dest) bits.push('→ ' + dest);
  return bits.join(' · ');
}

function majoritySystem (members) {
  const counts = Object.create(null);
  for (const m of members || []) {
    const sys = m && m.location && m.location.system;
    if (!sys) continue;
    const key = String(sys);
    counts[key] = (counts[key] || 0) + 1;
  }
  const keys = Object.keys(counts);
  if (!keys.length) return 'STANTON';
  keys.sort((a, b) => counts[b] - counts[a] || a.localeCompare(b));
  return keys[0];
}

module.exports = {
  presenceFor,
  locLabel,
  shipLabel,
  summarizeOnlineMembers,
  resolvePlaceLabel,
  isGroupOwner,
  presenceChipLabel,
  majoritySystem
};
