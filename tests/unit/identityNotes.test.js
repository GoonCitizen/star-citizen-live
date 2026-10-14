'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert');

const { Store } = require('../../types/Store');
const { createIdentity, canonicalChatAuthor } = require('../../functions/identity');
const {
  createNote,
  updateNote,
  markShared,
  setProfilePinned,
  buildSharePayload,
  ingestShare,
  listNotes,
  getNote,
  SHARE_TYPE,
  UPDATE_TYPE
} = require('../../functions/identityNotes');

describe('identityNotes', () => {
  it('creates and updates a note on a Discord identity', () => {
    const store = new Store();
    const alice = createIdentity();
    const note = createNote(store, {
      subject: 'discord:u1',
      handle: 'alice',
      body: 'Reliable wingman',
      author: alice.pubkey
    });
    assert.strictEqual(note['@type'], 'IdentityNote');
    assert.strictEqual(note.subject, 'discord:u1');
    assert.strictEqual(note.visibility, 'private');
    assert.strictEqual(note.revision, 1);
    const updated = updateNote(store, note.id, { body: 'Reliable wingman · nights' });
    assert.strictEqual(updated.revision, 2);
    assert.strictEqual(listNotes(store, { subject: 'discord:u1' }).length, 1);
  });

  it('builds a peer share payload and ingests a higher revision', () => {
    const store = new Store();
    const alice = createIdentity();
    const bob = createIdentity();
    const note = createNote(store, {
      subject: alice.pubkey,
      handle: 'Neorion',
      body: 'Callsign confirmed',
      author: bob.pubkey
    });
    const shared = markShared(store, note.id, { scope: 'peer', peerPubkey: alice.pubkey });
    assert.strictEqual(shared.visibility, 'peer');
    const payload = buildSharePayload(shared, {
      scope: 'peer',
      peerPubkey: alice.pubkey,
      author: canonicalChatAuthor(bob.pubkey)
    });
    assert.strictEqual(payload.type, SHARE_TYPE);
    assert.strictEqual(payload.subject, canonicalChatAuthor(alice.pubkey));
    assert.ok(payload.peerA);
    assert.ok(payload.peerB);

    const remote = new Store();
    const first = ingestShare(remote, payload, bob.pubkey);
    assert.ok(first);
    const updatePayload = Object.assign({}, payload, {
      type: UPDATE_TYPE,
      '@type': UPDATE_TYPE,
      body: 'Callsign confirmed · updated',
      revision: 3
    });
    const second = ingestShare(remote, updatePayload, bob.pubkey);
    assert.strictEqual(second.revision, 3);
    assert.strictEqual(getNote(remote, note.id).body, 'Callsign confirmed · updated');
    const stale = ingestShare(remote, payload, bob.pubkey);
    assert.strictEqual(stale.revision, 3);
  });

  it('pins a note to a profile without changing visibility', () => {
    const store = new Store();
    const alice = createIdentity();
    const note = createNote(store, {
      subject: 'discord:u1',
      body: 'Watch this one',
      author: alice.pubkey
    });
    assert.strictEqual(note.profilePinned, false);
    const pinned = setProfilePinned(store, note.id, true);
    assert.strictEqual(pinned.profilePinned, true);
    assert.strictEqual(pinned.visibility, 'private');
    assert.strictEqual(pinned.revision, 2);
    assert.strictEqual(listNotes(store, { profilePinned: true }).length, 1);
    assert.strictEqual(listNotes(store, { author: alice.pubkey }).length, 1);
    const off = setProfilePinned(store, note.id, false);
    assert.strictEqual(off.profilePinned, false);
  });

  it('enforcePrivacy with no viewer returns no notes', () => {
    const store = new Store();
    const alice = createIdentity();
    createNote(store, {
      subject: 'discord:u1',
      body: 'secret',
      author: alice.pubkey
    });
    assert.strictEqual(listNotes(store, { enforcePrivacy: true }).length, 0);
    assert.strictEqual(listNotes(store, { enforcePrivacy: true, viewer: null }).length, 0);
    assert.strictEqual(listNotes(store, { enforcePrivacy: true, viewer: alice.pubkey }).length, 1);
  });

  it('noteVisibleTo hides private notes from other viewers', () => {
    const { noteVisibleTo } = require('../../functions/identityNotes');
    const store = new Store();
    const alice = createIdentity();
    const bob = createIdentity();
    const note = createNote(store, {
      subject: 'discord:u1',
      body: 'secret',
      author: alice.pubkey
    });
    assert.strictEqual(noteVisibleTo(note, alice.pubkey), true);
    assert.strictEqual(noteVisibleTo(note, bob.pubkey), false);
    assert.strictEqual(noteVisibleTo(note, null), false);
    const shared = markShared(store, note.id, { scope: 'peer', peerPubkey: bob.pubkey });
    assert.strictEqual(noteVisibleTo(shared, bob.pubkey), true);
  });

  it('requires a Fabric pubkey to share with a peer', () => {
    const store = new Store();
    const note = createNote(store, { subject: 'discord:u1', body: 'hi' });
    assert.throws(
      () => markShared(store, note.id, { scope: 'peer', peerPubkey: 'discord:u2' }),
      /peerPubkey required/
    );
    assert.throws(
      () => markShared(store, note.id, { scope: 'group' }),
      /groupId required/
    );
  });
});
