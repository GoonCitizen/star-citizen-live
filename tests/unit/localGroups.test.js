'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert');

const { Store } = require('../../types/Store');
const { createIdentity, canonicalChatAuthor } = require('../../functions/identity');
const {
  canonicalActor,
  actorKind,
  createGroup,
  addMember,
  removeMember,
  deleteGroup,
  listGroups,
  groupsForActor,
  getGroup
} = require('../../functions/localGroups');

describe('localGroups', () => {
  it('canonicalizes Discord snowflakes and Fabric pubkeys', () => {
    assert.strictEqual(canonicalActor('discord:u1'), 'discord:u1');
    assert.strictEqual(canonicalActor('123456789012345678'), 'discord:123456789012345678');
    const alice = createIdentity();
    assert.strictEqual(canonicalActor(alice.pubkey), canonicalChatAuthor(alice.pubkey));
    assert.strictEqual(actorKind('discord:u1'), 'discord');
    assert.strictEqual(actorKind(canonicalActor(alice.pubkey)), 'fabric');
    assert.strictEqual(canonicalActor(''), null);
  });

  it('creates tags, adds and removes Discord and Fabric members', () => {
    const store = new Store();
    const alice = createIdentity();
    const group = createGroup(store, { name: 'Hangar crew', createdBy: alice.pubkey });
    assert.strictEqual(group['@type'], 'LocalGroup');
    assert.ok(group.id.indexOf('lg-') === 0);
    addMember(store, group.id, { actor: 'discord:u1', handle: 'Alice' });
    addMember(store, group.id, { pubkey: alice.pubkey, handle: 'Neorion' });
    const loaded = getGroup(store, group.id);
    assert.strictEqual(loaded.members.length, 2);
    assert.ok(loaded.members.some((m) => m.actor === 'discord:u1' && m.kind === 'discord'));
    assert.ok(loaded.members.some((m) => m.kind === 'fabric' && m.handle === 'Neorion'));
    addMember(store, group.id, { actor: 'discord:u1', handle: 'Alice' });
    assert.strictEqual(getGroup(store, group.id).members.length, 2);
    removeMember(store, group.id, 'discord:u1');
    assert.strictEqual(getGroup(store, group.id).members.length, 1);
    assert.strictEqual(groupsForActor(store, alice.pubkey).length, 1);
    assert.strictEqual(groupsForActor(store, 'discord:u1').length, 0);
    deleteGroup(store, group.id);
    assert.strictEqual(listGroups(store).length, 0);
  });

  it('rejects empty names and unknown actors', () => {
    const store = new Store();
    assert.throws(() => createGroup(store, { name: '  ' }), /name required/);
    const group = createGroup(store, { name: 'Officers' });
    assert.throws(() => addMember(store, group.id, { actor: 'not-a-key' }), /actor required/);
    assert.throws(() => getGroup(store, 'missing') || addMember(store, 'missing', { actor: 'discord:u1' }), /not found/i);
  });
});
