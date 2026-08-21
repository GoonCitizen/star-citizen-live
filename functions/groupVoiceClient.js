'use strict';

/**
 * Browser fetch helpers for GoonCitizen group voice.
 */

const BASE = '/services/star-citizen';

function headers (opts = {}) {
  const h = { Accept: 'application/json' };
  if (opts.json) h['Content-Type'] = 'application/json';
  if (opts.token) h.Authorization = 'Bearer ' + opts.token;
  return h;
}

async function readJson (res) {
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((json && json.error) || ('HTTP ' + res.status));
  return json;
}

async function fetchVoice (opts = {}) {
  const res = await fetch(BASE + '/voice', { headers: headers(opts) });
  const json = await readJson(res);
  return json.data || json;
}

async function joinVoice (groupId, body = {}, opts = {}) {
  const payload = Object.assign({}, body || {});
  if (opts.pubkey && !payload.pubkey) payload.pubkey = opts.pubkey;
  const res = await fetch(BASE + '/groups/' + encodeURIComponent(groupId) + '/voice/join', {
    method: 'POST',
    headers: headers(Object.assign({ json: true }, opts)),
    body: JSON.stringify(payload)
  });
  const json = await readJson(res);
  return json.data || json;
}

async function leaveVoice (groupId, opts = {}) {
  const path = groupId
    ? (BASE + '/groups/' + encodeURIComponent(groupId) + '/voice/leave')
    : (BASE + '/voice/leave');
  const res = await fetch(path, {
    method: 'POST',
    headers: headers(Object.assign({ json: true }, opts)),
    body: '{}'
  });
  const json = await readJson(res);
  return json.data || json;
}

async function sendVoiceSignal (groupId, toPeerId, signal, opts = {}) {
  const res = await fetch(BASE + '/groups/' + encodeURIComponent(groupId) + '/voice/signal', {
    method: 'POST',
    headers: headers(Object.assign({ json: true }, opts)),
    body: JSON.stringify({ toPeerId, signal })
  });
  return readJson(res);
}

async function fetchVoiceSignals (opts = {}) {
  const res = await fetch(BASE + '/voice/signals', { headers: headers(opts) });
  const json = await readJson(res);
  return json.data || [];
}

async function publishSpeaking (groupId, speaking, opts = {}) {
  const res = await fetch(BASE + '/groups/' + encodeURIComponent(groupId) + '/voice/speaking', {
    method: 'POST',
    headers: headers(Object.assign({ json: true }, opts)),
    body: JSON.stringify({ speaking: !!speaking })
  });
  return readJson(res);
}

module.exports = {
  BASE,
  fetchVoice,
  joinVoice,
  leaveVoice,
  sendVoiceSignal,
  fetchVoiceSignals,
  publishSpeaking
};
