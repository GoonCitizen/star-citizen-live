'use strict';

/**
 * Isolated LiveRelay for Sandbox click tests (temp store, no Fabric listen).
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const LiveRelay = require('../../services/LiveRelay');
const { createIdentity } = require('../../functions/identity');

function tmpDir (prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix || 'gc-sandbox-'));
}

/**
 * @param {object} [overrides] LiveRelay settings
 * @returns {Promise<{ svc: object, port: number, origin: string, identity: object, dir: string }>}
 */
async function startLiveRelayForSandbox (overrides = {}) {
  const dir = tmpDir('gc-sandbox-');
  const identity = createIdentity();
  const svc = new LiveRelay(Object.assign({
    port: 0,
    listen: true,
    mode: 'relay',
    settingsDir: dir,
    logfile: path.join(dir, 'missing.log'),
    fabric: { enable: false, listen: false, port: 0, peers: [] },
    discord: { enable: false },
    missions: { enable: true },
    documents: { enable: true },
    bitcoin: { enable: true }
  }, overrides));
  await svc.start();
  svc.setIdentity(identity);
  const port = svc.server.address().port;
  return {
    svc,
    port,
    origin: `http://127.0.0.1:${port}`,
    identity,
    dir
  };
}

async function stopLiveRelayForSandbox (ctx) {
  if (!ctx) return;
  try {
    if (ctx.svc) await ctx.svc.stop();
  } catch (_) { /* ignore */ }
  if (ctx.dir) {
    try { fs.rmSync(ctx.dir, { recursive: true, force: true }); } catch (_) { /* ignore */ }
  }
}

module.exports = {
  tmpDir,
  startLiveRelayForSandbox,
  stopLiveRelayForSandbox
};
