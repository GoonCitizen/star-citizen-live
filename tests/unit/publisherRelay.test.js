'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  relayPaths,
  childEnv,
  fabricPackageRoots,
  liveRelayOptions,
  profileHubs,
  nextPorts,
  publishedRow
} = require('../../functions/publisherRelay');

describe('publisherRelay', () => {
  it('gives the relay no operator identity, Discord, or GoonCitizen config from the env', () => {
    const env = childEnv('/tmp/relay', {
      PATH: '/usr/bin',
      HOME: '/Users/operator',
      FABRIC_XPRV: 'xprv-secret',
      FABRIC_MNEMONIC: 'words',
      SC_LOGFILE: '/game.log',
      SC_MODE: 'server',
      DISCORD_BOT_TOKEN: 'token',
      GOON_FABRIC_XPRV: 'xprv-goon',
      BITCOIN_RPC_PASSWORD: 'pw',
      ELECTRON_RUN_AS_NODE: '1',
      PORT: '3041',
      NODE_OPTIONS: '--require evil'
    });
    assert.deepStrictEqual(Object.keys(env).sort(), ['HOME', 'NODE_ENV', 'PATH']);
    assert.strictEqual(env.HOME, path.join('/tmp/relay', 'home'));
    assert.strictEqual(env.NODE_ENV, 'production');
  });

  it('peers only with the given Hubs, on loopback, with Discord, Bitcoin, and the Game.log off', () => {
    const store = {};
    const o = liveRelayOptions({
      port: 30183,
      fabricPort: 30280,
      network: 'regtest',
      fabricPeers: ['127.0.0.1:30278', '127.0.0.1:30279'],
      bitcoinHub: 'http://127.0.0.1:30182'
    }, '/tmp/relay', store);
    assert.strictEqual(o.store, store);
    assert.strictEqual(o.httpHost, '127.0.0.1');
    assert.strictEqual(o.fabric.interface, '127.0.0.1');
    assert.strictEqual(o.fabric.port, 30280);
    assert.deepStrictEqual(o.peers, [
      { address: '127.0.0.1:30278', enabled: true },
      { address: '127.0.0.1:30279', enabled: true }
    ]);
    assert.strictEqual(o.discord.enable, false);
    assert.strictEqual(o.bitcoin.enable, false);
    assert.strictEqual(o.bitcoin.adminToken, null);
    assert.deepStrictEqual(o.reparse.dirs, []);
    assert.strictEqual(o.logfile, path.join('/tmp/relay', 'no-game.log'));
    assert.strictEqual(o.documents.enable, true);
    assert.deepStrictEqual(o.missions.officers, []);
  });

  it('keeps every relay file inside its directory', () => {
    const p = relayPaths('/tmp/relay');
    for (const [name, file] of Object.entries(p)) {
      if (name === 'dir') continue;
      assert.ok(file.startsWith('/tmp/relay' + path.sep), `${name} ${file}`);
    }
  });

  it('finds @fabric checkouts: explicit, then env, then siblings', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'publisher-relay-'));
    const repo = path.join(tmp, 'star-citizen-live');
    const sibling = path.join(tmp, 'fabric-clean');
    const explicit = path.join(tmp, 'my-core');
    const http = path.join(tmp, 'fabric-http');
    fs.mkdirSync(repo);
    fs.mkdirSync(path.join(sibling, 'types'), { recursive: true });
    fs.writeFileSync(path.join(sibling, 'types', 'key.js'), '');
    fs.mkdirSync(path.join(explicit, 'types'), { recursive: true });
    fs.writeFileSync(path.join(explicit, 'types', 'key.js'), '');
    fs.mkdirSync(http);
    try {
      const real = (p) => fs.realpathSync(p);
      assert.deepStrictEqual(fabricPackageRoots({}, { root: repo, env: {} }), { core: real(sibling) });
      assert.deepStrictEqual(fabricPackageRoots({}, { root: repo, env: { FABRIC_CORE: explicit } }), { core: real(explicit) });
      assert.deepStrictEqual(
        fabricPackageRoots({ core: explicit }, { root: repo, env: { FABRIC_CORE: sibling } }),
        { core: real(explicit) }
      );
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('peers with the Hubs of a local network profile, on the ports after its instances', () => {
    const profile = {
      type: 'FabricLocalNetworkProfile',
      network: 'regtest',
      instances: [
        { name: 'seed', signer: false, http: 'http://127.0.0.1:30180', fabric: '127.0.0.1:30277' },
        { name: 'hub-a', signer: true, http: 'http://127.0.0.1:30181', fabric: '127.0.0.1:30278' },
        { name: 'hub-b', signer: true, http: 'http://127.0.0.1:30182/', fabric: '127.0.0.1:30279' }
      ]
    };
    assert.deepStrictEqual(profileHubs(profile).map((h) => h.fabric), ['127.0.0.1:30278', '127.0.0.1:30279']);
    assert.deepStrictEqual(nextPorts(profile), { http: 30183, fabric: 30280 });
    assert.throws(() => profileHubs({ instances: [] }), /FabricLocalNetworkProfile/);
    assert.throws(() => nextPorts({ instances: [] }), /no instance ports/);
  });

  it('reports what a Hub needs from a published row', () => {
    assert.deepStrictEqual(publishedRow({
      name: 'GoonCitizen.dmg',
      id: 'a'.repeat(64),
      size: '143247072',
      blobTotal: 6218,
      purchasePriceSats: 4452088,
      contentBase64: 'never returned'
    }), {
      name: 'GoonCitizen.dmg',
      id: 'a'.repeat(64),
      size: 143247072,
      blobTotal: 6218,
      purchasePriceSats: 4452088
    });
    assert.strictEqual(publishedRow({ name: 'big.apk', size: 1 }).blobTotal, null);
  });
});
