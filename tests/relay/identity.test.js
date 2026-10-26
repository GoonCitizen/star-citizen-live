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
  verifyEnvelope,
  identityBlobSummary,
  selectIdentityAccount,
  isIdentityVault
} = require('../../functions/identity');

test('createIdentity produces a mnemonic and compressed pubkey', () => {
  const identity = createIdentity();
  assert.ok(identity.mnemonic, 'has mnemonic');
  assert.ok(identity.mnemonic.split(' ').length >= 12, '>= 12 words');
  assert.ok(identity.xprv.startsWith('xprv'), 'has the master xprv');
  assert.strictEqual(identity.account, 0);
  assert.strictEqual(keyFromIdentity(identity).pubkey, identity.pubkey, 'pubkey is the identity leaf, not the master');
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

test('the derivation password (BIP39 passphrase) gives another master', () => {
  const original = createIdentity({ passphrase: 'derive-me' });
  assert.strictEqual(restoreIdentity({ mnemonic: original.mnemonic, passphrase: 'derive-me' }).pubkey, original.pubkey);
  assert.notStrictEqual(restoreIdentity({ mnemonic: original.mnemonic }).pubkey, original.pubkey);
});

test('accounts and networks derive different identities from one master', () => {
  const original = createIdentity({ network: 'regtest' });
  const a1 = restoreIdentity({ xprv: original.xprv, account: 1, network: 'regtest' });
  const main = restoreIdentity({ xprv: original.xprv, account: 0, network: 'mainnet' });
  assert.notStrictEqual(a1.pubkey, original.pubkey);
  assert.notStrictEqual(main.pubkey, original.pubkey);
  assert.strictEqual(a1.xprv, original.xprv, 'the master is the same');
});

test('restoreIdentity rejects empty input', () => {
  assert.throws(() => restoreIdentity({}), /seed phrase, seed hex, or master xprv/);
});

test('encrypt/decrypt round-trips with the right password only', () => {
  const identity = createIdentity({ network: 'regtest' });
  const blob = encryptIdentity(identity, 'correct horse battery staple');

  assert.ok(isIdentityVault(blob));
  assert.ok(!JSON.stringify(blob).includes(identity.xprv), 'xprv not in plaintext');
  for (const word of new Set(identity.mnemonic.split(' '))) {
    if (word.length > 5) assert.ok(!JSON.stringify(blob).includes(`"${word}`), 'no seed words stored');
  }
  const summary = identityBlobSummary(blob);
  assert.strictEqual(summary.pubkey, identity.pubkey, 'pubkey stays readable');
  assert.strictEqual(summary.network, 'regtest', 'network is kept in the record');
  assert.strictEqual(summary.account, 0);

  const decrypted = decryptIdentity(blob, 'correct horse battery staple');
  assert.strictEqual(decrypted.xprv, identity.xprv);
  assert.strictEqual(decrypted.mnemonic, undefined, 'the seed phrase is not kept');
  assert.strictEqual(decrypted.pubkey, identity.pubkey);
  assert.strictEqual(decrypted.network, 'regtest');

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

test('selectIdentityAccount: locked switches only to cached pairs, unlocked derives new ones', () => {
  const identity = createIdentity({ network: 'regtest' });
  const blob = encryptIdentity(identity, 'switch password 1');
  assert.throws(() => selectIdentityAccount(blob, { account: 2, network: 'regtest' }, null), (e) => e.code === 'FABRIC_ACCOUNT_LOCKED');
  const added = selectIdentityAccount(blob, { account: 2, network: 'regtest' }, identity);
  assert.ok(added.identity);
  assert.notStrictEqual(added.identity.pubkey, identity.pubkey);
  assert.strictEqual(identityBlobSummary(added.blob).account, 2);
  const back = selectIdentityAccount(added.blob, { account: 0, network: 'regtest' }, null);
  assert.strictEqual(back.identity, null);
  assert.strictEqual(identityBlobSummary(back.blob).pubkey, identity.pubkey);
  const again = selectIdentityAccount(back.blob, { account: 2, network: 'regtest' }, null);
  assert.strictEqual(identityBlobSummary(again.blob).pubkey, added.identity.pubkey, 'a cached pair switches while locked');
});

// Backup portability: the exported backup file wraps the sealed vault; importing
// unwraps it and decrypts with the password.
test('encrypted backup file round-trips through export/import shape', () => {
  const identity = createIdentity();
  const password = 'orbital drop shock trooper';
  const blob = encryptIdentity(identity, password);

  const backupFile = { type: 'gooncitizen-identity-backup', v: 2, vault: blob };
  const parsed = JSON.parse(JSON.stringify(backupFile));
  assert.strictEqual(parsed.type, 'gooncitizen-identity-backup');
  assert.ok(!JSON.stringify(parsed).includes(identity.xprv));
  const restored = parsed.vault;

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
  const blob = encryptIdentity(identity, 'a strong password here');
  assert.throws(
    () => identityStore.saveEncrypted(dir, Object.assign({}, blob, { xprv: identity.xprv })),
    /plaintext secrets/
  );
  assert.throws(
    () => identityStore.saveEncrypted(dir, Object.assign({}, blob, { mnemonic: identity.mnemonic })),
    /plaintext secrets/
  );

  const file = identityStore.saveEncrypted(dir, blob);
  assert.ok(fs.existsSync(file));
  assert.strictEqual((fs.statSync(file).mode & 0o777).toString(8), '600');
  const loaded = identityStore.loadEncrypted(dir);
  assert.strictEqual(identityBlobSummary(loaded).pubkey, identity.pubkey);
  fs.rmSync(dir, { recursive: true, force: true });
});
