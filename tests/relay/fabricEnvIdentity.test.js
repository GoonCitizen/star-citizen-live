'use strict';

const test = require('node:test');
const assert = require('node:assert');

const { createIdentity } = require('../../functions/identity');
const {
  loadFabricEnvIdentity,
  applyFabricEnvConfig,
  formatFabricEnvExports
} = require('../../functions/fabricEnvIdentity');

test('loadFabricEnvIdentity prefers FABRIC_XPRV', () => {
  const id = createIdentity();
  const env = { FABRIC_XPRV: id.xprv, FABRIC_SEED: 'should not use' };
  const loaded = loadFabricEnvIdentity(env);
  assert.strictEqual(loaded.pubkey, id.pubkey);
  assert.strictEqual(loaded.xprv, id.xprv);
});

test('applyFabricEnvConfig stamps FABRIC_XPRV from FABRIC_SEED', () => {
  const id = createIdentity();
  const env = { FABRIC_SEED: id.mnemonic };
  const { identity, updated, source } = applyFabricEnvConfig(env);
  assert.ok(identity);
  assert.strictEqual(source, 'FABRIC_SEED');
  assert.strictEqual(updated, true);
  assert.strictEqual(env.FABRIC_XPRV, id.xprv);
  assert.strictEqual(env.FABRIC_PUBKEY, id.pubkey);
  assert.strictEqual(formatFabricEnvExports(identity).includes('export FABRIC_XPRV='), true);
});

test('loadFabricEnvIdentity returns null when unset', () => {
  assert.strictEqual(loadFabricEnvIdentity({}), null);
});
