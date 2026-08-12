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

test('peerPeeringString builds pubkey@host:port for GoonCitizen rows', () => {
  const peerPeeringString = require('../../functions/peerPeeringString');
  const hex = `02${'cd'.repeat(32)}`;
  const info = peerPeeringString.peeringInfoForGoonCitizen({
    pubkey: hex,
    peer: { address: 'wing.example:7777', pubkey: hex }
  });
  assert.strictEqual(info.string, `${hex}@wing.example:7777`);
  assert.strictEqual(info.signaling, false);

  const selfInfo = peerPeeringString.peeringInfoForGoonCitizen({
    pubkey: hex,
    advertiseHost: 'public.example',
    listenPort: 7777
  });
  assert.strictEqual(selfInfo.string, `${hex}@public.example:7777`);
});

test('parsePeerDialInput accepts host:port and pubkey@host:port', () => {
  const peerPeeringString = require('../../functions/peerPeeringString');
  const hex = `02${'ab'.repeat(32)}`;
  assert.deepStrictEqual(peerPeeringString.parsePeerDialInput('relay.goon.vc:7777'), {
    address: 'relay.goon.vc:7777',
    pubkey: null
  });
  assert.deepStrictEqual(peerPeeringString.parsePeerDialInput(`${hex}@wing.example:7777`), {
    address: 'wing.example:7777',
    pubkey: hex
  });
  assert.strictEqual(peerPeeringString.parsePeerDialInput('not-a-peer'), null);
  assert.strictEqual(peerPeeringString.parsePeerDialInput('bad@host'), null);
  assert.strictEqual(peerPeeringString.parsePeerDialInput(''), null);
});

test('POST /peers accepts pubkey@host:port dial pins', async () => {
  const dir = tmpDir('sc-dial-');
  const hex = `02${'ef'.repeat(32)}`;
  const svc = new LiveRelay({
    port: 0,
    settingsDir: dir,
    peers: [],
    fabric: { enable: false }
  });
  await svc.start();
  try {
    const port = svc.server.address().port;
    const res = await request(port, 'POST', '/peers', {
      address: `${hex}@wingmate.example:7777`,
      label: 'wing'
    });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.data.address, 'wingmate.example:7777');
    assert.strictEqual(res.body.data.expectedPubkey, hex);
    const list = await request(port, 'GET', '/peers');
    const row = list.body.data.find((p) => p.address === 'wingmate.example:7777');
    assert.ok(row);
    assert.strictEqual(row.expectedPubkey, hex);
  } finally {
    await svc.stop();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('broadcastPeering setting gates announce; POST /peers/announce needs advertise host', async () => {
  const dir = tmpDir('sc-announce-');
  const id = createIdentity();
  const svc = new LiveRelay({
    port: 0,
    settingsDir: dir,
    peers: [],
    fabric: { enable: false }
  });
  await svc.start();
  try {
    svc.setIdentity(id);
    const port = svc.server.address().port;
    const settings = await request(port, 'GET', '/settings');
    assert.ok(settings.body.allowedKeys.includes('broadcastPeering'));
    assert.strictEqual(settings.body.runtime.broadcastPeering, false);

    const put = await request(port, 'PUT', '/settings/broadcastPeering', { value: true });
    assert.strictEqual(put.status, 200);
    assert.strictEqual(put.body.settings.broadcastPeering, true);

    const announceNoHost = await request(port, 'POST', '/peers/announce');
    assert.strictEqual(announceNoHost.status, 400);
    assert.match(announceNoHost.body.error || '', /fabricAdvertiseHost/i);

    await request(port, 'PUT', '/settings/fabricAdvertiseHost', { value: 'public.example' });
    const after = await request(port, 'GET', '/settings');
    assert.strictEqual(after.body.runtime.fabricAdvertiseHost, 'public.example');
    assert.ok(after.body.runtime.selfPeering);
    assert.match(after.body.runtime.selfPeering, /@public\.example:7777$/);
  } finally {
    await svc.stop();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('observeHubPeering discovers via OPTIONS ARC then reads peering', async () => {
  const calls = [];
  const fetchStub = async (url, init = {}) => {
    calls.push({ url: String(url), method: (init.method || 'GET').toUpperCase() });
    const u = String(url);
    if ((init.method || 'GET').toUpperCase() === 'OPTIONS') {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          '@type': 'ApplicationResourceContract',
          name: 'hub.fabric.pub',
          contract: { id: 'deadbeef', messageType: 'CONTRACT_PUBLISH' },
          resources: { Service: { route: '/services' } },
          services: {
            peering: {
              endpointBasePath: '/services/peering',
              kind: 'PeeringCapability'
            },
            faucet: {
              kind: 'BitcoinFaucet',
              source: 'beacon',
              network: 'regtest',
              endpointBasePath: '/services/bitcoin/faucet',
              available: true,
              funded: true,
              balanceSats: 100000
            }
          },
          capabilities: { http: { cors: true }, fabric: { p2p: true } }
        })
      };
    }
    assert.ok(u.endsWith('/services/peering'), `expected peering GET, got ${u}`);
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
  assert.strictEqual(snap.hubs[0].application.contractId, 'deadbeef');
  assert.strictEqual(snap.hubs[0].discoveredVia, 'options+peering');
  assert.ok(snap.hubs[0].faucet);
  assert.strictEqual(snap.hubs[0].faucet.source, 'beacon');
  assert.strictEqual(snap.hubs[0].faucet.balanceSats, 100000);
  assert.ok(calls.some((c) => c.method === 'OPTIONS'));
  assert.ok(calls.some((c) => c.method === 'GET' && c.url.endsWith('/services/peering')));
});

test('observeHubPeering uses OPTIONS status attestation without peering GET', async () => {
  const calls = [];
  const fetchStub = async (url, init = {}) => {
    calls.push({ url: String(url), method: (init.method || 'GET').toUpperCase() });
    assert.strictEqual((init.method || 'GET').toUpperCase(), 'OPTIONS');
    return {
      ok: true,
      status: 200,
      json: async () => ({
        '@type': 'ApplicationResourceContract',
        name: 'hub.fabric.pub',
        contract: { id: 'cafebabe' },
        resources: {},
        services: { peering: { endpointBasePath: '/services/peering' } },
        status: {
          oracleAttestation: {
            claim: {
              kind: 'PeeringCapability',
              fabricPeerId: 'xyz',
              hub: { alias: '@fabric/hub' },
              p2p: { connections: 2, maxPeers: 16, listening: true },
              webrtc: { registeredPeers: 3, signaling: [] }
            }
          }
        }
      })
    };
  };
  const snap = await hubPeeringObserve.observeHubPeering(['https://relay.goon.vc'], { fetch: fetchStub });
  assert.strictEqual(snap.hubs[0].discoveredVia, 'options');
  assert.strictEqual(snap.hubs[0].p2pConnections, 2);
  assert.strictEqual(snap.hubs[0].webrtcRegistered, 3);
  assert.ok(!calls.some((c) => c.method === 'GET'));
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
    assert.ok(detail.body.data.peering);
    assert.match(String(detail.body.data.peering.string || ''), /@hub\.fabric\.pub:7777$/);

    // Self profile is visible via /profile even when inspecting hubs.
    assert.strictEqual(svc._localProfile().nickname, 'PilotOne');

    const byPk = await request(port, 'GET', `/services/star-citizen/profiles/${id.pubkey}`);
    assert.strictEqual(byPk.status, 200, JSON.stringify(byPk.body));
    assert.strictEqual(byPk.body.type, 'PeerProfileDetail');
    assert.strictEqual(byPk.body.data.self, true);
    assert.strictEqual(byPk.body.data.profile.nickname, 'PilotOne');
    assert.strictEqual(byPk.body.data.profile.scHandle, 'PilotOne');
    assert.ok(byPk.body.data.peering);
    // Self without advertise host: empty dial pin until fabricAdvertiseHost is set.
    assert.strictEqual(byPk.body.data.peering.string, '');

    await request(port, 'PUT', '/settings/fabricAdvertiseHost', { value: 'relay.example' });
    const byPkAdv = await request(port, 'GET', `/services/star-citizen/profiles/${id.pubkey}`);
    assert.strictEqual(byPkAdv.status, 200);
    assert.strictEqual(
      byPkAdv.body.data.peering.string,
      `${id.pubkey}@relay.example:7777`
    );
    const badPk = await request(port, 'GET', '/services/star-citizen/profiles/not-a-key');
    assert.strictEqual(badPk.status, 404);

    async function spaGet (reqPath) {
      return new Promise((resolve, reject) => {
        http.get({ host: '127.0.0.1', port, path: reqPath }, (res) => {
          let buf = '';
          res.on('data', (c) => { buf += c; });
          res.on('end', () => resolve({ status: res.statusCode, type: res.headers['content-type'], body: buf }));
        }).on('error', reject);
      });
    }
    const spaProfile = await spaGet(`/profiles/${id.pubkey}`);
    assert.strictEqual(spaProfile.status, 200);
    assert.match(spaProfile.type || '', /text\/html/);
    const spaMission = await spaGet('/missions/example-mission-id');
    assert.strictEqual(spaMission.status, 200);
    assert.match(spaMission.type || '', /text\/html/);

    // Gossip discovery promotes non-hub peers onto the roster (logs off).
    svc._considerDiscoveredPeers(['wingmate.example:7777', 'hub.fabric.pub:7777'], 'gossip');
    assert.ok(svc.peers.some((p) => p.address === 'wingmate.example:7777' && p.discovered === true));
    assert.strictEqual(svc.peers.filter((p) => p.address === 'hub.fabric.pub:7777').length, 1);
  } finally {
    await svc.stop();
  }
});
