'use strict';

/**
 * Renderer RTCPeerConnection mesh for group voice.
 * ICE/SDP go through Hub SendWebRTCSignal; Opus stays on the peer connection.
 */

const groupVoice = require('./groupVoice');

const ICE_SERVERS = Object.freeze([
  { urls: 'stun:stun.l.google.com:19302' }
]);
const VAD_HANGOVER_MS = 220;
const VAD_TICK_MS = 50;

function rmsFromTimeDomain (buf) {
  if (!buf || !buf.length) return 0;
  let sum = 0;
  for (let i = 0; i < buf.length; i++) {
    const v = (buf[i] - 128) / 128;
    sum += v * v;
  }
  return Math.sqrt(sum / buf.length);
}

class VoiceMesh {
  /**
   * @param {object} opts
   * @param {string} opts.localPeerId Hub WebRTC peer id
   * @param {object} opts.localMember { webrtcPeerId, joinedAt }
   * @param {Function} opts.sendSignal async (toPeerId, signal) => void
   * @param {Function} [opts.getUserMedia]
   * @param {Function} [opts.RTCPeerConnection]
   * @param {object} [opts.audioContext]
   */
  constructor (opts = {}) {
    this.localPeerId = String(opts.localPeerId || '');
    this.localMember = opts.localMember || { webrtcPeerId: this.localPeerId, joinedAt: Date.now() };
    this.sendSignal = opts.sendSignal;
    this.getUserMedia = opts.getUserMedia ||
      (typeof navigator !== 'undefined' && navigator.mediaDevices &&
        navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices));
    this.RTCPeerConnection = opts.RTCPeerConnection ||
      (typeof globalThis !== 'undefined' && globalThis.RTCPeerConnection);
    this.AudioContext = opts.AudioContext ||
      (typeof globalThis !== 'undefined' && (globalThis.AudioContext || globalThis.webkitAudioContext));
    this.onSpeaking = typeof opts.onSpeaking === 'function' ? opts.onSpeaking : null;
    this.iceServers = opts.iceServers || ICE_SERVERS;
    this.pcs = new Map();
    this.localStream = null;
    this.talking = false;
    this.muted = false;
    this.deafened = false;
    this.mode = 'ptt';
    this.vadSensitivity = 0.12;
    this._vadOpen = false;
    this._vadUntil = 0;
    this._vadTimer = null;
    this._analyser = null;
    this._audioCtx = null;
    this._vadBuf = null;
    this.inputDeviceId = opts.inputDeviceId || null;
    this.outputDeviceId = opts.outputDeviceId || null;
    this._stopped = false;
  }

  async ensureMic () {
    if (this.localStream) return this.localStream;
    if (typeof this.getUserMedia !== 'function') {
      throw new Error('microphone is not available');
    }
    const audio = this.inputDeviceId
      ? { deviceId: { exact: this.inputDeviceId }, echoCancellation: true, noiseSuppression: true }
      : { echoCancellation: true, noiseSuppression: true };
    this.localStream = await this.getUserMedia({ audio, video: false });
    this._applySendMute();
    this._setupVad();
    return this.localStream;
  }

  _setupVad () {
    this._teardownVad();
    if (this.mode !== 'vad' || !this.localStream || typeof this.AudioContext !== 'function') return;
    try {
      this._audioCtx = new this.AudioContext();
      const src = this._audioCtx.createMediaStreamSource(this.localStream);
      this._analyser = this._audioCtx.createAnalyser();
      this._analyser.fftSize = 512;
      src.connect(this._analyser);
      this._vadBuf = new Uint8Array(this._analyser.fftSize);
      this._vadTimer = setInterval(() => this._vadTick(), VAD_TICK_MS);
    } catch (_) {
      this._analyser = null;
    }
  }

  _teardownVad () {
    if (this._vadTimer) {
      clearInterval(this._vadTimer);
      this._vadTimer = null;
    }
    this._analyser = null;
    this._vadBuf = null;
    if (this._audioCtx && typeof this._audioCtx.close === 'function') {
      try { this._audioCtx.close(); } catch (_) { /* ignore */ }
    }
    this._audioCtx = null;
    this._vadOpen = false;
  }

  _vadTick () {
    if (!this._analyser || !this._vadBuf) return;
    this._analyser.getByteTimeDomainData(this._vadBuf);
    const level = rmsFromTimeDomain(this._vadBuf);
    const now = Date.now();
    if (level >= this.vadSensitivity) this._vadUntil = now + VAD_HANGOVER_MS;
    const open = now <= this._vadUntil;
    if (open !== this._vadOpen) {
      this._vadOpen = open;
      if (this.onSpeaking) {
        try { this.onSpeaking(open); } catch (_) { /* ignore */ }
      }
    }
    this._applySendMute();
  }

  setMode (mode) {
    this.mode = String(mode || '').toLowerCase() === 'vad' ? 'vad' : 'ptt';
    if (this.mode === 'vad') this._setupVad();
    else this._teardownVad();
    this._applySendMute();
  }

  setTalking (on) {
    const next = !!on;
    if (next === this.talking) {
      this._applySendMute();
      return;
    }
    this.talking = next;
    this._applySendMute();
    if (this.mode === 'ptt' && this.onSpeaking) {
      try { this.onSpeaking(this.talking && !this.muted && !this.deafened); } catch (_) { /* ignore */ }
    }
  }

  setMuted (on) {
    this.muted = !!on;
    this._applySendMute();
  }

  setDeafened (on) {
    this.deafened = !!on;
    this._applySendMute();
    this._applyRecvMute();
  }

  setVadSensitivity (n) {
    const v = Number(n);
    if (Number.isFinite(v)) this.vadSensitivity = Math.min(1, Math.max(0.02, v));
  }

  _wantSend () {
    if (this.muted || this.deafened) return false;
    if (this.mode === 'vad') return this._vadOpen;
    return this.talking;
  }

  _applySendMute () {
    const enabled = this._wantSend();
    const tracks = (this.localStream && this.localStream.getAudioTracks()) || [];
    for (const t of tracks) t.enabled = enabled;
  }

  _applyRecvMute () {
    for (const row of this.pcs.values()) {
      if (row.audio && typeof row.audio.muted === 'boolean') {
        row.audio.muted = this.deafened;
      }
    }
  }

  async syncMembers (members) {
    if (this._stopped) return;
    await this.ensureMic();
    const list = Array.isArray(members) ? members : [];
    const seen = new Set();
    for (const remote of list) {
      const id = String(remote.webrtcPeerId || '');
      if (!id || id === this.localPeerId) continue;
      seen.add(id);
      if (!this.pcs.has(id)) {
        await this._addPeer(remote);
      }
    }
    for (const id of [...this.pcs.keys()]) {
      if (!seen.has(id)) this._closePeer(id);
    }
  }

  async _addPeer (remote) {
    const RTC = this.RTCPeerConnection;
    if (typeof RTC !== 'function') throw new Error('RTCPeerConnection unavailable');
    const id = String(remote.webrtcPeerId);
    const pc = new RTC({ iceServers: this.iceServers });
    const row = { pc, remote, audio: null };
    this.pcs.set(id, row);

    pc.onicecandidate = (ev) => {
      if (!ev || !ev.candidate) return;
      this._emit(id, { type: 'ice', candidate: ev.candidate });
    };
    pc.ontrack = (ev) => {
      const stream = ev && ev.streams && ev.streams[0];
      if (!stream || typeof document === 'undefined') return;
      let audio = row.audio;
      if (!audio) {
        audio = document.createElement('audio');
        audio.autoplay = true;
        audio.playsInline = true;
        row.audio = audio;
      }
      audio.srcObject = stream;
      audio.muted = this.deafened;
      if (this.outputDeviceId && typeof audio.setSinkId === 'function') {
        audio.setSinkId(this.outputDeviceId).catch(() => {});
      }
    };

    const stream = this.localStream;
    if (stream) {
      for (const track of stream.getAudioTracks()) {
        pc.addTrack(track, stream);
      }
    }

    if (groupVoice.shouldOffer(this.localMember, remote)) {
      const offer = await pc.createOffer({ offerToReceiveAudio: true, offerToReceiveVideo: false });
      await pc.setLocalDescription(offer);
      this._emit(id, { type: 'sdp', sdp: pc.localDescription });
    }
  }

  _emit (toPeerId, signal) {
    if (typeof this.sendSignal !== 'function') return;
    Promise.resolve(this.sendSignal(toPeerId, signal)).catch(() => {});
  }

  async handleSignal (fromPeerId, signal) {
    if (this._stopped || !signal) return;
    const id = String(fromPeerId || '');
    if (!id) return;
    let row = this.pcs.get(id);
    if (!row) {
      await this._addPeer({ webrtcPeerId: id, joinedAt: Date.now() + 1 });
      row = this.pcs.get(id);
    }
    if (!row) return;
    const pc = row.pc;
    if (signal.type === 'sdp' && signal.sdp) {
      const desc = signal.sdp;
      await pc.setRemoteDescription(desc);
      if (desc.type === 'offer') {
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        this._emit(id, { type: 'sdp', sdp: pc.localDescription });
      }
      return;
    }
    if (signal.type === 'ice' && signal.candidate && typeof pc.addIceCandidate === 'function') {
      try { await pc.addIceCandidate(signal.candidate); } catch (_) { /* ignore */ }
    }
  }

  _closePeer (id) {
    const row = this.pcs.get(id);
    this.pcs.delete(id);
    if (!row) return;
    try { row.pc.close(); } catch (_) { /* ignore */ }
    if (row.audio && row.audio.srcObject) row.audio.srcObject = null;
  }

  stop () {
    this._stopped = true;
    this._teardownVad();
    for (const id of [...this.pcs.keys()]) this._closePeer(id);
    if (this.localStream) {
      for (const t of this.localStream.getTracks()) {
        try { t.stop(); } catch (_) { /* ignore */ }
      }
      this.localStream = null;
    }
  }
}

module.exports = {
  VoiceMesh,
  ICE_SERVERS,
  VAD_HANGOVER_MS,
  rmsFromTimeDomain
};
