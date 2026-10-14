'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const Module = require('module');
const path = require('path');

const TARGET = path.resolve(__dirname, '../../functions/identityCluster.js');
const HUB = '@fabric/hub/functions/identityCluster';

describe('identityCluster Android stub (Hub missing)', () => {
  let origLoad;

  before(() => {
    origLoad = Module._load;
    Module._load = function (request, parent, isMain) {
      if (request === HUB) {
        const err = new Error(`Cannot find module '${HUB}'`);
        err.code = 'MODULE_NOT_FOUND';
        throw err;
      }
      return origLoad.apply(this, arguments);
    };
    delete require.cache[TARGET];
  });

  after(() => {
    Module._load = origLoad;
    delete require.cache[TARGET];
  });

  it('same-pubkey only; ingest is a no-op', () => {
    const IdentityCluster = require('../../functions/identityCluster');
    const c = new IdentityCluster();
    assert.equal(c.ingestCrossSign(), c);
    assert.equal(c.clusterEquals('aa', 'aa'), true);
    assert.equal(c.clusterEquals('AA', 'aa'), true);
    assert.equal(c.clusterEquals('aa', 'bb'), false);
    assert.equal(c.clusterEquals('', ''), false);
    const snap = c.snapshot('aa');
    assert.equal(snap.canonical, 'aa');
    assert.deepEqual(snap.members, ['aa']);
    assert.deepEqual(c.toJSON(), { pending: [], edges: [], revoked: [] });
    assert.ok(IdentityCluster.fromJSON() instanceof IdentityCluster);
    assert.equal(c.clusterFor('').canonical, null);
  });
});
