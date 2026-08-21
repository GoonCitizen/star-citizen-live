'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert');

const { Store } = require('../../types/Store');
const { createIdentity } = require('../../functions/identity');
const { createNote, setProfilePinned } = require('../../functions/identityNotes');
const localGroups = require('../../functions/localGroups');
const sync = require('../../functions/deviceDataSync');

describe('deviceDataSync', () => {
  it('builds a cluster share without secrets', () => {
    const alice = createIdentity();
    const store = new Store();
    const note = createNote(store, {
      subject: 'discord:u1',
      body: 'Wing night',
      author: alice.pubkey
    });
    setProfilePinned(store, note.id, true);
    localGroups.createGroup(store, { name: 'Hangar', createdBy: alice.pubkey });
    const share = sync.buildShare({
      fromPubkey: alice.pubkey,
      packs: [
        {
          pack: sync.PACK_PROFILE,
          payload: { pubkey: alice.pubkey, nickname: 'Neorion', bio: 'Pilot', mnemonic: 'leak' }
        },
        {
          pack: sync.PACK_NOTES,
          payload: { notes: store.all('identitynotes') }
        },
        {
          pack: sync.PACK_LOCAL_TAGS,
          payload: { tags: localGroups.listGroups(store) }
        },
        {
          pack: 'future.secret-pack',
          payload: { mnemonic: 'nope' }
        }
      ]
    });
    assert.ok(share);
    assert.strictEqual(share.type, sync.SHARE_TYPE);
    assert.strictEqual(share.fromPubkey, alice.pubkey);
    assert.strictEqual(share.packs.length, 3);
    const profile = share.packs.find((p) => p.pack === sync.PACK_PROFILE);
    assert.strictEqual(profile.payload.nickname, 'Neorion');
    assert.ok(!profile.payload.mnemonic);
    const notes = share.packs.find((p) => p.pack === sync.PACK_NOTES);
    assert.strictEqual(notes.payload.notes[0].body, 'Wing night');
    assert.ok(!share.packs.some((p) => p.pack === 'future.secret-pack'));
  });

  it('sanitizeShare drops a foreign type', () => {
    assert.strictEqual(sync.sanitizeShare({ type: 'GroupDataShare', packs: [] }), null);
  });

  it('keeps account.peers LAN candidates and drops secrets', () => {
    const alice = createIdentity();
    const share = sync.buildShare({
      fromPubkey: alice.pubkey,
      packs: [{
        pack: sync.PACK_PEERS,
        payload: {
          pubkey: alice.pubkey,
          candidates: ['10.0.0.8:7777', '127.0.0.1:7777'],
          mnemonic: 'nope',
          webrtc: { hubs: ['https://hub.fabric.pub', 'http://evil.example'] }
        }
      }]
    });
    assert.ok(share);
    assert.strictEqual(share.packs.length, 1);
    assert.strictEqual(share.packs[0].pack, sync.PACK_PEERS);
    assert.deepEqual(share.packs[0].payload.candidates, ['10.0.0.8:7777']);
    assert.ok(!JSON.stringify(share).includes('nope'));
    assert.ok(!share.packs[0].payload.webrtc.hubs.some((h) => h.startsWith('http:')));
  });

  it('keeps account.files metadata and drops catalog bytes', () => {
    const alice = createIdentity();
    const fileId = 'ab'.repeat(32);
    const share = sync.buildShare({
      fromPubkey: alice.pubkey,
      packs: [{
        pack: sync.PACK_FILES,
        payload: {
          files: [{
            id: fileId,
            sha256: fileId,
            name: 'brief.bin',
            mime: 'application/octet-stream',
            size: 12,
            contentBase64: 'should-not-travel',
            mnemonic: 'nope'
          }]
        }
      }]
    });
    assert.ok(share);
    assert.strictEqual(share.packs.length, 1);
    assert.strictEqual(share.packs[0].pack, sync.PACK_FILES);
    assert.strictEqual(share.packs[0].payload.files[0].name, 'brief.bin');
    assert.ok(!JSON.stringify(share).includes('should-not-travel'));
    assert.ok(!JSON.stringify(share).includes('nope'));
    assert.ok(!JSON.stringify(share).includes('contentBase64'));
  });

  it('always ships account.stats counts and drops unknown fields', () => {
    const alice = createIdentity();
    const share = sync.buildShare({
      fromPubkey: alice.pubkey,
      packs: [{
        pack: sync.PACK_STATS,
        payload: {
          notes: 12,
          logs: 6,
          missions: 40,
          mnemonic: 'nope',
          token: 'leak'
        }
      }]
    });
    assert.ok(share);
    const stats = share.packs.find((p) => p.pack === sync.PACK_STATS);
    assert.ok(stats);
    assert.equal(stats.payload.notes, 12);
    assert.equal(stats.payload.logs, 6);
    assert.equal(stats.payload.groups, 0);
    assert.ok(!JSON.stringify(share).includes('nope'));
    assert.ok(!JSON.stringify(share).includes('leak'));
  });

  it('chunks a large chat pack into AMP-safe DeviceDataShare frames', () => {
    const Key = require('@fabric/core/types/key');
    const Message = require('@fabric/core/types/message');
    const key = new Key();
    const messages = [];
    for (let i = 0; i < 40; i++) {
      messages.push({
        id: String(i).padStart(32, '0'),
        channel: 'global',
        body: ('o7 from desktop ' + i + ' ').repeat(18),
        author: key.pubkey,
        ts: '2026-08-15T20:00:' + String(i).padStart(2, '0') + '.000Z'
      });
    }
    const shares = sync.chunkShares({
      fromPubkey: key.pubkey,
      packs: [{ pack: sync.PACK_CHAT, payload: { messages } }]
    });
    assert.ok(shares.length > 1, 'expected multiple AMP frames, got ' + shares.length);
    const contract = 'ab'.repeat(32);
    for (const share of shares) {
      assert.ok(sync.shareFitsAmp(share));
      const body = JSON.stringify({
        contract,
        type: 'DeviceDataShare',
        actor: { publicKey: key.pubkey, id: key.pubkey },
        object: share
      });
      const buf = Message.fromVector(['CONTRACT_MESSAGE', body]).signWithKey(key).toBuffer();
      assert.ok(buf.length <= sync.AMP_FRAME_MAX, 'oversized frame ' + buf.length);
      const chat = share.packs.find((p) => p.pack === sync.PACK_CHAT);
      assert.ok(chat);
      assert.ok(chat.payload.messages.length >= 1);
    }
  });

  it('selectChatForShare keeps the newest rows and discord ids', () => {
    const alice = createIdentity();
    const rows = [];
    for (let i = 0; i < sync.MAX_CHAT + 5; i++) {
      const ts = new Date(Date.UTC(2026, 7, 15, 0, 0, i)).toISOString();
      rows.push({
        id: 'id' + i,
        channel: 'global',
        body: 'msg ' + i,
        author: alice.pubkey,
        ts,
        discordMessageId: i === sync.MAX_CHAT + 4 ? 'snow' : undefined
      });
    }
    const pick = sync.selectChatForShare(rows);
    assert.equal(pick.truncated, true);
    assert.equal(pick.messages.length, sync.MAX_CHAT);
    assert.equal(pick.messages[0].body, 'msg 5');
    const withDiscord = pick.messages[pick.messages.length - 1];
    assert.equal(withDiscord.body, 'msg ' + (sync.MAX_CHAT + 4));
    assert.equal(withDiscord.discordMessageId, 'snow');
  });
});
