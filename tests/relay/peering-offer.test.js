'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');

const FabricNetwork = require('../../services/FabricNetwork');
const LiveRelay = require('../../services/LiveRelay');
const settingsStore = require('../../functions/settingsStore');
const { Store } = require('../../types/Store');
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

function stubReadyPeer (net, id, { host = 'hub.fabric.pub:7777' } = {}) {
  const enqueued = [];
  net._peer = {
    connections: { [host]: {} },
    settings: { port: Number(net.settings.port) || 7777 },
    key: { pubkey: id.pubkey },
    candidates: [],
    _enqueuePeeringCandidate (h, p) { enqueued.push(`${h}:${p}`); },
    _fillPeerSlots () { return 0; },
    relayFrom () {},
    async stop () {}
  };
  return enqueued;
}

test('settingsStore coerces broadcastPeering to boolean', async () => {
  const dir = tmpDir('sc-bcast-coerce-');
  const store = new Store({ path: path.join(dir, 'register') });
  await store.start();
  try {
    assert.ok(settingsStore.ALLOWED_KEYS.includes('broadcastPeering'));
    settingsStore.putSetting(store, 'broadcastPeering', true);
    assert.strictEqual(settingsStore.loadSettings(store).broadcastPeering, true);
    settingsStore.putSetting(store, 'broadcastPeering', 'true');
    assert.strictEqual(settingsStore.loadSettings(store).broadcastPeering, false);
    settingsStore.putSetting(store, 'broadcastPeering', 1);
    assert.strictEqual(settingsStore.loadSettings(store).broadcastPeering, false);
    settingsStore.putSetting(store, 'broadcastPeering', false);
    assert.strictEqual(settingsStore.loadSettings(store).broadcastPeering, false);
  } finally {
    await store.stop();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('maybePublishPeeringOffer skips when broadcastPeering is off', () => {
  const id = createIdentity();
  const net = new FabricNetwork({
    advertiseHost: 'public.example',
    broadcastPeering: false,
    maxPeers: 32
  });
  net.setIdentity(id);
  stubReadyPeer(net, id);
  assert.strictEqual(net.maybePublishPeeringOffer(), null);
  assert.strictEqual(net.maybePublishPeeringOffer({ force: false }), null);
});

test('publishPeeringOffer builds enriched payload when forced', () => {
  const id = createIdentity();
  const net = new FabricNetwork({
    advertiseHost: 'public.example',
    broadcastPeering: false,
    maxPeers: 32
  });
  net.setIdentity(id);
  stubReadyPeer(net, id);
  let captured = null;
  net._signAndRelay = (type, body) => {
    captured = { type, body };
    return { type, body };
  };
  const msg = net.publishPeeringOffer({ force: true });
  assert.ok(msg);
  assert.strictEqual(captured.type, 'P2P_PEERING_OFFER');
  const obj = captured.body.object;
  assert.strictEqual(obj.host, 'public.example');
  assert.strictEqual(obj.port, 7777);
  assert.strictEqual(obj.transport, 'fabric');
  assert.ok(obj.slots >= 1);
  assert.strictEqual(obj.pubkey, String(id.pubkey).toLowerCase());
  assert.match(obj.peering, /@public\.example:7777$/);
  assert.ok(Array.isArray(obj.rendezvous.hubs));
  assert.ok(obj.rendezvous.hubs.includes('hub.fabric.pub:7777'));
});

test('maybePublishPeeringOffer runs when broadcastPeering is on', () => {
  const id = createIdentity();
  const net = new FabricNetwork({
    advertiseHost: 'public.example',
    broadcastPeering: true,
    maxPeers: 32
  });
  net.setIdentity(id);
  stubReadyPeer(net, id);
  let captured = null;
  net._signAndRelay = (type, body) => {
    captured = { type, body };
    return { type, body };
  };
  const msg = net.maybePublishPeeringOffer();
  assert.ok(msg);
  assert.strictEqual(captured.body.object.host, 'public.example');
  assert.ok(captured.body.object.peering);
});

test('full flow: settings → announce → ingest offer → roster dial pin', async () => {
  const dir = tmpDir('sc-peering-flow-');
  const alice = createIdentity();
  const bob = createIdentity();
  const svc = new LiveRelay({
    port: 0,
    settingsDir: dir,
    peers: [],
    fabric: { enable: false }
  });
  await svc.start();
  try {
    svc.setIdentity(bob);
    const port = svc.server.address().port;

    // Locked announce before identity would fail; bob is unlocked.
    const announceLocked = await request(port, 'POST', '/peers/announce');
    // No advertise host yet.
    assert.strictEqual(announceLocked.status, 400);
    assert.match(announceLocked.body.error || '', /fabricAdvertiseHost/i);

    await request(port, 'PUT', '/settings/fabricAdvertiseHost', { value: 'bob.example' });
    await request(port, 'PUT', '/settings/broadcastPeering', { value: true });

    const settings = await request(port, 'GET', '/settings');
    assert.strictEqual(settings.body.runtime.broadcastPeering, true);
    assert.strictEqual(settings.body.runtime.fabricAdvertiseHost, 'bob.example');
    assert.strictEqual(
      settings.body.runtime.selfPeering,
      `${bob.pubkey}@bob.example:7777`
    );

    // Fabric disabled → ensureFabric skips; install a ready stub that publishes.
    let forcedOffers = 0;
    const offered = [];
    svc.fabricNetwork = {
      ready: true,
      setAdvertiseHost () {},
      setBroadcastPeering () {},
      maybePublishPeeringOffer () { return null; },
      async stop () {},
      publishPeeringOffer (opts) {
        assert.strictEqual(opts && opts.force, true);
        forcedOffers += 1;
        const msg = { type: 'P2P_PEERING_OFFER', object: { host: 'bob.example' } };
        offered.push(msg);
        return msg;
      }
    };

    const announced = await request(port, 'POST', '/peers/announce');
    assert.strictEqual(announced.status, 200, JSON.stringify(announced.body));
    assert.strictEqual(announced.body.type, 'PeeringAnnounce');
    assert.strictEqual(announced.body.data.ok, true);
    assert.strictEqual(announced.body.data.peering, `${bob.pubkey}@bob.example:7777`);
    assert.strictEqual(announced.body.data.broadcastPeering, true);
    assert.strictEqual(forcedOffers, 1);

    // Publisher builds the enriched AMP object receivers ingest.
    const publisher = new FabricNetwork({
      advertiseHost: 'alice.example',
      broadcastPeering: true,
      maxPeers: 32,
      port: 7777
    });
    publisher.setIdentity(alice);
    stubReadyPeer(publisher, alice);
    let offerBody = null;
    publisher._signAndRelay = (type, body) => {
      offerBody = body;
      return { type, body };
    };
    assert.ok(publisher.publishPeeringOffer({ force: true }));
    assert.ok(offerBody && offerBody.object);
    assert.strictEqual(offerBody.object.pubkey, String(alice.pubkey).toLowerCase());
    assert.strictEqual(offerBody.object.peering, `${alice.pubkey}@alice.example:7777`);

    // Receiver LiveRelay wires FabricNetwork ingest → roster discovery.
    const receiverNet = new FabricNetwork({
      advertiseHost: null,
      broadcastPeering: false,
      maxPeers: 32,
      allowLoopbackDiscovery: false
    });
    receiverNet.setIdentity(bob);
    const enqueued = stubReadyPeer(receiverNet, bob);
    receiverNet.setHandlers(svc._fabricIngestHandlers());
    svc.fabricNetwork = receiverNet;

    receiverNet._ingestPeeringEvent({
      message: { object: offerBody.object },
      origin: 'test'
    }, 'offer');

    assert.ok(enqueued.includes('alice.example:7777'), `enqueued=${JSON.stringify(enqueued)}`);

    const list = await request(port, 'GET', '/peers');
    assert.strictEqual(list.status, 200);
    const discovered = list.body.data.find((p) => p.address === 'alice.example:7777');
    assert.ok(discovered, `peers=${JSON.stringify(list.body.data)}`);
    assert.strictEqual(discovered.discovered, true);
    assert.strictEqual(discovered.expectedPubkey, String(alice.pubkey).toLowerCase());
    assert.strictEqual(discovered.peering, `${alice.pubkey}@alice.example:7777`);
    assert.match(String(discovered.label || ''), /offer/i);

    // Operator can also paste the dial pin from the offer.
    const dial = await request(port, 'POST', '/peers', {
      address: offerBody.object.peering,
      label: 'alice-pin'
    });
    // Already on roster from discovery — POST may add duplicate address or reject.
    // Prefer: if 200, expectedPubkey matches; if already present, GET still shows pin.
    if (dial.status === 200) {
      assert.strictEqual(dial.body.data.address, 'alice.example:7777');
      assert.strictEqual(dial.body.data.expectedPubkey, String(alice.pubkey).toLowerCase());
    } else {
      const again = await request(port, 'GET', '/peers');
      const row = again.body.data.find((p) => p.address === 'alice.example:7777');
      assert.ok(row);
      assert.strictEqual(row.peering, `${alice.pubkey}@alice.example:7777`);
    }

    assert.ok(offered.length >= 1);
  } finally {
    // Stubbed FabricNetwork peers lack Peer#stop — drop before LiveRelay teardown.
    svc.fabricNetwork = null;
    await svc.stop();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('full flow over live Fabric: announce offer lands on peer roster', async () => {
  const alice = createIdentity();
  const bob = createIdentity();
  const portA = 19000 + Math.floor(Math.random() * 4000);
  const portB = portA + 17;
  const dirA = tmpDir('sc-peering-live-a-');
  const dirB = tmpDir('sc-peering-live-b-');

  function sleep (ms) {
    return new Promise((r) => setTimeout(r, ms));
  }
  async function waitFor (fn, { timeoutMs = 20000, intervalMs = 100 } = {}) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const v = await fn();
      if (v) return v;
      await sleep(intervalMs);
    }
    throw new Error('waitFor timeout');
  }

  const nodeB = new LiveRelay({
    port: 0,
    settingsDir: dirB,
    peers: [],
    fabric: {
      enable: true,
      listen: true,
      port: portB,
      peers: [],
      peersDb: null,
      relayAppMessages: true
    }
  });
  await nodeB.start();
  nodeB.setIdentity(bob);
  await waitFor(() => nodeB.fabricNetwork && nodeB.fabricNetwork.ready);

  const nodeA = new LiveRelay({
    port: 0,
    settingsDir: dirA,
    peers: [{ address: `127.0.0.1:${portB}`, label: 'peer-b', enabled: true }],
    fabric: {
      enable: true,
      listen: true,
      port: portA,
      peers: [],
      peersDb: null,
      relayAppMessages: true
    }
  });
  await nodeA.start();
  nodeA.setIdentity(alice);
  await waitFor(() => nodeA.fabricNetwork && nodeA.fabricNetwork.ready);
  await waitFor(() => (
    nodeA.fabricNetwork.status().fabricConnected >= 1 ||
    nodeB.fabricNetwork.status().fabricConnected >= 1
  ));

  const httpA = nodeA.server.address().port;
  const httpB = nodeB.server.address().port;

  try {
    await request(httpA, 'PUT', '/settings/fabricAdvertiseHost', { value: 'alice-live.example' });
    await request(httpA, 'PUT', '/settings/broadcastPeering', { value: true });

    const announced = await request(httpA, 'POST', '/peers/announce');
    assert.strictEqual(announced.status, 200, JSON.stringify(announced.body));
    assert.strictEqual(announced.body.data.peering, `${alice.pubkey}@alice-live.example:${portA}`);

    await waitFor(() => nodeB.peers.some((p) => p.address === `alice-live.example:${portA}`));

    const listB = await request(httpB, 'GET', '/peers');
    const row = listB.body.data.find((p) => p.address === `alice-live.example:${portA}`);
    assert.ok(row, `B peers=${JSON.stringify(listB.body.data)}`);
    assert.strictEqual(row.discovered, true);
    assert.strictEqual(row.expectedPubkey, String(alice.pubkey).toLowerCase());
    assert.strictEqual(row.peering, `${alice.pubkey}@alice-live.example:${portA}`);
  } finally {
    await nodeA.stop();
    await nodeB.stop();
    fs.rmSync(dirA, { recursive: true, force: true });
    fs.rmSync(dirB, { recursive: true, force: true });
  }
});
