'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const LiveRelay = require('../../services/LiveRelay');
const { createIdentity } = require('../../functions/identity');
const { request } = require('../helpers/http');
const groupDataSync = require('../../functions/groupDataSync');

const BASE = '/services/star-citizen';

async function startRelay () {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sc-app-search-'));
  const svc = new LiveRelay({
    port: 0,
    listen: true,
    mode: 'relay',
    settingsDir: dir,
    fabric: { enable: false, listen: false, port: 0, peers: [] },
    missions: { enable: false },
    discord: { enable: false }
  });
  await svc.start();
  return { svc, dir, port: svc.server.address().port };
}

describe('GET /search local data packs', () => {
  it('finds identity notes and reports indexed packs', async () => {
    const { svc, dir, port } = await startRelay();
    const alice = createIdentity();
    try {
      svc.setIdentity(alice);
      const note = await request(port, 'POST', `${BASE}/notes`, {
        subject: 'discord:u1',
        handle: 'Cara',
        body: 'Nights-only gunner'
      });
      assert.strictEqual(note.status, 200);

      const empty = await request(port, 'GET', `${BASE}/search?q=`);
      assert.strictEqual(empty.status, 200);
      assert.strictEqual(empty.body.type, 'AppSearch');
      assert.deepStrictEqual(empty.body.data.hits, []);
      assert.ok(empty.body.data.packs.some((p) => p.pack === groupDataSync.PACK_CHAT_CATALOG));

      const found = await request(port, 'GET', `${BASE}/search?q=${encodeURIComponent('nights gunner')}`);
      assert.strictEqual(found.status, 200);
      assert.ok(found.body.data.hits.some((h) => h.kind === 'note' && /gunner/i.test(h.title)));
      assert.ok(found.body.data.hits.some((h) => h.kind === 'person' && /cara/i.test(h.title)));
    } finally {
      await svc.stop();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
