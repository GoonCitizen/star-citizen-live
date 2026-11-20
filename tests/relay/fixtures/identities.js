'use strict';

/**
 * Deterministic BIP39 identities for relay / Fabric mesh tests.
 *
 * These mnemonics are committed fixtures (not production secrets). Restore with
 * {@link restoreIdentity} so Alice/Bob/Carol/Hub pubkeys stay stable across runs.
 */

const { restoreIdentity, keyFromIdentity, cosignerKeyFromIdentity } = require('../../../functions/identity');

const FIXTURE_SEEDS = Object.freeze({
  alice: 'client cinnamon second donor actor harvest crucial century horse dry leopard repeat',
  bob: 'subway kitten various venture myself member stool make syrup flight turkey marble',
  carol: 'raw draft couch trip auction coin fan any oil alone answer liar',
  hub: 'myth claw rebuild blind cotton kid sample doctor betray waste box surface'
});

/** Expected Fabric-protocol compressed pubkeys (Identity path, not HD master). */
const FIXTURE_PUBKEYS = Object.freeze({
  alice: '0309b9aa77b33a34e679c3dd54180b43935f0673ff83c11f4ac9a4ffc451f85300',
  bob: '02efb3bccba4c22c492fe743c26a263dbdcb5d2a1c3634c6a2c7749043abb91fb2',
  carol: '037ae8230da0c06cb14c757ab115b4e2b4617c7771ba779588accc4b18d0ea7df9',
  hub: '021c564120d08b85b29d759e75dfa951391090a03c53da64ede2a03d1936f0208b'
});

/**
 * @param {'alice'|'bob'|'carol'|'hub'} name
 * @returns {{ mnemonic: string, xprv: string, xpub: string, pubkey: string, id: string }}
 */
function fixtureIdentity (name) {
  const mnemonic = FIXTURE_SEEDS[name];
  if (!mnemonic) throw new Error(`unknown fixture identity: ${name}`);
  const identity = restoreIdentity({ mnemonic });
  const expected = FIXTURE_PUBKEYS[name];
  if (expected && identity.pubkey !== expected) {
    throw new Error(
      `fixture ${name} pubkey drift: got ${identity.pubkey}, expected ${expected}`
    );
  }
  return identity;
}

/**
 * @param {'alice'|'bob'|'carol'|'hub'} name
 * @returns {import('@fabric/core/types/key')}
 */
function fixtureKey (name) {
  return keyFromIdentity(fixtureIdentity(name));
}

/**
 * Account 0 cosigner key (`m/87'/B'/0'/0/0`) for group wallets.
 * @param {'alice'|'bob'|'carol'|'hub'} name
 * @param {string} [network='regtest']
 * @returns {import('@fabric/core/types/key')}
 */
function fixtureCosignerKey (name, network = 'regtest') {
  return cosignerKeyFromIdentity(fixtureIdentity(name), network);
}

module.exports = {
  FIXTURE_SEEDS,
  FIXTURE_PUBKEYS,
  fixtureIdentity,
  fixtureKey,
  fixtureCosignerKey
};
