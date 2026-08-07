'use strict';

/**
 * Deterministic BIP39 identities for relay / Fabric mesh tests.
 *
 * These mnemonics are committed fixtures (not production secrets). Restore with
 * {@link restoreIdentity} so Alice/Bob/Carol/Hub pubkeys stay stable across runs.
 */

const { restoreIdentity, keyFromIdentity } = require('../../../functions/identity');

const FIXTURE_SEEDS = Object.freeze({
  alice: 'client cinnamon second donor actor harvest crucial century horse dry leopard repeat',
  bob: 'subway kitten various venture myself member stool make syrup flight turkey marble',
  carol: 'raw draft couch trip auction coin fan any oil alone answer liar',
  hub: 'myth claw rebuild blind cotton kid sample doctor betray waste box surface'
});

/** Expected compressed pubkeys for the fixtures above (assert in tests if drifted). */
const FIXTURE_PUBKEYS = Object.freeze({
  alice: '0248dfb2941f5c815a40ebff9a980f675a8dd96b993c1d97f7a28ab83af44d73d9',
  bob: '023475805c577db507a58a1559b8081bd0c7cba07b6a69b58fd0d331ae56954578',
  carol: '03f4e445d03086d25c61fec8ee55f40cc7e4fe4ff04a1b4edcfcd0f7a0c53dea44',
  hub: '02baeac87ad39114eebf84059e31a51a8f9a0ef3110b56d085b645f397fd86f282'
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

module.exports = {
  FIXTURE_SEEDS,
  FIXTURE_PUBKEYS,
  fixtureIdentity,
  fixtureKey
};
