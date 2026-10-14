'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const groupVoiceHub = require('../../functions/groupVoiceHub');

describe('groupVoiceHub', () => {
  it('uses public hub.fabric.pub unless FABRIC_HUB_ORIGIN is set', () => {
    assert.equal(groupVoiceHub.PUBLIC_ORIGIN, 'https://hub.fabric.pub');
    assert.equal(groupVoiceHub.coordinatorOrigin({}), 'https://hub.fabric.pub');
    assert.equal(
      groupVoiceHub.coordinatorOrigin({ FABRIC_HUB_ORIGIN: 'http://127.0.0.1:8080/' }),
      'http://127.0.0.1:8080'
    );
  });

  it('does not treat cluster LAN metadata as voice peers', () => {
    assert.equal(groupVoiceHub.isVoiceMeta({ kind: 'gooncitizen-cluster' }), false);
    assert.equal(groupVoiceHub.isVoiceMeta({ app: 'gooncitizen', kind: 'gooncitizen-group-voice' }), true);
  });

  it('registers and signals through Hub JSON-RPC', async () => {
    const calls = [];
    const fetchImpl = async (url, opts) => {
      const body = JSON.parse(opts.body);
      calls.push({ url, method: body.method, params: body.params });
      return {
        ok: true,
        json: async () => ({ jsonrpc: '2.0', id: 1, result: { status: 'success' } })
      };
    };
    await groupVoiceHub.registerVoicePeer('https://hub.fabric.pub', {
      peerId: 'gv-aa',
      pubkey: '02' + 'aa'.repeat(32),
      groupId: 'g1'
    }, fetchImpl);
    await groupVoiceHub.sendWebRTCSignal('https://hub.fabric.pub', {
      fromPeerId: 'gv-aa',
      toPeerId: 'gv-bb',
      signal: { type: 'sdp', sdp: { type: 'offer', sdp: 'v=0' } }
    }, fetchImpl);
    assert.equal(calls[0].url, 'https://hub.fabric.pub/services/rpc');
    assert.equal(calls[0].method, 'RegisterWebRTCPeer');
    assert.equal(calls[0].params[0].metadata.kind, 'gooncitizen-group-voice');
    assert.equal(calls[1].method, 'SendWebRTCSignal');
    assert.equal(calls[1].params[0].signal._fabric.protocol, 'fabric-webrtc-v2');
  });

  it('extracts WebRTCSignal from a Hub JSONCallResult body', () => {
    const sig = groupVoiceHub.extractWebRTCSignal({
      method: 'JSONCallResult',
      params: [null, {
        type: 'WebRTCSignal',
        fromPeerId: 'gv-a',
        toPeerId: 'gv-b',
        signal: { type: 'ice', candidate: { candidate: 'typ host' } }
      }]
    });
    assert.equal(sig.fromPeerId, 'gv-a');
    assert.equal(sig.toPeerId, 'gv-b');
    assert.equal(sig.signal.type, 'ice');
  });
});
