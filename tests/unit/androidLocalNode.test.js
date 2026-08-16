'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const os = require('os');
const fs = require('fs');
const path = require('path');
const { isLoopbackRequest } = require('../../functions/isLoopbackRequest');
const { buildAndroidRelaySettings } = require('../../functions/androidRelaySettings');
const {
  rewriteLocalNodeUrl,
  installLocalNodeFetch,
  startEmbeddedAndroidNode,
  LOCAL_NODE_ORIGIN
} = require('../../functions/androidLocalNode');

describe('android local-first node', () => {
  it('treats IPv4 and IPv6 loopback as local', () => {
    assert.equal(isLoopbackRequest({ socket: { remoteAddress: '127.0.0.1' } }), true);
    assert.equal(isLoopbackRequest({ socket: { remoteAddress: '::1' } }), true);
    assert.equal(isLoopbackRequest({ socket: { remoteAddress: '::ffff:127.0.0.1' } }), true);
    assert.equal(isLoopbackRequest({ socket: { remoteAddress: '8.8.8.8' } }), false);
    assert.equal(isLoopbackRequest({
      socket: { remoteAddress: '8.8.8.8' },
      headers: { 'x-forwarded-for': '127.0.0.1' }
    }), false);
    assert.equal(isLoopbackRequest({
      socket: { remoteAddress: '203.0.113.9' },
      headers: { 'x-forwarded-for': '::1' }
    }), false);
  });

  it('rewrites Capacitor https://localhost onto loopback LiveRelay', () => {
    assert.equal(
      rewriteLocalNodeUrl('https://localhost/services/star-citizen/groups'),
      LOCAL_NODE_ORIGIN + '/services/star-citizen/groups'
    );
    assert.equal(rewriteLocalNodeUrl('http://127.0.0.1:3041/settings'), 'http://127.0.0.1:3041/settings');
    assert.equal(rewriteLocalNodeUrl('/services/star-citizen/monitor'), LOCAL_NODE_ORIGIN + '/services/star-citizen/monitor');
    assert.equal(rewriteLocalNodeUrl('https://relay.goon.vc/x'), 'https://relay.goon.vc/x');
  });

  it('installs a fetch wrapper once', () => {
    const calls = [];
    const win = {
      fetch: (url) => { calls.push(url); return Promise.resolve(url); }
    };
    assert.equal(installLocalNodeFetch(win), true);
    win.fetch('/settings');
    assert.equal(calls[0], LOCAL_NODE_ORIGIN + '/settings');
    assert.equal(installLocalNodeFetch(win), true);
    assert.equal(calls.length, 1);
  });

  it('builds Android LiveRelay settings: loopback HTTP, Fabric on, no Game.log', async () => {
    const dir = path.join(os.tmpdir(), `gc-android-settings-${process.pid}`);
    const settings = await buildAndroidRelaySettings({
      env: { PORT: '3041' },
      settingsDir: dir,
      store: { start: async () => {}, _started: true }
    });
    assert.equal(settings.mode, 'android');
    assert.equal(settings.logfile, null);
    assert.equal(settings.httpHost, '127.0.0.1');
    assert.equal(settings.httpSharedMode, false);
    assert.equal(settings.fabric.enable, true);
    assert.equal(settings.bitcoin.enable, false);
    assert.equal(settings.documents.enable, false);
    assert.equal(settings.discord.enable, false);
  });

  it('opens the register as JSON files (no native Level)', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gc-android-json-'));
    const settings = await buildAndroidRelaySettings({
      env: { PORT: '3041' },
      settingsDir: dir
    });
    assert.equal(settings.store._json, true);
    if (typeof settings.store.stop === 'function') await settings.store.stop();
  });

  it('does not wait for Node.start to finish before probing HTTP', async () => {
    let started = false;
    const win = {
      Capacitor: {
        Plugins: {
          CapacitorNodeJS: {
            start () {
              started = true;
              return new Promise(() => { /* nativeStart blocks until Node exits */ });
            }
          }
        }
      },
      fetch: async () => ({ ok: true, status: 200 })
    };
    const up = await startEmbeddedAndroidNode(win);
    assert.equal(started, true);
    assert.equal(up, true);
  });
});

describe('android-stage runtime packages', () => {
  it('copies Fabric HTTP so LiveRelay can load on device', () => {
    const src = fs.readFileSync(path.join(__dirname, '../../scripts/android-stage.js'), 'utf8');
    assert.match(src, /@fabric\/http/);
    assert.match(src, /@fabric\/core/);
    assert.match(src, /function stageNodeModules/);
    assert.match(src, /classic-level/);
    assert.match(src, /function stageLevelShim/);
    assert.match(src, /function fillMissingNestedDeps/);
    assert.match(src, /xtend/);
    assert.match(src, /simple-aes/);
    assert.match(src, /skipSuiteJunk/);
    assert.match(src, /SKIP_SUITE_JUNK/);
    assert.match(src, /\.cursor/);
    assert.doesNotMatch(src, /'prebuilds', 'build'/);
    assert.match(src, /COPY_DATA_DIRS/);
    assert.match(src, /'locations'/);
    assert.match(src, /'ships'/);
    assert.doesNotMatch(src, /COPY_DIRS = \[[^\]]*data/);
  });
});
