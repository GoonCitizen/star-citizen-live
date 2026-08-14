'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert');

const profileFiles = require('../../functions/profileFiles');

const PUBKEY = '02' + 'ab'.repeat(32);

describe('profile.files listing pack', () => {
  it('compacts published metadata and drops blob bytes / unpublished rows', () => {
    const payload = profileFiles.compactFilesPayload({
      pubkey: PUBKEY,
      files: [
        {
          id: 'aa'.repeat(32),
          sha256: 'aa'.repeat(32),
          name: 'gooncitizen.dmg',
          mime: 'application/octet-stream',
          size: 4096,
          published: true,
          purchasePriceSats: 4,
          merkleRootHex: 'bb'.repeat(32),
          blobTotal: 2,
          documentBlobIndex: { blobs: [{ content: 'nope' }] },
          blobs: [{ contentBase64: 'AAAA' }]
        },
        {
          id: 'cc'.repeat(32),
          name: 'draft.txt',
          published: false,
          size: 12
        }
      ]
    });
    assert.ok(payload);
    assert.strictEqual(payload.pubkey, PUBKEY);
    assert.strictEqual(payload.files.length, 1);
    assert.strictEqual(payload.files[0].name, 'gooncitizen.dmg');
    assert.strictEqual(payload.files[0].purchasePriceSats, 4);
    assert.ok(!payload.files[0].blobs);
    assert.ok(!payload.files[0].documentBlobIndex);
    assert.ok(payload.files[0].href.includes('/files/'));
    assert.strictEqual(payload.files[0].publisher, PUBKEY);
    assert.ok(!payload.truncated);
  });

  it('pinnedOnly skips catalog rows that are not pinned to the profile', () => {
    const payload = profileFiles.compactFilesPayload({
      pubkey: PUBKEY,
      pinnedOnly: true,
      files: [
        {
          id: 'aa'.repeat(32),
          name: 'draft.dmg',
          published: true,
          profilePinned: false,
          size: 10
        },
        {
          id: 'bb'.repeat(32),
          name: 'gooncitizen.apk',
          published: true,
          profilePinned: true,
          size: 20
        }
      ]
    });
    assert.ok(payload);
    assert.strictEqual(payload.files.length, 1);
    assert.strictEqual(payload.files[0].name, 'gooncitizen.apk');
  });

  it('folds into datasync and reloads by pubkey', () => {
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
    const folded = profileFiles.foldFiles(store, {
      pubkey: PUBKEY,
      files: [{
        id: 'dd'.repeat(32),
        name: 'app.apk',
        mime: 'application/vnd.android.package-archive',
        size: 2048,
        published: true,
        purchasePriceSats: 2
      }]
    }, { via: 'gossip', pubkey: PUBKEY, groupId: 'grp1' });
    assert.ok(folded);
    assert.strictEqual(folded.pack, 'profile.files');
    const loaded = profileFiles.loadFiles(store, PUBKEY);
    assert.ok(loaded);
    assert.strictEqual(loaded.files[0].name, 'app.apk');
    assert.strictEqual(profileFiles.loadAllFiles(store).length, 1);
  });
});
