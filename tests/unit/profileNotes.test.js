'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert');

const { Store } = require('../../types/Store');
const { createIdentity } = require('../../functions/identity');
const { createNote, setProfilePinned } = require('../../functions/identityNotes');
const profileNotes = require('../../functions/profileNotes');

describe('profile.notes listing pack', () => {
  it('compacts pinned notes and drops private share targets', () => {
    const store = new Store();
    const alice = createIdentity();
    const note = createNote(store, {
      subject: 'discord:u1',
      handle: 'cara',
      body: 'Watch this one',
      author: alice.pubkey
    });
    setProfilePinned(store, note.id, true);
    const payload = profileNotes.compactNotesPayload({
      pubkey: alice.pubkey,
      pinnedOnly: true,
      notes: store.all('identitynotes')
    });
    assert.ok(payload);
    assert.strictEqual(payload.pubkey, alice.pubkey);
    assert.strictEqual(payload.notes.length, 1);
    assert.strictEqual(payload.notes[0].body, 'Watch this one');
    assert.strictEqual(payload.notes[0].subject, 'discord:u1');
    assert.strictEqual(payload.notes[0].author, alice.pubkey);
    assert.ok(!payload.notes[0].sharePeerPubkey);
  });

  it('pinnedOnly skips notes that are not pinned to a profile', () => {
    const store = new Store();
    const alice = createIdentity();
    createNote(store, {
      subject: alice.pubkey,
      body: 'Private scratch',
      author: alice.pubkey
    });
    const pinned = createNote(store, {
      subject: 'discord:u2',
      body: 'Public warning',
      author: alice.pubkey
    });
    setProfilePinned(store, pinned.id, true);
    const payload = profileNotes.compactNotesPayload({
      pubkey: alice.pubkey,
      pinnedOnly: true,
      notes: store.all('identitynotes')
    });
    assert.ok(payload);
    assert.strictEqual(payload.notes.length, 1);
    assert.strictEqual(payload.notes[0].body, 'Public warning');
  });

  it('folds into datasync and reloads by pubkey', () => {
    const alice = createIdentity();
    const rows = {};
    const store = {
      get (collection, id) { return collection === 'datasync' ? (rows[id] || null) : null; },
      put (collection, id, row) {
        if (collection === 'datasync') rows[id] = row;
      },
      all (collection) {
        return collection === 'datasync' ? Object.values(rows) : [];
      }
    };
    const folded = profileNotes.foldNotes(store, {
      pubkey: alice.pubkey,
      notes: [{
        id: 'note-1',
        subject: 'discord:u1',
        body: 'Pinned warning',
        author: alice.pubkey,
        revision: 1
      }]
    }, { via: 'gossip', pubkey: alice.pubkey, groupId: 'grp1' });
    assert.ok(folded);
    const loaded = profileNotes.loadNotes(store, alice.pubkey);
    assert.strictEqual(loaded.notes[0].body, 'Pinned warning');
    assert.strictEqual(profileNotes.loadAllNotes(store).length, 1);
  });
});
