'use strict';

const test = require('node:test');
const assert = require('assert');

const groupPresence = require('../../functions/groupPresence');

const ALICE = '02' + 'aa'.repeat(32);
const BOB = '02' + 'bb'.repeat(32);

test('summarizeOnlineMembers counts ships and locations of online members', () => {
  const roster = {
    [ALICE]: {
      online: true,
      nickname: 'Alice',
      ship: { name: 'Gladius', type: 'Fighter' },
      location: { name: 'Area18', system: 'Stanton' }
    },
    [BOB]: {
      online: false,
      ship: { name: 'Polaris' },
      location: { name: 'Orison' }
    }
  };
  const out = groupPresence.summarizeOnlineMembers([ALICE, BOB], roster);
  assert.equal(out.online, 1);
  assert.equal(out.total, 2);
  assert.deepEqual(out.ships, [{ n: 'Gladius', c: 1 }]);
  assert.deepEqual(out.locations, [{ n: 'Area18', c: 1 }]);
  assert.match(groupPresence.presenceChipLabel(roster[ALICE]), /online · Gladius · Area18/);
  assert.equal(groupPresence.presenceChipLabel(roster[BOB]), 'offline');
});

test('isGroupOwner matches creator pubkey or role', () => {
  assert.equal(groupPresence.isGroupOwner({ role: 'creator' }, ALICE), true);
  assert.equal(groupPresence.isGroupOwner({ creator: ALICE }, ALICE), true);
  assert.equal(groupPresence.isGroupOwner({ creator: ALICE, role: 'member' }, BOB), false);
});
