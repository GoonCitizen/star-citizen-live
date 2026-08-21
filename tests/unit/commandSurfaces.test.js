'use strict';

/**
 * Lock the IPC / HTTP / Fabric command-surface split (docs/API-SURFACES.md).
 * Parses source so we do not boot Electron.
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '../..');

function readRepo (rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

function invokeChannels (src) {
  const out = [];
  const re = /ipcRenderer\.invoke\(\s*'([^']+)'/g;
  let m;
  while ((m = re.exec(src))) out.push(m[1]);
  return out;
}

function handleChannels (src) {
  const out = [];
  const re = /ipcMain\.handle\(\s*'([^']+)'/g;
  let m;
  while ((m = re.exec(src))) out.push(m[1]);
  return out;
}

describe('command surfaces (IPC vs HTTP vs Fabric)', () => {
  const preload = readRepo('preload.js');
  const main = readRepo('main.js');
  const android = readRepo('functions/androidIdentityBridge.js');
  const client = readRepo('functions/identityCrossSignClient.js');
  const delivery = readRepo('components/DeliverySync.js');

  it('preload exposes Fabric mesh helpers, not register REST', () => {
    const channels = invokeChannels(preload);
    for (const need of [
      'fabric:delivery-receipt',
      'fabric:publish-cross-sign',
      'fabric:identity-cluster',
      'fabric:presence-status',
      'fabric:presence-roster',
      'fabric:presence-set',
      'fabric:presence-ship',
      'identity:get',
      'identity:sign-envelope',
      'fabric-login:resolve',
      'fabric-group-share:resolve'
    ]) {
      assert.ok(channels.includes(need), `missing ${need}`);
    }
    const forbidden = channels.filter((c) =>
      /^(chat|groups|missions|bitcoin|presence|peers)(:|$)/i.test(c) ||
      c.includes('/services/star-citizen')
    );
    assert.deepEqual(forbidden, [], `IPC must not proxy register REST: ${forbidden.join(', ')}`);
    assert.match(preload, /fabric:\s*\{/);
    assert.match(preload, /publishCrossSign:/);
    assert.match(preload, /identityCluster:/);
    assert.match(preload, /deliveryReceipt:/);
    assert.match(preload, /presenceStatus:/);
    assert.match(preload, /presenceRoster:/);
    assert.match(preload, /setPresence:/);
    assert.match(preload, /setPresenceShip:/);
  });

  it('main.js Fabric IPC calls LiveRelay in-process, not HTTP', () => {
    const channels = handleChannels(main);
    assert.ok(channels.includes('fabric:publish-cross-sign'));
    assert.ok(channels.includes('fabric:identity-cluster'));
    assert.ok(channels.includes('fabric:delivery-receipt'));
    assert.ok(channels.includes('fabric:presence-status'));
    assert.ok(channels.includes('fabric:presence-roster'));
    assert.ok(channels.includes('fabric:presence-set'));
    assert.ok(channels.includes('fabric:presence-ship'));
    assert.match(main, /publishLocalIdentityCrossSign/);
    assert.match(main, /identityCluster/);
    assert.match(main, /_markDeliveryReceipt/);
    assert.match(main, /getPresenceStatus/);
    assert.match(main, /getPresenceRoster/);
    assert.match(main, /setPresenceSettings/);
    assert.match(main, /setShipOverride/);
    assert.doesNotMatch(main, /ipcMain\.handle\('chat:/);
    assert.doesNotMatch(main, /ipcMain\.handle\('groups:/);
    assert.doesNotMatch(main, /ipcMain\.handle\('missions:/);
  });

  it('Android identity bridge still has no electronAPI.fabric (HTTP fallback)', () => {
    assert.match(android, /platform:\s*'android'/);
    assert.doesNotMatch(android, /publishCrossSign/);
    assert.doesNotMatch(android, /identityCluster/);
    assert.doesNotMatch(android, /deliveryReceipt/);
    assert.doesNotMatch(android, /presenceStatus/);
    assert.doesNotMatch(android, /presenceRoster/);
  });

  it('desktop clients try Fabric before HTTP', () => {
    const presence = readRepo('functions/presenceClient.js');
    assert.match(client, /tryFabricPublishCrossSign/);
    assert.match(client, /tryFabricIdentityCluster/);
    assert.match(client, /forceHttp/);
    assert.match(delivery, /tryElectronDeliveryReceipt/);
    assert.match(delivery, /postDeliveryReceiptHttp/);
    assert.match(delivery, /\/delivery\/\$\{encodeURIComponent\(hash\)\}\/receipt/);
    assert.match(presence, /tryFabricPresenceStatus/);
    assert.match(presence, /tryFabricPresenceRoster/);
    assert.match(presence, /forceHttp/);
  });

  it('presence is Fabric-first; peers stay HTTP (not IPC REST)', () => {
    const live = readRepo('services/LiveRelay.js');
    const presence = readRepo('functions/presenceClient.js');
    const identity = readRepo('components/Identity.js');
    const chat = readRepo('components/Chat.js');
    assert.match(live, /pathname === `\$\{base\}\/presence`/);
    assert.match(live, /pathname === `\$\{base\}\/presence\/roster`/);
    assert.match(live, /_requireSession\(req, send\)/);
    assert.match(presence, /electronAPI\.fabric/);
    assert.match(identity, /presenceClient/);
    assert.match(chat, /fetchPresenceRoster/);
    assert.doesNotMatch(preload, /invoke\('fabric:peers/);
    assert.doesNotMatch(main, /ipcMain\.handle\('fabric:peers/);
  });
});
