'use strict';

/**
 * Adversarial playnet paths + local Hub as live playnet registry takeover.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const {
  classifyPlaynetPosture,
  listAdversarialPlaynetPaths,
  evaluateAdversarialPlaynetPaths,
  planLocalHubRegistryTakeover,
  assertLocalRegistryTakeoverSafe,
  isLoopbackHubUrl,
  isProductionRegistryHubUrl,
  isProductionHubPeer,
  acceptTrackedWithTokenCascade,
  PRODUCTION_HUB_HTTP,
  LOCAL_HUB_HTTP_DEFAULT,
  LOCAL_HUB_PEER_DEFAULT
} = require('../../functions/playnetDeploy');
const {
  isAllowedFabricHub
} = require('../../functions/fabricHubAllowlist');

test('listAdversarialPlaynetPaths covers probe, refuse, ambiguous, and production Accept', () => {
  const ids = listAdversarialPlaynetPaths().map((p) => p.id);
  assert.ok(ids.includes('adversary-probe-local'));
  assert.ok(ids.includes('adversary-probe-production'));
  assert.ok(ids.includes('deploy-pure-adversary-flag'));
  assert.ok(ids.includes('ambiguous-both-flags-unknown-script'));
  assert.ok(ids.includes('ambiguous-public-hosts-unknown-script'));
  assert.ok(ids.includes('deploy-ambiguous-still-operator-publish'));
  assert.ok(ids.includes('production-accept-without-local-registry'));
});

test('evaluateAdversarialPlaynetPaths: all catalogued paths match expectations', () => {
  const { paths, failures } = evaluateAdversarialPlaynetPaths();
  assert.equal(failures.length, 0, failures.map((f) => ({
    id: f.id,
    checks: f.checks.filter((c) => !c.ok)
  })));
  assert.ok(paths.length >= 7);
  const probe = paths.find((p) => p.id === 'adversary-probe-production');
  assert.equal(probe.classified.treatAsAdversary, true);
  assert.equal(probe.classified.treatAsOperatorPublish, false);
});

test('adversary posture never implies Accept; pure adversary deploy is refused', () => {
  const refuse = classifyPlaynetPosture({
    argv: ['--adversary'],
    script: 'deploy',
    peers: [LOCAL_HUB_PEER_DEFAULT],
    httpTarget: LOCAL_HUB_HTTP_DEFAULT,
    env: {}
  });
  assert.equal(refuse.treatAsAdversary, true);
  assert.equal(refuse.treatAsOperatorPublish, false);

  const probe = classifyPlaynetPosture({
    argv: ['--production'],
    script: 'adversary',
    peers: ['hub.fabric.pub:7777', 'relay.goon.vc:7777'],
    httpTarget: 'https://relay.goon.vc',
    env: { ADV_PRODUCTION: '1' }
  });
  assert.equal(probe.treatAsAdversary, true);
  assert.equal(probe.treatAsOperatorPublish, false);
});

test('planLocalHubRegistryTakeover: loopback Accept, omit production Hub peer', () => {
  const plan = planLocalHubRegistryTakeover({
    hubUrl: LOCAL_HUB_HTTP_DEFAULT,
    includeRelay: true,
    argv: ['--local-registry', '--accept']
  });
  assert.equal(plan.role, 'local-registry');
  assert.equal(plan.registryHubUrl, LOCAL_HUB_HTTP_DEFAULT);
  assert.equal(plan.fabricPeers[0], LOCAL_HUB_PEER_DEFAULT);
  assert.ok(plan.fabricPeers.includes('relay.goon.vc:7777'));
  assert.equal(plan.fabricPeers.some(isProductionHubPeer), false);
  assert.equal(plan.accept.method, 'AcceptTrackedApplicationContract');
  assert.equal(plan.accept.baseUrl, LOCAL_HUB_HTTP_DEFAULT);
  assert.equal(plan.accept.allowed, true);
  assert.equal(plan.safe, true);
  assert.equal(assertLocalRegistryTakeoverSafe(plan), true);
  assert.ok(plan.readiness.rpc.includes('ListTrackedApplicationContracts'));
  assert.ok(plan.readiness.expectNativeBeacon === 'fabric-beacon');
});

test('planLocalHubRegistryTakeover refuses production Hub HTTP / peer', () => {
  const badHttp = planLocalHubRegistryTakeover({
    hubUrl: PRODUCTION_HUB_HTTP,
    argv: ['--local-registry']
  });
  assert.equal(badHttp.safe, false);
  assert.equal(badHttp.accept.allowed, false);
  assert.throws(() => assertLocalRegistryTakeoverSafe(badHttp), /production Hub|loopback/i);

  const withProdPeer = planLocalHubRegistryTakeover({
    hubUrl: LOCAL_HUB_HTTP_DEFAULT,
    extraPeers: ['hub.fabric.pub:7777'],
    argv: ['--local-registry']
  });
  assert.equal(withProdPeer.fabricPeers.some(isProductionHubPeer), false);
  assert.equal(assertLocalRegistryTakeoverSafe(withProdPeer), true);
});

test('local registry takeover blocked in pure adversary posture', () => {
  const plan = planLocalHubRegistryTakeover({
    hubUrl: LOCAL_HUB_HTTP_DEFAULT,
    argv: ['--local-registry', '--adversary'],
    script: 'deploy'
  });
  assert.equal(plan.posture.treatAsAdversary, true);
  assert.equal(plan.safe, false);
  assert.throws(() => assertLocalRegistryTakeoverSafe(plan), /adversary|not allowed|unsafe/i);
});

test('url helpers distinguish loopback vs production registry', () => {
  assert.equal(isLoopbackHubUrl('http://127.0.0.1:8080'), true);
  assert.equal(isLoopbackHubUrl('http://localhost:8080/'), true);
  assert.equal(isLoopbackHubUrl(PRODUCTION_HUB_HTTP), false);
  assert.equal(isProductionRegistryHubUrl(PRODUCTION_HUB_HTTP), true);
  assert.equal(isProductionRegistryHubUrl(LOCAL_HUB_HTTP_DEFAULT), false);
  assert.equal(isProductionHubPeer('hub.fabric.pub:7777'), true);
  assert.equal(isProductionHubPeer(LOCAL_HUB_PEER_DEFAULT), false);
});

test('local registry Accept cascade hits only the loopback Hub', async () => {
  let hitHost = null;
  let accepted = null;
  const server = await new Promise((resolve) => {
    const s = http.createServer((req, res) => {
      hitHost = req.headers.host;
      let body = '';
      req.on('data', (c) => { body += c; });
      req.on('end', () => {
        const parsed = JSON.parse(body);
        assert.equal(parsed.method, 'AcceptTrackedApplicationContract');
        const params = Array.isArray(parsed.params) ? parsed.params[0] : parsed.params;
        accepted = params;
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          result: { status: 'success', contractId: params.contractId }
        }));
      });
    });
    s.listen(0, '127.0.0.1', () => resolve(s));
  });
  try {
    const { port } = server.address();
    const baseUrl = `http://127.0.0.1:${port}`;
    const plan = planLocalHubRegistryTakeover({ hubUrl: baseUrl, includeRelay: false });
    assertLocalRegistryTakeoverSafe(plan);
    assert.equal(plan.accept.baseUrl, baseUrl);

    const direct = await acceptTrackedWithTokenCascade({
      contractId: 'cd'.repeat(32),
      baseUrl: plan.accept.baseUrl,
      candidates: [
        { token: 'bad', source: 'env' },
        { token: 'good', source: 'operator-master' }
      ],
      rpc: async (_method, params) => {
        if (params.adminToken === 'bad') {
          return { status: 'error', message: 'adminToken invalid' };
        }
        // Forward winning token to the loopback Hub under test.
        return require('../../functions/playnetDeploy').hubRpc(
          'AcceptTrackedApplicationContract',
          params,
          { baseUrl }
        );
      }
    });
    assert.equal(direct.ok, true);
    assert.equal(direct.source, 'operator-master');
    assert.equal(accepted.adminToken, 'good');
    assert.match(String(hitHost), /^127\.0\.0\.1:/);
    assert.equal(isProductionRegistryHubUrl(baseUrl), false);
  } finally {
    await new Promise((r) => server.close(r));
  }
});

test('fabric hub allowlist still permits local Hub for identity flows during takeover', () => {
  assert.equal(isAllowedFabricHub(LOCAL_HUB_HTTP_DEFAULT), true);
  assert.equal(isAllowedFabricHub('https://hub.fabric.pub'), true);
  assert.equal(isAllowedFabricHub('https://evil.example'), false);
});

test('production --accept without --local-registry is not a local takeover plan', () => {
  const productionPublish = classifyPlaynetPosture({
    argv: ['--production', '--accept'],
    script: 'deploy',
    peers: ['hub.fabric.pub:7777', 'relay.goon.vc:7777'],
    httpTarget: PRODUCTION_HUB_HTTP,
    env: {}
  });
  assert.equal(productionPublish.treatAsOperatorPublish, true);
  const takeover = planLocalHubRegistryTakeover({
    hubUrl: LOCAL_HUB_HTTP_DEFAULT,
    argv: ['--local-registry', '--accept']
  });
  assert.notEqual(takeover.registryHubUrl, PRODUCTION_HUB_HTTP);
  assert.equal(takeover.omitProductionHubPeer, true);
});

test('planPlaynetLeadCapture: short-term local lead, long-term hub.fabric.pub', () => {
  const {
    planPlaynetLeadCapture
  } = require('../../functions/playnetDeploy');
  const local = planPlaynetLeadCapture({
    horizon: 'local-lead',
    hubUrl: LOCAL_HUB_HTTP_DEFAULT,
    argv: ['--local-registry']
  });
  assert.equal(local.networkAlwaysExists, true);
  assert.equal(local.horizon, 'local-lead');
  assert.equal(local.shortTerm.omitProductionHubPeer, true);
  assert.ok(local.shortTerm.deployFlags.includes('--local-registry'));
  assert.equal(local.safe, true);

  const remote = planPlaynetLeadCapture({ horizon: 'hub.fabric.pub' });
  assert.equal(remote.horizon, 'hub.fabric.pub');
  assert.equal(remote.longTerm.registryHttp, PRODUCTION_HUB_HTTP);
  assert.equal(remote.longTerm.registryPeer, 'hub.fabric.pub:7777');
  assert.ok(remote.longTerm.deployFlags.includes('--production'));
});
