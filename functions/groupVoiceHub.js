'use strict';

/**
 * GoonCitizen client of the public Hub WebRTC coordinator.
 * Signaling only — Hub never terminates RTP. Production origin is
 * https://hub.fabric.pub (override FABRIC_HUB_ORIGIN for local Hub).
 * Distinct peer ids (`gv-` + x-only) so cluster LAN RegisterWebRTCPeer is not overwritten.
 */

const clusterMesh = require('./clusterMesh');
const groupVoiceSettings = require('./groupVoiceSettings');

let webrtcInterop = null;
try {
  webrtcInterop = require('@fabric/http/functions/fabricWebRtcInterop');
} catch (_) {
  webrtcInterop = null;
}

const PUBLIC_ORIGIN = 'https://hub.fabric.pub';
const KIND = 'gooncitizen-group-voice';
const APP = 'gooncitizen';

/**
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {string}
 */
function coordinatorOrigin (env) {
  const e = env || process.env;
  const raw = String(e.FABRIC_HUB_ORIGIN || e.FABRIC_VOICE_HUB || '').trim();
  if (raw) {
    try {
      const u = new URL(raw);
      if (u.protocol === 'https:' || u.protocol === 'http:') return u.origin;
    } catch (_) { /* fall through */ }
  }
  return PUBLIC_ORIGIN;
}

function signalingWebSocketUrl (origin) {
  if (webrtcInterop && typeof webrtcInterop.fabricSignalingWebSocketUrl === 'function') {
    return webrtcInterop.fabricSignalingWebSocketUrl(origin, '/');
  }
  try {
    const u = new URL(origin);
    const ws = u.protocol === 'https:' ? 'wss:' : 'ws:';
    const port = u.port ? (':' + u.port) : '';
    return ws + '//' + u.hostname + port + '/';
  } catch (_) {
    return null;
  }
}

function voiceMetadata (opts = {}) {
  return {
    app: APP,
    kind: KIND,
    pubkey: String(opts.pubkey || '').trim(),
    groupId: String(opts.groupId || '').trim() || null,
    room: String(opts.groupId || '').trim() || null
  };
}

function isVoiceMeta (meta) {
  if (!meta || typeof meta !== 'object') return false;
  return meta.kind === KIND || (meta.app === APP && meta.kind === KIND);
}

async function hubRpc (origin, method, params, fetchImpl) {
  return clusterMesh.hubRpc(origin, method, params, fetchImpl);
}

async function registerVoicePeer (origin, opts = {}, fetchImpl) {
  const peerId = String(opts.peerId || '').trim();
  if (!peerId) throw new Error('peerId required');
  return hubRpc(origin, 'RegisterWebRTCPeer', {
    peerId,
    metadata: voiceMetadata(opts)
  }, fetchImpl);
}

async function listVoicePeers (origin, opts = {}, fetchImpl) {
  const peerId = String(opts.peerId || '').trim();
  const result = await hubRpc(origin, 'ListWebRTCPeers', {
    excludeSelf: opts.excludeSelf !== false,
    peerId
  }, fetchImpl);
  const peers = Array.isArray(result) ? result
    : (result && Array.isArray(result.peers) ? result.peers : []);
  return peers.filter((row) => isVoiceMeta((row && row.metadata) || {}));
}

async function sendWebRTCSignal (origin, opts = {}, fetchImpl) {
  const fromPeerId = String(opts.fromPeerId || '').trim();
  const toPeerId = String(opts.toPeerId || '').trim();
  const signal = opts.signal;
  if (!fromPeerId || !toPeerId || !signal) {
    throw new Error('fromPeerId, toPeerId, and signal are required');
  }
  const wrapped = attachSignalMeta(opts.session || newSignalSession(fromPeerId), signal);
  return hubRpc(origin, 'SendWebRTCSignal', {
    fromPeerId,
    toPeerId,
    signal: wrapped
  }, fetchImpl);
}

function attachSignalMeta (session, signal) {
  if (!session) return signal;
  if (webrtcInterop && typeof webrtcInterop.attachFabricSignalMeta === 'function') {
    return webrtcInterop.attachFabricSignalMeta(session, signal);
  }
  session.localSignalRevision = (session.localSignalRevision || 0) + 1;
  return Object.assign({}, signal, {
    _fabric: {
      protocol: (webrtcInterop && webrtcInterop.FABRIC_WEBRTC_SIGNAL_PROTOCOL) || 'fabric-webrtc-v2',
      sessionId: session.localSessionId || null,
      targetSessionId: session.remoteSessionId || null,
      revision: session.localSignalRevision
    }
  });
}

function newSignalSession (peerId) {
  return {
    localSessionId: String(peerId || 'gv') + ':' + Date.now().toString(36),
    remoteSessionId: null,
    localSignalRevision: 0
  };
}

/**
 * Pull a WebRTCSignal out of a Hub JSONCall / JSONCallResult body.
 * @param {*} payload
 * @returns {{ fromPeerId: string, toPeerId: string, signal: object }|null}
 */
function extractWebRTCSignal (payload) {
  if (!payload || typeof payload !== 'object') return null;
  if (payload.type === 'WebRTCSignal' && payload.signal) {
    return {
      fromPeerId: String(payload.fromPeerId || ''),
      toPeerId: String(payload.toPeerId || ''),
      signal: payload.signal
    };
  }
  if (payload.method === 'JSONCallResult') {
    const result = Array.isArray(payload.params)
      ? payload.params[payload.params.length - 1]
      : (payload.result || null);
    return extractWebRTCSignal(result);
  }
  if (payload.method === 'JSONCall' && payload.params) {
    const inner = Array.isArray(payload.params) ? payload.params[0] : payload.params;
    return extractWebRTCSignal(inner);
  }
  return null;
}

function parseHubMessageBuffer (buf, Message) {
  if (!Message || typeof Message.fromBuffer !== 'function') return null;
  try {
    const msg = Message.fromBuffer(Buffer.isBuffer(buf) ? buf : Buffer.from(buf));
    let body = msg && (msg.body != null ? msg.body : msg.object);
    if (Buffer.isBuffer(body)) body = body.toString('utf8');
    if (typeof body === 'string') {
      try { body = JSON.parse(body); } catch (_) { return null; }
    }
    const type = msg && (msg.type || msg['@type']);
    if (type === 'JSONCall' || type === 'JSON_CALL') return extractWebRTCSignal(body);
    return extractWebRTCSignal(body);
  } catch (_) {
    return null;
  }
}

/**
 * Hub WebRTC signaling session: HTTP JSON-RPC send + optional WS receive.
 */
class HubSignalingSession {
  constructor (opts = {}) {
    this.origin = coordinatorOrigin(opts.env);
    this.peerId = String(opts.peerId || '').trim();
    this.fetchImpl = opts.fetch || globalThis.fetch;
    this.WebSocket = opts.WebSocket || globalThis.WebSocket;
    this.Message = opts.Message || null;
    this.onSignal = typeof opts.onSignal === 'function' ? opts.onSignal : null;
    this._ws = null;
    this._queue = [];
    this.session = newSignalSession(this.peerId);
  }

  drain () {
    const q = this._queue;
    this._queue = [];
    return q;
  }

  push (sig) {
    if (!sig || !sig.signal) return;
    this._queue.push(sig);
    if (this._queue.length > 64) this._queue.shift();
    if (this.onSignal) {
      try { this.onSignal(sig); } catch (_) { /* ignore */ }
    }
  }

  ingestPayload (payload) {
    const sig = extractWebRTCSignal(payload);
    if (!sig) return false;
    if (sig.toPeerId && this.peerId && sig.toPeerId !== this.peerId) return false;
    this.push(sig);
    return true;
  }

  ingestBuffer (buf) {
    const sig = parseHubMessageBuffer(buf, this.Message);
    if (!sig) return false;
    if (sig.toPeerId && this.peerId && sig.toPeerId !== this.peerId) return false;
    this.push(sig);
    return true;
  }

  async register (meta) {
    return registerVoicePeer(this.origin, Object.assign({ peerId: this.peerId }, meta), this.fetchImpl);
  }

  async send (toPeerId, signal) {
    return sendWebRTCSignal(this.origin, {
      fromPeerId: this.peerId,
      toPeerId,
      signal,
      session: this.session
    }, this.fetchImpl);
  }

  async connect () {
    const WS = this.WebSocket;
    const url = signalingWebSocketUrl(this.origin);
    if (!WS || !url) return false;
    await new Promise((resolve, reject) => {
      try {
        const ws = new WS(url);
        this._ws = ws;
        const done = (err) => {
          if (err) reject(err);
          else resolve(true);
        };
        const timer = setTimeout(() => done(new Error('hub signaling ws timeout')), 8000);
        const on = (ev, fn) => {
          if (typeof ws.addEventListener === 'function') ws.addEventListener(ev, fn);
          else if (typeof ws.on === 'function') ws.on(ev, fn);
        };
        on('open', () => {
          clearTimeout(timer);
          done();
        });
        on('error', () => {
          clearTimeout(timer);
          done(new Error('hub signaling ws error'));
        });
        on('message', (ev) => {
          const data = ev && ev.data != null ? ev.data : ev;
          this.ingestBuffer(data);
        });
        on('close', () => {
          if (this._ws === ws) this._ws = null;
        });
      } catch (e) {
        reject(e);
      }
    }).catch(() => false);
    return !!this._ws;
  }

  close () {
    const ws = this._ws;
    this._ws = null;
    if (ws && typeof ws.close === 'function') {
      try { ws.close(); } catch (_) { /* ignore */ }
    }
  }
}

module.exports = {
  PUBLIC_ORIGIN,
  KIND,
  APP,
  coordinatorOrigin,
  signalingWebSocketUrl,
  voiceMetadata,
  isVoiceMeta,
  hubRpc,
  registerVoicePeer,
  listVoicePeers,
  sendWebRTCSignal,
  attachSignalMeta,
  newSignalSession,
  extractWebRTCSignal,
  parseHubMessageBuffer,
  HubSignalingSession,
  sanitizeVoiceSettings: groupVoiceSettings.sanitizeVoiceSettings
};
