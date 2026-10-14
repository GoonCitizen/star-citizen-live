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

/** Expected Fabric-protocol compressed pubkeys (Identity path, not HD master). */
const FIXTURE_PUBKEYS = Object.freeze({
  alice: '0303c3a8590fae22877856063ddcf9202bcf0c36e42acc30aaa5d122c77f123f0b',
  bob: '0347e7a5449ad0238e5148987609d70b7a93d518b2e598db1be03e6fcdb9f97710',
  carol: '0322210f70c00a16f8c7f92c605cd43ee8988b0c0f51b6fe7174fd4885a145f46d',
  hub: '031c7e95d402f58468a854c5df39fff9e324df95bca149aeb906fac6f37312b94f'
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
