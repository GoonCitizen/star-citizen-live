'use strict';

const test = require('node:test');
const assert = require('node:assert');

const { Store } = require('../../types/Store');
const GroupManager = require('../../services/GroupManager');
const Group = require('../../types/Group');
const {
  groupContractDefinition,
  groupContractId
} = require('../../contracts/gooncitizenGroup');
const groupStatechain = require('../../functions/groupStatechain');
const {
  signGroupStateTip,
  verifyGroupStateTip,
  groupFabricIdentity,
  signingStringForGroupState
} = require('../../functions/groupStateSigning');
const { fixtureIdentity, FIXTURE_PUBKEYS } = require('./fixtures/identities');

test('fixture identities are stable BIP39 seeds', () => {
  const alice = fixtureIdentity('alice');
  const bob = fixtureIdentity('bob');
  assert.strictEqual(alice.pubkey, FIXTURE_PUBKEYS.alice);
  assert.strictEqual(bob.pubkey, FIXTURE_PUBKEYS.bob);
  assert.notStrictEqual(alice.pubkey, bob.pubkey);
});

test('invite shell prefers groupId + groupName over invite-* / note', () => {
  const alice = fixtureIdentity('alice');
  const gm = new GroupManager({});
  const def = groupContractDefinition({
    groupId: 'group-wing-canonical',
    creator: alice.pubkey,
    validators: [alice.pubkey],
    threshold: 1,
    createdAt: '2026-01-01T00:00:00.000Z',
    meta: { name: 'Canonical Wing', visibility: 'private' }
  });
  const contractId = groupContractId(def);
  const shell = gm.ingestFederationInviteShell({
    inviteId: 'inv-1',
    contractId,
    inviterHubId: alice.pubkey,
    note: 'please ignore this note as the name',
    groupId: def.groupId,
    groupName: 'Canonical Wing',
    proposedPolicy: def.proposedPolicy,
    invitedAt: Date.parse('2026-01-01T00:00:00.000Z')
  }, alice.pubkey);
  assert.ok(shell && shell.created);
  assert.strictEqual(shell.group.id, 'group-wing-canonical');
  assert.strictEqual(shell.group.name, 'Canonical Wing');
  assert.strictEqual(shell.group.contractId, contractId);
  const identity = groupFabricIdentity(shell.group);
  assert.strictEqual(identity.id, contractId);
  assert.strictEqual(identity.groupId, 'group-wing-canonical');
});

test('member Schnorr tip attests folded stateDigest; journal batch replays', () => {
  const alice = fixtureIdentity('alice');
  const bob = fixtureIdentity('bob');
  const store = new Store({});
  const def = groupContractDefinition({
    groupId: 'group-journal-1',
    creator: alice.pubkey,
    validators: [alice.pubkey],
    threshold: 1,
    createdAt: '2026-01-01T00:00:00.000Z',
    meta: { name: 'Journal Wing', visibility: 'private' }
  });
  const contractId = groupContractId(def);
  groupStatechain.publishFoldedContent(store, contractId, def);

  const change = {
    id: 'gchg-bob-1',
    action: 'member.add',
    groupId: def.groupId,
    contractId,
    actor: alice.pubkey,
    member: bob.pubkey,
    ts: '2026-01-01T01:00:00.000Z'
  };
  const appended = groupStatechain.appendAccepted(store, contractId, {
    id: change.id,
    type: 'GroupChange',
    message: change,
    acceptedAt: change.ts,
    fabricMessage: {
      hash: 'deadbeef',
      hex: '00',
      type: 'GroupChange'
    }
  }, def);
  assert.ok(appended.appended);

  const tip = signGroupStateTip(
    alice,
    contractId,
    appended.head.clock,
    groupStatechain.stateDigestOfContent(appended.content)
  );
  const group = new Group({
    id: def.groupId,
    name: 'Journal Wing',
    creator: alice.pubkey,
    members: [alice.pubkey, bob.pubkey],
    threshold: 1,
    contractId
  });
  assert.ok(verifyGroupStateTip(
    group,
    contractId,
    appended.head.clock,
    groupStatechain.stateDigestOfContent(appended.content),
    { [tip.pubkey]: tip.signature }
  ));
  assert.ok(signingStringForGroupState(contractId, appended.head.clock,
    groupStatechain.stateDigestOfContent(appended.content)).includes(contractId));

  const batch = groupStatechain.buildJournalBatch(store, contractId, def, 1);
  assert.strictEqual(batch.groupId, def.groupId);
  assert.strictEqual(batch.groupName, 'Journal Wing');
  assert.strictEqual(batch.entries.length, 1);
  assert.ok(batch.entries[0].fabricMessage && batch.entries[0].fabricMessage.hash === 'deadbeef');
  batch.signatures = { [tip.pubkey]: tip.signature };

  const peerStore = new Store({});
  const gm = new GroupManager({ store: peerStore });
  gm.ingestFederationInviteShell({
    inviteId: 'inv-j',
    contractId,
    inviterHubId: alice.pubkey,
    groupId: def.groupId,
    groupName: 'Journal Wing',
    proposedPolicy: def.proposedPolicy
  }, alice.pubkey);
  // Persist genesis so fold has a definition.
  const data = peerStore.get('groups', def.groupId);
  data._contractDefinition = def;
  peerStore.put('groups', def.groupId, data);

  const merged = gm.ingestJournalBatch(batch, alice.pubkey);
  assert.ok(merged.applied >= 1);
  assert.strictEqual(merged.verified, true);
  assert.ok(merged.group.members.map((m) => m.toLowerCase()).includes(bob.pubkey.toLowerCase()));
});
