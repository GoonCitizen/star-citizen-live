'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { Level } = require('../../functions/androidMemoryLevel');

describe('androidMemoryLevel', () => {
  it('implements the Level get/put/close surface Peer uses', async () => {
    const db = new Level('stores/peers');
    assert.equal(db.status, 'open');
    await assert.rejects(() => db.get('peers'), (err) => err && err.notFound === true);
    await db.put('peers', '[]');
    assert.equal(await db.get('peers'), '[]');
    await db.close();
    assert.equal(db.status, 'closed');
  });
});

describe('LiveRelay Android boot', () => {
  it('does not require @fabric/discord until the bot starts', () => {
    const src = fs.readFileSync(path.join(__dirname, '../../services/LiveRelay.js'), 'utf8');
    assert.match(src, /function loadFabricDiscord/);
    const hits = [...src.matchAll(/require\('@fabric\/discord'\)/g)];
    assert.equal(hits.length, 1);
    const idx = src.indexOf("require('@fabric/discord')");
    assert.ok(src.lastIndexOf('function loadFabricDiscord', idx) > -1);
  });
});
