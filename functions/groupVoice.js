'use strict';

/**
 * Federation group voice presence (not Statechain-journaled).
 * SDP/ICE does not ride these frames — Hub WebRTC coordination does.
 */

const { pubkeysMatch } = require('./identity');
const groupVoiceHub = require('./groupVoiceHub');

const JOIN = 'GroupVoiceJoin';
const LEAVE = 'GroupVoiceLeave';
const SPEAKING = 'GroupVoiceSpeaking';
const ROOM_CAP = 8;
const SPEAKING_TTL_MS = 800;

function xOnly (pk) {
  const s = String(pk || '').trim().toLowerCase();
  if (/^0[23][0-9a-f]{64}$/.test(s)) return s.slice(2);
  if (/^[0-9a-f]{64}$/.test(s)) return s;
  return '';
}

function webrtcPeerIdFor (pubkey) {
  const x = xOnly(pubkey);
  return x ? ('gv-' + x) : '';
}

function emptyRooms () {
  return {
    rooms: Object.create(null),
    local: {
      groupId: null,
      groupName: null,
      webrtcPeerId: null,
      pubkey: null,
      joinedAt: 0
    }
  };
}

function roomOf (state, groupId) {
  const id = String(groupId || '');
  if (!id) return null;
  if (!state.rooms[id]) {
    state.rooms[id] = { groupId: id, members: Object.create(null) };
  }
  return state.rooms[id];
}

function memberKey (pubkey) {
  return xOnly(pubkey) || String(pubkey || '').toLowerCase();
}

function isMemberOfGroup (group, pubkey, sameActor) {
  if (!group || !pubkey) return false;
  const match = typeof sameActor === 'function'
    ? (a, b) => !!(a && b && (sameActor(a, b) || pubkeysMatch(a, b)))
    : pubkeysMatch;
  if (typeof group.includes === 'function' && group.includes(pubkey)) return true;
  if (group.creator && match(group.creator, pubkey)) return true;
  const list = Array.isArray(group.members) ? group.members : [];
  return list.some((m) => match(m, pubkey));
}

/**
 * Stored member pubkey to join as, or null when `pubkey` is not in the group.
 * Identity-cluster `sameActor` maps a linked device onto the roster key.
 * @param {object} group
 * @param {string} pubkey
 * @param {function} [sameActor]
 * @returns {string|null}
 */
function memberPubkeyFor (group, pubkey, sameActor) {
  if (!isMemberOfGroup(group, pubkey, sameActor)) return null;
  const match = typeof sameActor === 'function'
    ? (a, b) => !!(a && b && (sameActor(a, b) || pubkeysMatch(a, b)))
    : pubkeysMatch;
  const list = Array.isArray(group.members) ? group.members : [];
  const hit = list.find((m) => match(m, pubkey));
  if (hit) return hit;
  if (group.creator && match(group.creator, pubkey)) return group.creator;
  return pubkey;
}

/**
 * Desktop may have a Bearer session (unlocked wallet) that created the group
 * while LiveRelay `_identity` is `FABRIC_XPRV`. Pick the first candidate that
 * is actually a member, and return the roster pubkey to join as.
 * @param {object} group
 * @param {string[]} candidates
 * @param {function} [sameActor]
 * @returns {string|null}
 */
function resolveVoiceActor (group, candidates, sameActor) {
  const seen = [];
  for (const raw of Array.isArray(candidates) ? candidates : []) {
    const pk = String(raw || '').trim();
    if (!pk || seen.some((x) => pubkeysMatch(x, pk))) continue;
    seen.push(pk);
    const member = memberPubkeyFor(group, pk, sameActor);
    if (member) return member;
  }
  return null;
}

/**
 * @param {object} state
 * @param {object} opts
 * @returns {{ ok: boolean, error?: string, room?: object, member?: object }}
 */
function applyJoin (state, opts = {}) {
  const groupId = String(opts.groupId || '').trim();
  const pubkey = String(opts.pubkey || '').trim();
  if (!groupId || !pubkey) return { ok: false, error: 'groupId and pubkey required' };
  if (opts.group && !isMemberOfGroup(opts.group, pubkey)) {
    return { ok: false, error: 'forbidden: members only' };
  }
  const room = roomOf(state, groupId);
  const key = memberKey(pubkey);
  const count = Object.keys(room.members).filter((k) => k !== key).length;
  if (!room.members[key] && count >= ROOM_CAP) {
    return { ok: false, error: 'voice room is full' };
  }
  const webrtcPeerId = String(opts.webrtcPeerId || webrtcPeerIdFor(pubkey));
  const member = {
    pubkey,
    webrtcPeerId,
    handle: opts.handle ? String(opts.handle).slice(0, 64) : null,
    joinedAt: Number(opts.joinedAt) || Date.now(),
    speakingUntil: 0
  };
  room.members[key] = member;
  return { ok: true, room, member };
}

function applyLeave (state, opts = {}) {
  const groupId = String(opts.groupId || '').trim();
  const pubkey = String(opts.pubkey || '').trim();
  if (!groupId || !pubkey) return { ok: false, error: 'groupId and pubkey required' };
  const room = state.rooms[groupId];
  if (!room) return { ok: true, room: null };
  delete room.members[memberKey(pubkey)];
  if (!Object.keys(room.members).length) delete state.rooms[groupId];
  return { ok: true, room: state.rooms[groupId] || null };
}

function applySpeaking (state, opts = {}) {
  const groupId = String(opts.groupId || '').trim();
  const pubkey = String(opts.pubkey || '').trim();
  const room = state.rooms[groupId];
  if (!room) return { ok: false, error: 'not in room' };
  const member = room.members[memberKey(pubkey)];
  if (!member) return { ok: false, error: 'not in room' };
  const on = opts.speaking !== false;
  member.speakingUntil = on ? (Date.now() + SPEAKING_TTL_MS) : 0;
  return { ok: true, member };
}

function listMembers (room, now) {
  const t = Number(now) || Date.now();
  if (!room) return [];
  return Object.keys(room.members).map((k) => {
    const m = room.members[k];
    return {
      pubkey: m.pubkey,
      webrtcPeerId: m.webrtcPeerId,
      handle: m.handle || null,
      joinedAt: m.joinedAt,
      speaking: m.speakingUntil > t
    };
  }).sort((a, b) => a.joinedAt - b.joinedAt);
}

function snapshot (state, opts = {}) {
  const local = state.local || {};
  const groupId = local.groupId;
  const room = groupId ? state.rooms[groupId] : null;
  const members = listMembers(room, opts.now);
  return {
    joined: !!groupId,
    groupId: groupId || null,
    groupName: local.groupName || null,
    webrtcPeerId: local.webrtcPeerId || null,
    joinedAt: local.joinedAt || 0,
    memberCount: members.length,
    cap: ROOM_CAP,
    hubOrigin: opts.hubOrigin || groupVoiceHub.PUBLIC_ORIGIN,
    members
  };
}

function ingestFrame (state, type, object, signer, opts = {}) {
  const groupId = String((object && object.groupId) || opts.groupId || '').trim();
  const pubkey = String(signer || (object && object.pubkey) || '').trim();
  if (!groupId || !pubkey) return { ok: false, error: 'missing group or signer' };
  if (!opts.group) return { ok: false, error: 'unknown group' };
  if (!isMemberOfGroup(opts.group, pubkey)) {
    return { ok: false, error: 'forbidden: not a member' };
  }
  const t = String(type || (object && (object.type || object['@type'])) || '');
  if (t === JOIN) {
    return applyJoin(state, {
      groupId,
      pubkey,
      group: opts.group,
      webrtcPeerId: object && object.webrtcPeerId,
      handle: object && object.handle,
      joinedAt: object && object.joinedAt
    });
  }
  if (t === LEAVE) {
    return applyLeave(state, { groupId, pubkey });
  }
  if (t === SPEAKING) {
    return applySpeaking(state, {
      groupId,
      pubkey,
      speaking: object && object.speaking !== false
    });
  }
  return { ok: false, error: 'unknown voice type' };
}

function isVoiceType (type) {
  const t = String(type || '');
  return t === JOIN || t === LEAVE || t === SPEAKING;
}

function joinBody (opts = {}) {
  return {
    type: JOIN,
    '@type': JOIN,
    groupId: String(opts.groupId || ''),
    webrtcPeerId: String(opts.webrtcPeerId || webrtcPeerIdFor(opts.pubkey)),
    handle: opts.handle || null,
    joinedAt: Number(opts.joinedAt) || Date.now()
  };
}

function leaveBody (opts = {}) {
  return {
    type: LEAVE,
    '@type': LEAVE,
    groupId: String(opts.groupId || ''),
    webrtcPeerId: opts.webrtcPeerId || webrtcPeerIdFor(opts.pubkey),
    leftAt: Number(opts.leftAt) || Date.now()
  };
}

function speakingBody (opts = {}) {
  return {
    type: SPEAKING,
    '@type': SPEAKING,
    groupId: String(opts.groupId || ''),
    speaking: opts.speaking !== false
  };
}

function shouldOffer (local, remote) {
  if (!local || !remote) return false;
  const a = Number(local.joinedAt) || 0;
  const b = Number(remote.joinedAt) || 0;
  if (a !== b) return a < b;
  return String(local.webrtcPeerId || '') < String(remote.webrtcPeerId || '');
}

module.exports = {
  JOIN,
  LEAVE,
  SPEAKING,
  ROOM_CAP,
  SPEAKING_TTL_MS,
  PUBLIC_ORIGIN: groupVoiceHub.PUBLIC_ORIGIN,
  xOnly,
  webrtcPeerIdFor,
  emptyRooms,
  isMemberOfGroup,
  memberPubkeyFor,
  resolveVoiceActor,
  applyJoin,
  applyLeave,
  applySpeaking,
  listMembers,
  snapshot,
  ingestFrame,
  isVoiceType,
  joinBody,
  leaveBody,
  speakingBody,
  shouldOffer
};
