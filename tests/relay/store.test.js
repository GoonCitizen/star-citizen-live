'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { Store, collectionPath } = require('../../types/Store');

describe('GoonCitizen Store ↔ Fabric Store', () => {
  it('memory mode has no fabric instance and still supports sync put/get', () => {
    const store = new Store({ path: null });
    assert.equal(store.fabric, null);
    store.put('groups', 'g1', { id: 'g1', name: 'Wing' });
    assert.deepEqual(store.get('groups', 'g1'), { id: 'g1', name: 'Wing' });
    assert.equal(store.count('groups'), 1);
  });

  it('composes Fabric Store and persists /collections/* across reopen', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sc-store-'));
    const registerDir = path.join(dir, 'register');
    const store = new Store({ path: registerDir });
    await store.start();
    assert.ok(store.fabric, 'exposes underlying Fabric Store');
    assert.equal(collectionPath('missions'), '/collections/missions');

    store.put('missions', 'm1', { id: 'm1', title: 'Salvage' });
    store.put('groupsidechains', 'ab'.repeat(32), {
      id: 'ab'.repeat(32),
      clock: 1,
      content: { hello: true },
      journal: { entries: [] }
    });
    await store.flush();
    await store.stop();

    const reopened = new Store({ path: registerDir });
    await reopened.start();
    assert.ok(reopened.fabric);
    assert.equal(reopened.get('missions', 'm1').title, 'Salvage');
    assert.equal(reopened.get('groupsidechains', 'ab'.repeat(32)).clock, 1);

    const fromFabric = await reopened.fabric.get('/collections/missions');
    assert.ok(fromFabric && fromFabric.m1);
    assert.equal(fromFabric.m1.title, 'Salvage');

    await reopened.stop();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('migrates legacy bare Level collection keys onto /collections/<name>', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sc-store-leg-'));
    const registerDir = path.join(dir, 'register');
    const FabricStore = require('@fabric/core/types/store');
    const fabric = new FabricStore({
      name: '@gooncitizen/register',
      path: registerDir,
      persistent: true,
      verbosity: 0
    });
    await fabric.start();
    await fabric.db.put('missions', JSON.stringify({ legacy: { id: 'legacy', title: 'Old' } }));
    await fabric.stop();

    const store = new Store({ path: registerDir });
    await store.start();
    assert.equal(store.get('missions', 'legacy').title, 'Old');
    const pathMap = await store.fabric.get('/collections/missions');
    assert.equal(pathMap.legacy.title, 'Old');
    await store.stop();
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
