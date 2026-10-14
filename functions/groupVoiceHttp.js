'use strict';

/**
 * LiveRelay HTTP + Hub signaling for group voice.
 * Presence is Fabric CONTRACT_MESSAGE; ICE is Hub SendWebRTCSignal.
 */

const groupVoice = require('./groupVoice');
const groupVoiceHub = require('./groupVoiceHub');
const groupVoiceSettings = require('./groupVoiceSettings');

function ensureState (relay) {
  if (!relay._voiceState) relay._voiceState = groupVoice.emptyRooms();
  if (!relay._voiceSettings) {
    relay._voiceSettings = groupVoiceSettings.defaultVoiceSettings();
  }
  return relay._voiceState;
}

function actorOf (relay, viewer) {
  return viewer || (relay._identity && relay._identity.pubkey) || null;
}

function actorCandidates (relay, viewer, claimed, remoteAuth) {
  const out = [];
  const add = (pk) => {
    const s = String(pk || '').trim();
    if (s) out.push(s);
  };
  add(viewer);
  if (!remoteAuth) {
    add(claimed);
    add(relay._unlockedPubkey);
  }
  add(relay._identity && relay._identity.pubkey);
  return out;
}

function voiceActor (relay, group, viewer, claimed, remoteAuth) {
  const gm = relay.groupManager;
  const sameActor = gm && typeof gm.sameActor === 'function'
    ? gm.sameActor.bind(gm)
    : null;
  return groupVoice.resolveVoiceActor(
    group,
    actorCandidates(relay, viewer, claimed, remoteAuth),
    sameActor
  );
}

function localActor (relay, viewer) {
  return (relay._voiceState && relay._voiceState.local && relay._voiceState.local.pubkey)
    || actorOf(relay, viewer);
}

function snapshotOf (relay) {
  const state = ensureState(relay);
  return Object.assign(groupVoice.snapshot(state, {
    hubOrigin: groupVoiceHub.coordinatorOrigin(process.env)
  }), {
    settings: relay._voiceSettings || groupVoiceSettings.defaultVoiceSettings()
  });
}

function publishVoice (relay, group, type, body) {
  const net = relay.fabricNetwork;
  if (!net || typeof net.publishGroupVoice !== 'function') return null;
  const contractId = group && group.contractId;
  if (!contractId) return null;
  try {
    return net.publishGroupVoice(contractId, type, body);
  } catch (_) {
    return null;
  }
}

async function ensureHubSession (relay, peerId) {
  if (relay._voiceHub && relay._voiceHub.peerId === peerId) return relay._voiceHub;
  if (relay._voiceHub && typeof relay._voiceHub.close === 'function') {
    try { relay._voiceHub.close(); } catch (_) { /* ignore */ }
  }
  let Message = null;
  try { Message = require('@fabric/core/types/message'); } catch (_) { Message = null; }
  const session = new groupVoiceHub.HubSignalingSession({
    peerId,
    fetch: relay.settings && relay.settings.voiceHubFetch,
    WebSocket: relay.settings && relay.settings.voiceHubWebSocket,
    Message,
    env: process.env
  });
  relay._voiceHub = session;
  const pubkey = relay._identity && relay._identity.pubkey;
  const local = ensureState(relay).local;
  try {
    await session.register({
      pubkey,
      groupId: local.groupId
    });
  } catch (_) { /* Hub unreachable — presence still works */ }
  try { await session.connect(); } catch (_) { /* HTTP send still works */ }
  return session;
}

function closeHubSession (relay) {
  if (relay._voiceHub && typeof relay._voiceHub.close === 'function') {
    try { relay._voiceHub.close(); } catch (_) { /* ignore */ }
  }
  relay._voiceHub = null;
}

async function localJoin (relay, group, actor, handle) {
  const state = ensureState(relay);
  if (state.local.groupId && state.local.groupId !== group.id) {
    await localLeave(relay, actor, { silent: false });
  }
  const webrtcPeerId = groupVoice.webrtcPeerIdFor(actor);
  const joinedAt = Date.now();
  const applied = groupVoice.applyJoin(state, {
    groupId: group.id,
    pubkey: actor,
    group,
    webrtcPeerId,
    handle,
    joinedAt
  });
  if (!applied.ok) return applied;
  state.local = {
    groupId: group.id,
    groupName: group.name || null,
    webrtcPeerId,
    pubkey: actor,
    joinedAt
  };
  publishVoice(relay, group, groupVoice.JOIN, groupVoice.joinBody({
    groupId: group.id,
    pubkey: actor,
    webrtcPeerId,
    handle,
    joinedAt
  }));
  await ensureHubSession(relay, webrtcPeerId);
  return { ok: true, voice: snapshotOf(relay) };
}

async function localLeave (relay, actor, opts = {}) {
  const state = ensureState(relay);
  const groupId = state.local.groupId;
  if (!groupId) return { ok: true, voice: snapshotOf(relay) };
  const gm = relay.groupManager;
  const group = gm && typeof gm.findGroup === 'function' ? gm.findGroup(groupId) : null;
  groupVoice.applyLeave(state, { groupId, pubkey: actor });
  if (!opts.silent && group) {
    publishVoice(relay, group, groupVoice.LEAVE, groupVoice.leaveBody({
      groupId,
      pubkey: actor,
      webrtcPeerId: state.local.webrtcPeerId
    }));
  }
  state.local = { groupId: null, groupName: null, webrtcPeerId: null, pubkey: null, joinedAt: 0 };
  closeHubSession(relay);
  return { ok: true, voice: snapshotOf(relay) };
}

function ingest (relay, type, object, signer, meta) {
  const state = ensureState(relay);
  const groupId = String((object && object.groupId) || (meta && meta.groupId) || '').trim();
  const gm = relay.groupManager;
  const group = (gm && groupId && typeof gm.findGroup === 'function') ? gm.findGroup(groupId) : null;
  return groupVoice.ingestFrame(state, type, object, signer, { group, groupId });
}

/**
 * @returns {Promise<boolean>} true when the request was handled
 */
async function tryHandleGroupVoice (relay, ctx) {
  const { base, pathname, req, send, body, requireAuth, viewer, gm, remoteAuth } = ctx;
  const method = req.method;

  if (pathname === `${base}/voice` && method === 'GET') {
    if (!requireAuth()) return true;
    ensureState(relay);
    send(200, { type: 'GroupVoice', data: snapshotOf(relay) });
    return true;
  }

  if (pathname === `${base}/voice/signals` && method === 'GET') {
    if (!requireAuth()) return true;
    const fromSession = (relay._voiceHub && relay._voiceHub.drain()) || [];
    send(200, { type: 'GroupVoiceSignals', data: fromSession });
    return true;
  }

  if (pathname === `${base}/voice/leave` && method === 'POST') {
    if (!requireAuth()) return true;
    const actor = localActor(relay, viewer);
    if (!actor) {
      send(401, { error: 'Unlock your identity' });
      return true;
    }
    const out = await localLeave(relay, actor);
    send(200, { type: 'GroupVoice', data: out.voice });
    return true;
  }

  if (pathname === `${base}/voice/ptt` && method === 'POST') {
    if (!requireAuth()) return true;
    const actor = localActor(relay, viewer);
    if (!actor) {
      send(401, { error: 'Unlock your identity' });
      return true;
    }
    const state = ensureState(relay);
    const d = await body();
    const groupId = state.local.groupId;
    if (!groupId) {
      send(409, { error: 'not in a voice room' });
      return true;
    }
    const group = gm && gm.findGroup(groupId);
    groupVoice.applySpeaking(state, {
      groupId,
      pubkey: actor,
      speaking: d.speaking !== false && d.held !== false
    });
    if (group) {
      publishVoice(relay, group, groupVoice.SPEAKING, groupVoice.speakingBody({
        groupId,
        speaking: d.speaking !== false && d.held !== false
      }));
    }
    send(200, { type: 'GroupVoice', data: snapshotOf(relay) });
    return true;
  }

  const match = pathname.match(new RegExp(
    '^' + String(base).replace(/[.*+?^${}()|[\]\\]/g, '\\$&') +
    '/groups/([^/]+)/voice(?:/(join|leave|signal|speaking))?$'
  ));
  if (!match) return false;
  if (!gm) {
    send(503, { error: 'Group system not available' });
    return true;
  }
  if (!requireAuth()) return true;
  const group = gm.findGroup(decodeURIComponent(match[1]));
  if (!group) {
    send(404, { error: 'Group not found' });
    return true;
  }
  const action = match[2] || '';
  let postBody = null;
  const readBody = async () => {
    if (postBody !== null) return postBody;
    postBody = await body().catch(() => ({}));
    return postBody || {};
  };
  const claimed = (!remoteAuth && method === 'POST' && action === 'join')
    ? (await readBody()).pubkey
    : null;
  const actor = voiceActor(relay, group, viewer, claimed, remoteAuth);
  if (!actor) {
    if (!viewer && !actorOf(relay, viewer) && !relay._unlockedPubkey) {
      send(401, { error: 'Unlock your identity' });
      return true;
    }
    send(403, { error: 'forbidden: members only' });
    return true;
  }

  if (method === 'GET' && !action) {
    const snap = snapshotOf(relay);
    const room = ensureState(relay).rooms[group.id];
    snap.groupId = group.id;
    snap.groupName = group.name || snap.groupName;
    snap.members = groupVoice.listMembers(room);
    snap.joined = ensureState(relay).local.groupId === group.id;
    send(200, { type: 'GroupVoice', data: snap });
    return true;
  }

  if (method === 'POST' && action === 'join') {
    const d = await readBody();
    const handle = (d && d.handle) || relay._nickname || null;
    const out = await localJoin(relay, group, actor, handle);
    if (!out.ok) {
      const code = /full/.test(out.error || '') ? 409 : 400;
      send(code, { error: out.error });
      return true;
    }
    send(200, { type: 'GroupVoice', data: out.voice });
    return true;
  }

  if (method === 'POST' && action === 'leave') {
    const state = ensureState(relay);
    if (state.local.groupId && state.local.groupId !== group.id) {
      send(409, { error: 'joined to a different room' });
      return true;
    }
    const out = await localLeave(relay, localActor(relay, actor));
    send(200, { type: 'GroupVoice', data: out.voice });
    return true;
  }

  if (method === 'POST' && action === 'signal') {
    const d = await body();
    const toPeerId = String((d && (d.toPeerId || d.to)) || '').trim();
    const signal = d && d.signal;
    if (!toPeerId || !signal) {
      send(400, { error: 'toPeerId and signal required' });
      return true;
    }
    const state = ensureState(relay);
    if (state.local.groupId !== group.id) {
      send(409, { error: 'join this room first' });
      return true;
    }
    try {
      const session = await ensureHubSession(relay, state.local.webrtcPeerId);
      await session.send(toPeerId, signal);
      send(200, { type: 'GroupVoiceSignal', data: { ok: true } });
      return true;
    } catch (e) {
      send(502, { error: (e && e.message) || 'Hub signaling failed' });
      return true;
    }
  }

  if (method === 'POST' && action === 'speaking') {
    const d = await body();
    const state = ensureState(relay);
    if (state.local.groupId !== group.id) {
      send(409, { error: 'join this room first' });
      return true;
    }
    groupVoice.applySpeaking(state, {
      groupId: group.id,
      pubkey: localActor(relay, actor),
      speaking: d.speaking !== false
    });
    publishVoice(relay, group, groupVoice.SPEAKING, groupVoice.speakingBody({
      groupId: group.id,
      speaking: d.speaking !== false
    }));
    send(200, { type: 'GroupVoice', data: snapshotOf(relay) });
    return true;
  }

  return false;
}

module.exports = {
  ensureState,
  snapshotOf,
  ingest,
  localJoin,
  localLeave,
  closeHubSession,
  tryHandleGroupVoice
};
