'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { VoiceMesh, rmsFromTimeDomain } = require('../../functions/groupVoiceRtc');

function mockPC () {
  const pc = {
    localDescription: null,
    remoteDescription: null,
    onicecandidate: null,
    ontrack: null,
    tracks: [],
    closed: false,
    addTrack (track, stream) { this.tracks.push({ track, stream }); },
    async createOffer () { return { type: 'offer', sdp: 'offer' }; },
    async createAnswer () { return { type: 'answer', sdp: 'answer' }; },
    async setLocalDescription (d) { this.localDescription = d; },
    async setRemoteDescription (d) { this.remoteDescription = d; },
    async addIceCandidate () {},
    close () { this.closed = true; }
  };
  return pc;
}

describe('groupVoiceRtc', () => {
  it('computes RMS for VAD', () => {
    const silent = new Uint8Array(8).fill(128);
    const loud = new Uint8Array(8).fill(255);
    assert.equal(rmsFromTimeDomain(silent), 0);
    assert.ok(rmsFromTimeDomain(loud) > 0.5);
  });

  it('offers from the earlier joiner and mutes the mic until PTT', async () => {
    const signals = [];
    const pcs = [];
    const RTC = function () {
      const pc = mockPC();
      pcs.push(pc);
      return pc;
    };
    const track = { enabled: true, stop () {} };
    const mesh = new VoiceMesh({
      localPeerId: 'gv-a',
      localMember: { webrtcPeerId: 'gv-a', joinedAt: 1 },
      RTCPeerConnection: RTC,
      getUserMedia: async () => ({
        getAudioTracks: () => [track],
        getTracks: () => [track]
      }),
      sendSignal: async (to, signal) => { signals.push({ to, signal }); }
    });
    mesh.setTalking(false);
    await mesh.syncMembers([
      { webrtcPeerId: 'gv-a', joinedAt: 1 },
      { webrtcPeerId: 'gv-b', joinedAt: 2 }
    ]);
    assert.equal(track.enabled, false);
    mesh.setTalking(true);
    assert.equal(track.enabled, true);
    assert.equal(pcs.length, 1);
    assert.ok(signals.some((s) => s.to === 'gv-b' && s.signal.type === 'sdp'));
    mesh.stop();
    assert.equal(pcs[0].closed, true);
  });
});
