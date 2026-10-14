'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { createIdentity } = require('../../functions/identity');
const {
  loadFabricEnvIdentity,
  applyFabricEnvConfig,
  formatFabricEnvExports
} = require('../../functions/fabricEnvIdentity');

test('loadFabricEnvIdentity accepts raw seed hex in FABRIC_SEED', () => {
  const id = createIdentity();
  const bip39 = require('@fabric/core/functions/bip39');
  const hex = bip39.mnemonicToSeedSync(id.mnemonic).toString('hex');
  const loaded = loadFabricEnvIdentity({ FABRIC_SEED: hex });
  assert.strictEqual(loaded.xprv, id.xprv);
  assert.strictEqual(loaded.pubkey, id.pubkey);
});

test('loadFabricEnvIdentity prefers FABRIC_XPRV', () => {
  const id = createIdentity();
  const env = { FABRIC_XPRV: id.xprv, FABRIC_SEED: 'should not use' };
  const loaded = loadFabricEnvIdentity(env);
  assert.strictEqual(loaded.pubkey, id.pubkey);
  assert.strictEqual(loaded.xprv, id.xprv);
});

test('loadFabricEnvIdentity accepts xprv in FABRIC_SEED', () => {
  const id = createIdentity();
  const loaded = loadFabricEnvIdentity({ FABRIC_SEED: id.xprv });
  assert.strictEqual(loaded.xprv, id.xprv);
  assert.strictEqual(loaded.pubkey, id.pubkey);
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

test('env FABRIC_SEED wins over local operator identity file', () => {
  const id = createIdentity();
  const other = createIdentity();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gc-fabric-id-'));
  const localPath = path.join(dir, 'fabric-operator-identity.json');
  fs.writeFileSync(localPath, JSON.stringify({ mnemonic: other.mnemonic, xprv: other.xprv }));
  const env = {
    FABRIC_SEED: id.mnemonic,
    FABRIC_OPERATOR_IDENTITY: localPath
  };
  const loaded = loadFabricEnvIdentity(env);
  assert.strictEqual(loaded.pubkey, id.pubkey);
  assert.notStrictEqual(loaded.pubkey, other.pubkey);
  const localOnly = loadFabricEnvIdentity({ FABRIC_OPERATOR_IDENTITY: localPath });
  assert.strictEqual(localOnly.pubkey, other.pubkey);
  assert.strictEqual(
    loadFabricEnvIdentity({ FABRIC_OPERATOR_IDENTITY: localPath }, { allowLocalIdentityFallback: false }),
    null
  );
  fs.rmSync(dir, { recursive: true, force: true });
});

test('core pin exports fabricHomeEnv / fabricKeyMaterial', () => {
  const home = require('@fabric/core/functions/fabricHomeEnv');
  const material = require('@fabric/core/functions/fabricKeyMaterial');
  assert.strictEqual(typeof home.loadFabricHomeEnv, 'function');
  assert.strictEqual(typeof material.parseRawSeedHex, 'function');
  assert.strictEqual(typeof material.keySettingsFromEnv, 'function');
  assert.strictEqual(material.classifyFabricKeyMaterial('aa'.repeat(32)).kind, 'seedHex');
});

test('loadFabricEnvIdentity returns null when unset', () => {
  assert.strictEqual(loadFabricEnvIdentity({}, { allowLocalIdentityFallback: false }), null);
});
