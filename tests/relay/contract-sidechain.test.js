'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const contractSidechain = require('../../functions/contractSidechain');
const gooncitizenGameState = require('../../functions/gooncitizenGameState');
const { gooncitizenContractId } = require('../../contracts/gooncitizen');

describe('contractSidechain (D-016)', () => {
  it('ensureLocalContractChain + publishContent persist under sidechains/', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gc-contract-sc-'));
    const id = 'ab'.repeat(32);
    const ensured = contractSidechain.ensureLocalContractChain(root, id, {
      name: 'GoonCitizenGroup',
      parentContractId: gooncitizenContractId()
    });
    assert.equal(ensured.created, true);
    assert.ok(fs.existsSync(ensured.paths.state));

    const pub = contractSidechain.publishContent(root, id, { hello: 'world' }, {
      name: 'GoonCitizenGroup',
      parentContractId: gooncitizenContractId()
    });
    assert.equal(pub.state.clock, 1);
    assert.equal(pub.state.content.hello, 'world');
    assert.equal(pub.head.stateDigest, contractSidechain.stateDigest(pub.state));
  });

  it('patchesForGameState seals /services/rsi and /namespaces/<contractId>', () => {
    const snap = gooncitizenGameState.buildGameStateSnapshot({
      missions: [],
      deaths: [],
      sessions: [],
      players: [],
      heat: {},
      meta: {}
    });
    const patches = gooncitizenGameState.patchesForGameState({}, snap);
    assert.ok(patches.some((p) => p.path === '/services' || p.path === '/services/rsi'));
    const svc = patches.find((p) => p.path === '/services');
    if (svc) assert.ok(svc.value && svc.value.rsi);
    const ns = patches.find((p) => p.path === '/namespaces');
    assert.ok(ns, 'expected /namespaces add');
    assert.ok(ns.value[gooncitizenContractId()]);
    assert.equal(ns.value[gooncitizenContractId()].stateDigest, snap.digest);

    const again = gooncitizenGameState.patchesForGameState({
      services: { rsi: snap },
      namespaces: ns.value
    }, snap);
    assert.equal(again.length, 0);
  });
});
