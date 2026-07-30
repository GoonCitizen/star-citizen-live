'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');

const LiveRelay = require('../../services/LiveRelay');
const peerProfile = require('../../functions/peerProfile');
const hubPeeringObserve = require('../../functions/hubPeeringObserve');
const { createIdentity } = require('../../functions/identity');

function tmpDir (prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function request (port, method, reqPath, payload) {
  return new Promise((resolve, reject) => {
    const headers = { 'Content-Type': 'application/json' };
    const req = http.request({ host: '127.0.0.1', port, method, path: reqPath, headers }, (res) => {
      let buf = '';
      res.on('data', (c) => { buf += c; });
      res.on('end', () => resolve({ status: res.statusCode, body: buf ? JSON.parse(buf) : null }));
    });
    req.on('error', reject);
    if (payload) req.write(JSON.stringify(payload));
    req.end();
  });
}

test('sanitizeProfile and peeringAddressesFromObject', () => {
  assert.strictEqual(peerProfile.sanitizeProfile(null), null);
  assert.deepStrictEqual(peerProfile.sanitizeProfile({ bio: '  hello  ', scHandle: 'Neorion' }), {
    bio: 'hello',
    scHandle: 'Neorion'
  });
  const addrs = peerProfile.peeringAddressesFromObject({
    host: 'peer.example',
    port: 7777,
    peers: ['other.example:7778', { host: 'third.example', port: 7779 }]
  });
  assert.ok(addrs.includes('peer.example:7777'));
  assert.ok(addrs.includes('other.example:7778'));
  assert.ok(addrs.includes('third.example:7779'));
});

test('observeHubPeering parses peering claims via fetch stub', async () => {
  const fetchStub = async (url) => {
    assert.ok(String(url).endsWith('/services/peering'));
    return {
      ok: true,
      status: 200,
      json: async () => ({
        available: true,
        oracleAttestation: {
          claim: {
            kind: 'PeeringCapability',
            fabricPeerId: 'abc',
            hub: { alias: '@fabric/hub' },
            p2p: { connections: 4, maxPeers: 32, listening: true },
            webrtc: { registeredPeers: 7, signaling: ['ListWebRTCPeers'] }
          }
        }
      })
    };
  };
  const snap = await hubPeeringObserve.observeHubPeering(['https://hub.fabric.pub'], { fetch: fetchStub });
  assert.strictEqual(snap.summary.online, 1);
  assert.strictEqual(snap.summary.webrtcRegistered, 7);
  assert.strictEqual(snap.hubs[0].p2pConnections, 4);
});

test('GET /peers/:id returns local profile detail + profile settings', async () => {
  const dir = tmpDir('sc-profile-');
  const id = createIdentity();
  const svc = new LiveRelay({
    port: 0,
    settingsDir: dir,
    peers: [{ address: 'hub.fabric.pub:7777', label: 'hub' }],
    fabric: { enable: false }
  });
  await svc.start();
  try {
    svc.setIdentity(id);
    const port = svc.server.address().port;
    await request(port, 'PUT', '/settings/nickname', { value: 'PilotOne' });
    await request(port, 'PUT', '/settings/profile', {
      value: { bio: 'Flying with GoonCitizen', scHandle: 'PilotOne' }
    });
    const profile = await request(port, 'GET', '/profile');
    assert.strictEqual(profile.status, 200);
    assert.strictEqual(profile.body.data.nickname, 'PilotOne');
    assert.strictEqual(profile.body.data.scHandle, 'PilotOne');
    assert.strictEqual(profile.body.data.bio, 'Flying with GoonCitizen');

    const peers = await request(port, 'GET', '/peers');
    assert.strictEqual(peers.status, 200);
    const hub = peers.body.data.find((p) => p.address === 'hub.fabric.pub:7777');
    assert.ok(hub);
    const detail = await request(port, 'GET', `/peers/${hub.id}`);
    assert.strictEqual(detail.status, 200);
    assert.ok(detail.body.data.peer);
    assert.strictEqual(detail.body.data.peer.address, 'hub.fabric.pub:7777');

    // Self profile is visible via /profile even when inspecting hubs.
    assert.strictEqual(svc._localProfile().nickname, 'PilotOne');

    // Gossip discovery promotes non-hub peers onto the roster (logs off).
    svc._considerDiscoveredPeers(['wingmate.example:7777', 'hub.fabric.pub:7777'], 'gossip');
    assert.ok(svc.peers.some((p) => p.address === 'wingmate.example:7777' && p.discovered === true));
    assert.strictEqual(svc.peers.filter((p) => p.address === 'hub.fabric.pub:7777').length, 1);
  } finally {
    await svc.stop();
  }
});
