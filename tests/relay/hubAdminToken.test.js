'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  resolveHubAdminToken,
  playnetAdminTokenCandidates,
  DEFAULT_PLAYNET_MESH_BASE
} = require('../../functions/hubAdminToken');
const { withResolvedHubAdminToken } = require('../../functions/hubBitcoinProxy');

test('resolveHubAdminToken prefers settings then env', () => {
  const a = resolveHubAdminToken({ adminToken: 'from-settings' }, {});
  assert.equal(a.token, 'from-settings');
  assert.equal(a.source, 'settings.bitcoin.adminToken');

  const b = resolveHubAdminToken({}, { FABRIC_HUB_ADMIN_TOKEN: 'from-env' });
  assert.equal(b.token, 'from-env');
  assert.equal(b.source, 'env');
});

test('resolveHubAdminToken reads adminTokenFile', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gc-admin-token-'));
  const file = path.join(dir, 'token.txt');
  fs.writeFileSync(file, 'file-token-value\n', 'utf8');
  const got = resolveHubAdminToken({ adminTokenFile: file }, {});
  assert.equal(got.token, 'file-token-value');
  assert.equal(got.source, 'adminTokenFile');
});

test('playnetAdminTokenCandidates only for loopback Hub A port', () => {
  const port = DEFAULT_PLAYNET_MESH_BASE + 180;
  const hits = playnetAdminTokenCandidates(`http://127.0.0.1:${port}`);
  assert.ok(hits.length >= 1);
  assert.equal(playnetAdminTokenCandidates('http://127.0.0.1:8080').length, 0);
  assert.equal(playnetAdminTokenCandidates('http://example.com:' + port).length, 0);
});

test('withResolvedHubAdminToken fills adminToken from file', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gc-admin-token-'));
  const file = path.join(dir, 'token.txt');
  fs.writeFileSync(file, 'resolved-token\n', 'utf8');
  const out = withResolvedHubAdminToken({
    hub: 'http://127.0.0.1:28380',
    adminTokenFile: file
  }, {});
  assert.equal(out.adminToken, 'resolved-token');
  assert.equal(out.adminTokenSource, 'adminTokenFile');
});

test('withResolvedHubAdminToken keeps explicit adminToken', () => {
  const out = withResolvedHubAdminToken({
    adminToken: 'keep-me',
    adminTokenFile: '/nonexistent'
  }, { FABRIC_HUB_ADMIN_TOKEN: 'from-env' });
  assert.equal(out.adminToken, 'keep-me');
  assert.equal(out.adminTokenSource, undefined);
});

test('resolveHubAdminToken discovers playnet admin-token-a.txt', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gc-playnet-token-'));
  const tokenPath = path.join(dir, 'stores', 'playnet-mesh-runtime', 'admin-token-a.txt');
  fs.mkdirSync(path.dirname(tokenPath), { recursive: true });
  fs.writeFileSync(tokenPath, 'playnet-discovered\n', 'utf8');
  const port = DEFAULT_PLAYNET_MESH_BASE + 180;
  const prev = process.env.FABRIC_HUB_ROOT;
  process.env.FABRIC_HUB_ROOT = dir;
  try {
    const got = resolveHubAdminToken({ hub: `http://127.0.0.1:${port}` }, {});
    assert.equal(got.token, 'playnet-discovered');
    assert.match(got.source, /^playnet:/);
  } finally {
    if (prev === undefined) delete process.env.FABRIC_HUB_ROOT;
    else process.env.FABRIC_HUB_ROOT = prev;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('resolveHubAdminToken returns empty when nothing configured', () => {
  const got = resolveHubAdminToken({ hub: 'http://127.0.0.1:8080' }, {});
  assert.equal(got.token, '');
  assert.equal(got.source, null);
});
