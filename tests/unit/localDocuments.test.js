'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { Store } = require('../../types/Store');
const localDocuments = require('../../functions/localDocuments');

describe('localDocuments', () => {
  it('creates, lists, gets, and publishes on this node (memory store)', () => {
    const store = new Store({});
    const created = localDocuments.create(store, {
      name: 'note.txt',
      mime: 'text/plain',
      contentBase64: Buffer.from('o7 fleet', 'utf8').toString('base64')
    });
    assert.ok(created.id);
    assert.strictEqual(created.local, true);
    assert.strictEqual(created.published, false);
    assert.strictEqual(created.name, 'note.txt');

    const listed = localDocuments.list(store);
    assert.strictEqual(listed.length, 1);
    assert.strictEqual(listed[0].id, created.id);
    assert.ok(!listed[0].contentBase64);

    const got = localDocuments.get(store, created.id);
    assert.ok(got.document.contentBase64);
    assert.strictEqual(
      Buffer.from(got.document.contentBase64, 'base64').toString('utf8'),
      'o7 fleet'
    );

    const published = localDocuments.publish(store, created.id, { purchasePriceSats: 25 });
    assert.strictEqual(published.published, true);
    assert.strictEqual(published.purchasePriceSats, 25);
  });

  it('dedupes by content hash and writes blobs when a dir is set', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gc-docs-'));
    const store = new Store({});
    const payload = {
      name: 'a.bin',
      mime: 'application/octet-stream',
      contentBase64: Buffer.from('same-bytes', 'utf8').toString('base64')
    };
    const a = localDocuments.create(store, payload, { dir });
    const b = localDocuments.create(store, payload, { dir });
    assert.strictEqual(a.id, b.id);
    assert.strictEqual(localDocuments.list(store).length, 1);
    assert.ok(fs.existsSync(path.join(dir, a.id + '.bin')));
    const got = localDocuments.get(store, a.id, { dir });
    assert.strictEqual(
      Buffer.from(got.document.contentBase64, 'base64').toString('utf8'),
      'same-bytes'
    );
  });

  it('rejects empty payloads', () => {
    const store = new Store({});
    assert.throws(() => localDocuments.create(store, {}), /contentBase64/);
  });

  it('rejects OpenSSF / GHSA bulk security-advisory payloads', () => {
    const store = new Store({});
    const body = JSON.stringify({
      security_advisory: { ghsa_id: 'GHSA-aaaa-bbbb-cccc', type: 'malware' }
    });
    assert.throws(
      () => localDocuments.create(store, {
        name: 'advisory.json',
        mime: 'application/json',
        contentBase64: Buffer.from(body, 'utf8').toString('base64')
      }),
      /bulk security advisory/
    );
    assert.throws(
      () => localDocuments.create(store, {
        name: '@zalastax/nolb-abcdef',
        mime: 'application/json',
        contentBase64: Buffer.from('{"ok":true}', 'utf8').toString('base64')
      }),
      /bulk security advisory/
    );
    assert.strictEqual(localDocuments.list(store).length, 0);
  });

  it('opts a row into cluster sync and fills a placeholder from bytes', () => {
    const store = new Store({});
    const created = localDocuments.create(store, {
      name: 'cluster.txt',
      mime: 'text/plain',
      contentBase64: Buffer.from('cluster-bytes', 'utf8').toString('base64')
    });
    const flagged = localDocuments.setClusterSync(store, created.id, true);
    assert.strictEqual(flagged.clusterSync, true);
    assert.strictEqual(localDocuments.list(store)[0].clusterSync, true);

    const other = new Store({});
    const pending = localDocuments.ensureClusterPlaceholder(other, {
      id: created.id,
      sha256: created.sha256,
      name: 'cluster.txt',
      mime: 'text/plain',
      size: created.size
    });
    assert.ok(pending.clusterPending);
    assert.strictEqual(pending.clusterSync, true);
    const filled = localDocuments.createFromBuffer(
      other,
      Buffer.from('cluster-bytes', 'utf8'),
      { clusterSync: true }
    );
    assert.strictEqual(filled.id, created.id);
    assert.strictEqual(filled.clusterSync, true);
    assert.ok(!filled.clusterPending);
    const got = localDocuments.get(other, created.id);
    assert.strictEqual(
      Buffer.from(got.document.contentBase64, 'base64').toString('utf8'),
      'cluster-bytes'
    );
  });
});
