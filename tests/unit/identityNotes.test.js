'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert');

const { Store } = require('../../types/Store');
const { createIdentity, canonicalChatAuthor } = require('../../functions/identity');
const {
  createNote,
  updateNote,
  markShared,
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
