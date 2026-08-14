'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { Store } = require('../../types/Store');
const localDocuments = require('../../functions/localDocuments');
const {
  mimeForFilename,
  skipDistName,
  isBuildArtifactName,
  listBuildArtifacts,
  resolveIngestPath,
  SPA_NAME
} = require('../../functions/publishBuildDocuments');

describe('publishBuildDocuments discovery', () => {
  it('maps installer mime types and skips electron-builder sidecars', () => {
    assert.equal(mimeForFilename('GoonCitizen.dmg'), 'application/x-apple-diskimage');
    assert.equal(mimeForFilename('app.apk'), 'application/vnd.android.package-archive');
    assert.equal(isBuildArtifactName('gooncitizen_0.1.0_amd64.deb'), true);
    assert.equal(skipDistName('GoonCitizen-1.0.0-arm64.dmg.blockmap'), true);
    assert.equal(skipDistName('latest-mac.yml'), true);
    assert.equal(skipDistName('gooncitizen_0.1.0_amd64.deb'), false);
  });

  it('lists SPA, dist installers, and APKs from a fake tree', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gc-builds-'));
    try {
      fs.mkdirSync(path.join(root, 'assets'), { recursive: true });
      fs.writeFileSync(path.join(root, 'assets', 'index.html'), '<html>dash</html>');
      fs.mkdirSync(path.join(root, 'dist'), { recursive: true });
      fs.writeFileSync(path.join(root, 'dist', 'GoonCitizen.dmg'), 'dmg');
      fs.writeFileSync(path.join(root, 'dist', 'GoonCitizen.dmg.blockmap'), 'map');
      fs.writeFileSync(path.join(root, 'dist', 'latest-mac.yml'), 'ver: 1');
      const apkDir = path.join(root, 'android', 'app', 'build', 'outputs', 'apk', 'debug');
      fs.mkdirSync(apkDir, { recursive: true });
      fs.writeFileSync(path.join(apkDir, 'app-debug.apk'), 'apk');

      const rows = listBuildArtifacts(root);
      const names = rows.map((r) => r.name).sort();
      assert.deepEqual(names, ['GoonCitizen.dmg', SPA_NAME, 'app-debug.apk'].sort());
      assert.ok(rows.every((r) => fs.existsSync(r.path)));
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('resolveIngestPath stays inside the repo and skips stores', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gc-ingest-'));
    try {
      const asset = path.join(root, 'assets', 'index.html');
      fs.mkdirSync(path.dirname(asset), { recursive: true });
      fs.writeFileSync(asset, 'ok');
      assert.equal(resolveIngestPath(asset, root), fs.realpathSync(asset));

      const secret = path.join(root, 'stores', 'gooncitizen', 'x.bin');
      fs.mkdirSync(path.dirname(secret), { recursive: true });
      fs.writeFileSync(secret, 'nope');
      assert.throws(() => resolveIngestPath(secret, root), /not a publishable/);

      const outside = path.join(os.tmpdir(), 'gc-outside-' + Date.now() + '.bin');
      fs.writeFileSync(outside, 'out');
      try {
        assert.throws(() => resolveIngestPath(outside, root), /inside the GoonCitizen repo/);
      } finally {
        fs.unlinkSync(outside);
      }
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});

describe('localDocuments createFromFile', () => {
  it('writes a disk blob and is idempotent on sha256', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gc-docs-'));
    const store = new Store({ path: null });
    try {
      const src = path.join(dir, 'build.html');
      fs.writeFileSync(src, '<html>spa</html>');
      const blobDir = path.join(dir, 'blobs');
      const a = localDocuments.createFromFile(store, src, { name: 'dash.html', mime: 'text/html' }, { dir: blobDir });
      const b = localDocuments.createFromFile(store, src, { name: 'other.html' }, { dir: blobDir });
      assert.equal(a.id, b.id);
      assert.equal(a.name, 'dash.html');
      assert.ok(fs.existsSync(path.join(blobDir, a.id + '.bin')));
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
