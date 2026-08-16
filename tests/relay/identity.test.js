'use strict';

const test = require('node:test');
const assert = require('node:assert');

const {
  canonicalStringify,
  createIdentity,
  restoreIdentity,
  keyFromIdentity,
  encryptIdentity,
  decryptIdentity,
  signEnvelope,
  verifyEnvelope
} = require('../../functions/identity');

test('createIdentity produces a mnemonic and compressed pubkey', () => {
  const identity = createIdentity();
  assert.ok(identity.mnemonic, 'has mnemonic');
  assert.ok(identity.mnemonic.split(' ').length >= 12, '>= 12 words');
  assert.ok(identity.xprv.startsWith('xprv'), 'has xprv');
  assert.match(identity.pubkey, /^0[23][0-9a-f]{64}$/, 'compressed pubkey hex');
  assert.strictEqual(identity.id, identity.pubkey, 'actor id is the pubkey');
});

test('restoreIdentity is deterministic from mnemonic and xprv', () => {
  const original = createIdentity();
  const fromMnemonic = restoreIdentity(original.mnemonic);
  const fromXprv = restoreIdentity({ xprv: original.xprv });
  assert.strictEqual(fromMnemonic.pubkey, original.pubkey);
  assert.strictEqual(fromXprv.pubkey, original.pubkey);
});

test('restoreIdentity rejects empty input', () => {
  assert.throws(() => restoreIdentity({}), /mnemonic, seed hex, or xprv/);
});

test('encrypt/decrypt round-trips with the right password only', () => {
  const identity = createIdentity();
  const blob = encryptIdentity(identity, 'correct horse battery staple');

  assert.ok(!JSON.stringify(blob).includes(identity.xprv), 'xprv not in plaintext');
  assert.ok(!JSON.stringify(blob).includes(identity.mnemonic), 'mnemonic not in plaintext');
  assert.strictEqual(blob.pubkey, identity.pubkey, 'pubkey stays readable');

  const decrypted = decryptIdentity(blob, 'correct horse battery staple');
  assert.strictEqual(decrypted.xprv, identity.xprv);
  assert.strictEqual(decrypted.mnemonic, identity.mnemonic);
  assert.strictEqual(decrypted.pubkey, identity.pubkey);

  assert.throws(() => decryptIdentity(blob, 'wrong password'), /Could not decrypt/);
});

test('signEnvelope/verifyEnvelope round-trips and rejects tampering', () => {
  const identity = createIdentity();
  const payload = { kind: 'kill', victim: 'NPC_Pirate', ts: 1234567890 };
  const envelope = signEnvelope(identity, payload);

  assert.strictEqual(envelope.pubkey, identity.pubkey);
  assert.match(envelope.signature, /^[0-9a-f]{128}$/, '64-byte schnorr sig hex');
  assert.strictEqual(verifyEnvelope(envelope), true, 'valid envelope verifies');

  const tampered = Object.assign({}, envelope, {
    payload: Object.assign({}, payload, { victim: 'SomeoneElse' })
  });
  assert.strictEqual(verifyEnvelope(tampered), false, 'tampered payload fails');

  const wrongKey = Object.assign({}, envelope, { pubkey: createIdentity().pubkey });
  assert.strictEqual(verifyEnvelope(wrongKey), false, 'wrong pubkey fails');

  assert.strictEqual(verifyEnvelope(null), false);
  assert.strictEqual(verifyEnvelope({}), false);
});

test('canonicalStringify sorts keys recursively', () => {
  const a = canonicalStringify({ b: 1, a: { d: 2, c: [1, { z: 1, y: 2 }] } });
  const b = canonicalStringify({ a: { c: [1, { y: 2, z: 1 }], d: 2 }, b: 1 });
  assert.strictEqual(a, b);
});

test('keyFromIdentity signs consistently with the original key', () => {
  const identity = createIdentity();
  const key = keyFromIdentity(identity);
  assert.strictEqual(key.pubkey, identity.pubkey);
});

// Backup portability: the exported backup file is the at-rest blob plus a
// `type` marker; importing strips the marker and decrypts with the password.
test('encrypted backup file round-trips through export/import shape', () => {
  const identity = createIdentity();
  const password = 'orbital drop shock trooper';
  const blob = encryptIdentity(identity, password);

  const backupFile = Object.assign({ type: 'gooncitizen-identity-backup' }, blob);
  const { type, ...restored } = JSON.parse(JSON.stringify(backupFile));
  assert.strictEqual(type, 'gooncitizen-identity-backup');

  const decrypted = decryptIdentity(restored, password);
  assert.strictEqual(decrypted.pubkey, identity.pubkey);
  assert.strictEqual(decrypted.xprv, identity.xprv);
  assert.throws(() => decryptIdentity(restored, 'not the password'), /Could not decrypt/);
});

test('identityStore refuses to persist plaintext secrets', () => {
  const fs = require('fs');
  const os = require('os');
  const path = require('path');
  const identityStore = require('../../functions/identityStore');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sc-id-'));

  const identity = createIdentity();
  assert.throws(() => identityStore.saveEncrypted(dir, identity), /not an encrypted identity blob/);
  assert.throws(
    () => identityStore.saveEncrypted(dir, Object.assign({ ciphertext: 'aa' }, { xprv: identity.xprv })),
    /plaintext secrets/
  );

  const blob = encryptIdentity(identity, 'a strong password here');
  const file = identityStore.saveEncrypted(dir, blob);
  assert.ok(fs.existsSync(file));
  const loaded = identityStore.loadEncrypted(dir);
  assert.strictEqual(loaded.pubkey, identity.pubkey);
  fs.rmSync(dir, { recursive: true, force: true });
});
