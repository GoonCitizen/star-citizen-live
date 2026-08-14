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

test('dedicated FABRIC_INTERFACE does not treat a sibling NIC as self', () => {
  const nics = {
    eth0: [
      { address: '65.21.231.166', internal: false },
      { address: '65.21.231.149', internal: false }
    ],
    lo: [{ address: '127.0.0.1', internal: true }]
  };
  const opts = {
    advertiseHost: 'relay.goon.vc',
    env: { FABRIC_INTERFACE: '65.21.231.149' },
    includeLocalInterfaces: true,
    resolveDns: false,
    interfaceAddresses: nics
  };
  const hosts = host.collectOwnFabricHosts(opts);
  assert.equal(hosts.has('65.21.231.149'), true);
  assert.equal(hosts.has('65.21.231.166'), false);
  assert.equal(host.isSelfFabricAddress('65.21.231.166:7777', opts), false);
  assert.equal(host.isSelfFabricAddress('hub.fabric.pub:7777', opts), false);
});
