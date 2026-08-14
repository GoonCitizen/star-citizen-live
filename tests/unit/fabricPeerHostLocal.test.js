'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const host = require('../../functions/fabricPeerHostLocal');

const noDns = { includeLocalInterfaces: false, resolveDns: false };

test('canonicalizeFabricPeerDial rewrites production hub NIC :7778', () => {
  assert.equal(
    host.canonicalizeFabricPeerDial('hub.fabric.pub:7778', noDns),
    'hub.fabric.pub:7777'
  );
  assert.equal(
    host.canonicalizeFabricPeerDial('65.21.231.166:7778', noDns),
    'hub.fabric.pub:7777'
  );
  assert.equal(
    host.canonicalizeFabricPeerDial('65.21.231.149:7778', noDns),
    'relay.goon.vc:7777'
  );
  assert.equal(
    host.canonicalizeFabricPeerDial('65.21.231.149:7778', {
      listenPort: 7777,
      advertiseHost: 'relay.goon.vc',
      ...noDns
    }),
    null
  );
  assert.equal(
    host.canonicalizeFabricPeerDial('203.0.113.9:7778', { listenPort: 7777, ...noDns }),
    '203.0.113.9:7778'
  );
  assert.equal(host.isNetworkHubAddress('65.21.231.166:7777'), true);
  assert.equal(host.isNetworkHubAddress('example.com:7777'), false);
});
