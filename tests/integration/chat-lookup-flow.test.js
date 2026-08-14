'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const LiveRelay = require('../../services/LiveRelay');
const { createIdentity } = require('../../functions/identity');
const chatLookup = require('../../functions/chatLookup');
const { request, wait } = require('../helpers/http');

const BASE = '/services/star-citizen';

describe('Chat /lookup Request→Claim→Response flow', () => {
  it('posts a lookup reply after the local claim settles', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sc-lookup-int-'));
    const alice = createIdentity();
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
    const port = svc.server.address().port;
    try {
      svc.setIdentity(alice);
      svc._lookupClaimSettleMs = 20;
      svc.handleLogChange(
        '<2026-08-12T12:00:00.000Z> [Notice] <Legacy login response> [CIG-net] User Login Success - Handle[GoonPilot] - Time[1]'
      );

      const posted = await request(port, 'POST', `${BASE}/chat/messages`, {
        channel: 'global',
        body: '/lookup GoonPilot'
      });
      assert.strictEqual(posted.status, 200, JSON.stringify(posted.body));
      assert.ok(posted.body.data && posted.body.data.id);

      await wait(250);

      const recent = svc._lookupCoord.listRecent(20);
      const reqRow = recent.find((r) => r.type === chatLookup.LOOKUP_REQUEST);
      assert.ok(reqRow, 'LookupRequest journaled');
      const tree = svc.lookupSequenceTree(reqRow.object.requestId);
      assert.strictEqual(tree.type, 'LookupSequenceTree');
      assert.ok(tree.winningClaim);
      assert.ok(tree.responses.length >= 1);

      const msgs = await request(port, 'GET', `${BASE}/chat/messages?channel=global`);
      assert.strictEqual(msgs.status, 200);
      const bodies = (msgs.body.data || []).map((m) => m.body);
      assert.ok(bodies.some((b) => b === '/lookup GoonPilot'));
      assert.ok(bodies.some((b) => /Lookup «GoonPilot»/.test(b) && /GoonPilot/.test(b)));
    } finally {
      await svc.stop();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
