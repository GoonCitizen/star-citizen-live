'use strict';

/**
 * Integration: global chat (P2P_CHAT_MESSAGE) across Fabric mesh topologies.
 *
 * Covers:
 *   - Star: spokes dial a shared hub; spoke→hub→spoke relay
 *   - Linear chains of 3 / 4 / 5 hops (edge count); end-to-end + reverse
 *
 * Integrity checks: body, AMP author → ChatManager author, intermediate ingest,
 * idempotent storage (single row per logical message).
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');

const LiveRelay = require('../../services/LiveRelay');
const { createIdentity, pubkeysMatch, pubkeyXOnly } = require('../../functions/identity');

const BASE = '/services/star-citizen';

function sleep (ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function waitFor (fn, { timeoutMs = 25000, intervalMs = 100 } = {}) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const v = await fn();
    if (v) return v;
    await sleep(intervalMs);
  }
  throw new Error('waitFor timeout');
}

function fabricPort () {
  return 20000 + Math.floor(Math.random() * 5000);
}

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

function asRelay (entryOrNode) {
  return entryOrNode && entryOrNode.node ? entryOrNode.node : entryOrNode;
}

function globalBodies (entryOrNode) {
  const node = asRelay(entryOrNode);
  if (!node || !node.chatManager) return [];
  return (node.chatManager.list('global') || []).map((m) => m.body);
}

function globalFromAuthor (entryOrNode, pubkey, body) {
  const node = asRelay(entryOrNode);
  if (!node || !node.chatManager) return null;
  return (node.chatManager.list('global') || []).find((m) => (
    m && m.body === body && pubkeysMatch(m.author, pubkey)
  ));
}

function matchingGlobal (entryOrNode, pubkey, body) {
  const node = asRelay(entryOrNode);
  if (!node || !node.chatManager) return [];
  return (node.chatManager.list('global') || []).filter((m) => (
    m && m.body === body && pubkeysMatch(m.author, pubkey)
  ));
}

/**
 * Start a LiveRelay Fabric node. `dial` is an array of fabric host:port strings.
 * Intermediate / hub nodes set relayAppMessages for app CONTRACT_MESSAGE paths.
 */
async function startNode ({ label, fabricPort: port, dial = [], relay = false, identity }) {
  const dir = tmpDir(`sc-chat-mesh-${label}-`);
  const peers = (dial || []).map((address) => ({ address, enabled: true }));
  const node = new LiveRelay({
    port: 0,
    missions: { enable: false },
    settingsDir: dir,
    peers,
    fabric: {
      enable: true,
      listen: true,
      port,
      peers: [],
      peersDb: null,
      relayAppMessages: relay === true
    }
  });
  await node.start();
  const httpPort = node.server.address().port;
  node.setIdentity(identity);
  await waitFor(() => node.fabricNetwork && node.fabricNetwork.ready);
  return { node, dir, fabricPort: port, httpPort, identity, label };
}

async function stopNode (entry) {
  if (!entry) return;
  try { await entry.node.stop(); } catch (_) { /* ignore */ }
  try { fs.rmSync(entry.dir, { recursive: true, force: true }); } catch (_) { /* ignore */ }
}

async function awaitMesh (nodes, minLinks) {
  await waitFor(() => {
    let links = 0;
    for (const n of nodes) {
      const st = n.node.fabricNetwork && n.node.fabricNetwork.status();
      links += (st && st.fabricConnected) || 0;
    }
    // Each TCP session is counted on both ends → expect ~2 * edges.
    return links >= minLinks;
  }, { timeoutMs: 30000 });
}

/**
 * Linear chain of `hops` edges (hops+1 nodes). Node i dials node i+1.
 * Returns { nodes, hops }.
 */
async function startChain (hops) {
  const count = hops + 1;
  const base = fabricPort();
  const ports = Array.from({ length: count }, (_, i) => base + (i * 11));
  const identities = Array.from({ length: count }, () => createIdentity());
  const nodes = [];

  // Start the far end first so dials have a listener.
  for (let i = count - 1; i >= 0; i--) {
    const dial = i < count - 1 ? [`127.0.0.1:${ports[i + 1]}`] : [];
    // Middles and far end should relay; ends also relay inbound for reverse path.
    const entry = await startNode({
      label: `h${hops}-n${i}`,
      fabricPort: ports[i],
      dial,
      relay: true,
      identity: identities[i]
    });
    nodes[i] = entry;
  }

  // Ensure each consecutive pair has a live session (sum of connected >= 2*hops).
  await awaitMesh(nodes, hops * 2);

  // Heal: re-apply dial list in case early nodes missed a late listener.
  for (let i = 0; i < count - 1; i++) {
    nodes[i].node.peers = [{
      id: `peer-${i + 1}`,
      address: `127.0.0.1:${ports[i + 1]}`,
      enabled: true
    }];
    nodes[i].node.fabricNetwork.setPeers([`127.0.0.1:${ports[i + 1]}`]);
  }
  await awaitMesh(nodes, hops * 2);

  return { nodes, hops, ports };
}

async function stopAll (nodes) {
  for (const n of [...nodes].reverse()) await stopNode(n);
}

async function postGlobal (httpPort, body) {
  const res = await request(httpPort, 'POST', `${BASE}/chat/messages`, {
    channel: 'global',
    body
  });
  assert.strictEqual(res.status, 200, JSON.stringify(res.body));
  return res.body.data;
}

function assertIntegrity (receiver, authorPubkey, body, label) {
  const row = globalFromAuthor(receiver, authorPubkey, body);
  assert.ok(row, `${label}: missing body=${JSON.stringify(body)} author=${authorPubkey.slice(0, 12)}…`);
  assert.strictEqual(row.body, body, `${label}: body mismatch`);
  assert.ok(pubkeysMatch(row.author, authorPubkey), `${label}: author must be AMP signer, not relay hop`);
  assert.strictEqual(row.author, pubkeyXOnly(authorPubkey), `${label}: author must be canonical x-only`);
  const matches = matchingGlobal(receiver, authorPubkey, body);
  assert.strictEqual(matches.length, 1, `${label}: expected single stored message, got ${matches.length}`);
}

// ---- Star topology ----

test('chat mesh: star hub relays spoke→spoke (3 spokes, bidirectional)', async () => {
  const hubPort = fabricPort();
  const spokePorts = [hubPort + 11, hubPort + 22, hubPort + 33];
  const hubId = createIdentity();
  const spokeIds = [createIdentity(), createIdentity(), createIdentity()];

  const hub = await startNode({
    label: 'star-hub',
    fabricPort: hubPort,
    dial: [],
    relay: true,
    identity: hubId
  });
  const spokes = [];
  try {
    for (let i = 0; i < 3; i++) {
      spokes.push(await startNode({
        label: `star-s${i}`,
        fabricPort: spokePorts[i],
        dial: [`127.0.0.1:${hubPort}`],
        relay: false,
        identity: spokeIds[i]
      }));
    }
    await awaitMesh([hub, ...spokes], 6);

    const bodyA = `star-from-s0-${Date.now()}`;
    const posted = await postGlobal(spokes[0].httpPort, bodyA);
    assert.strictEqual(posted.author, pubkeyXOnly(spokeIds[0].pubkey));
    assert.ok(pubkeysMatch(posted.author, spokeIds[0].pubkey));

    await waitFor(() => globalFromAuthor(hub, spokeIds[0].pubkey, bodyA));
    await waitFor(() => globalFromAuthor(spokes[1], spokeIds[0].pubkey, bodyA));
    await waitFor(() => globalFromAuthor(spokes[2], spokeIds[0].pubkey, bodyA));

    assertIntegrity(hub, spokeIds[0].pubkey, bodyA, 'hub');
    assertIntegrity(spokes[1], spokeIds[0].pubkey, bodyA, 'spoke1');
    assertIntegrity(spokes[2], spokeIds[0].pubkey, bodyA, 'spoke2');

    const bodyB = `star-from-s2-${Date.now()}`;
    await postGlobal(spokes[2].httpPort, bodyB);
    await waitFor(() => globalFromAuthor(spokes[0], spokeIds[2].pubkey, bodyB));
    await waitFor(() => globalFromAuthor(spokes[1], spokeIds[2].pubkey, bodyB));
    assertIntegrity(spokes[0], spokeIds[2].pubkey, bodyB, 'spoke0-rev');
    assertIntegrity(hub, spokeIds[2].pubkey, bodyB, 'hub-rev');
  } finally {
    await stopAll([...spokes, hub]);
  }
});

// ---- Linear multi-hop chains ----

async function runChainHops (hops) {
  const { nodes } = await startChain(hops);
  try {
    const first = nodes[0];
    const last = nodes[nodes.length - 1];
    const mid = nodes[Math.floor(nodes.length / 2)];

    const fwd = `chain-${hops}hop-fwd-${Date.now()}`;
    await postGlobal(first.httpPort, fwd);

    await waitFor(() => globalFromAuthor(last, first.identity.pubkey, fwd), {
      timeoutMs: 35000
    });
    // Every hop along the path must ingest (not just forward blindly without app emit).
    for (let i = 0; i < nodes.length; i++) {
      await waitFor(() => globalFromAuthor(nodes[i], first.identity.pubkey, fwd), {
        timeoutMs: 10000
      });
      assertIntegrity(nodes[i], first.identity.pubkey, fwd, `${hops}hop-node${i}`);
    }

    const rev = `chain-${hops}hop-rev-${Date.now()}`;
    await postGlobal(last.httpPort, rev);
    await waitFor(() => globalFromAuthor(first, last.identity.pubkey, rev), {
      timeoutMs: 35000
    });
    assertIntegrity(first, last.identity.pubkey, rev, `${hops}hop-rev-first`);
    assertIntegrity(mid, last.identity.pubkey, rev, `${hops}hop-rev-mid`);
    assertIntegrity(last, last.identity.pubkey, rev, `${hops}hop-rev-last-local`);

    // Local author also has their own post (HTTP path stores before publish).
    assert.ok(globalBodies(first).includes(fwd));
    assert.ok(globalBodies(last).includes(rev));
  } finally {
    await stopAll(nodes);
  }
}

test('chat mesh: 3-hop linear chain end-to-end + reverse', async () => {
  await runChainHops(3);
});

test('chat mesh: 4-hop linear chain end-to-end + reverse', async () => {
  await runChainHops(4);
});

test('chat mesh: 5-hop linear chain end-to-end + reverse', async () => {
  await runChainHops(5);
});

test('chat mesh: star + chain integrity — author never rewritten to relay pubkey', async () => {
  // Compact regression: 3-hop chain; assert no intermediate pubkey appears as author.
  const { nodes } = await startChain(3);
  try {
    const [a, b, c, d] = nodes;
    const body = `integrity-${Date.now()}`;
    await postGlobal(a.httpPort, body);
    await waitFor(() => globalFromAuthor(d, a.identity.pubkey, body));

    for (const n of nodes) {
      const row = globalFromAuthor(n, a.identity.pubkey, body);
      assert.ok(row);
      assert.strictEqual(row.author, pubkeyXOnly(a.identity.pubkey));
      for (const hop of [b, c, d]) {
        assert.ok(
          !pubkeysMatch(row.author, hop.identity.pubkey),
          'relay hop must not become ChatMessage.author'
        );
      }
    }
  } finally {
    await stopAll(nodes);
  }
});
