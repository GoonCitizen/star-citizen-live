'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { storeRoot, registerPath, STORE_NAME } = require('../../functions/storePaths');

test('storeRoot nests gooncitizen under stores/ (Hub-style named store)', () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'sc-stores-'));
  const root = storeRoot(base);
  assert.strictEqual(path.basename(root), STORE_NAME);
  assert.ok(fs.existsSync(root));
  assert.strictEqual(registerPath(root), path.join(root, 'register'));
  fs.rmSync(base, { recursive: true, force: true });
});

test('storeRoot migrates legacy flat stores/register into stores/gooncitizen/register', () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'sc-stores-'));
  const legacy = path.join(base, 'register');
  fs.mkdirSync(legacy, { recursive: true });
  fs.writeFileSync(path.join(legacy, 'CURRENT'), 'MANIFEST-000001\n');
  fs.writeFileSync(path.join(base, 'settings.json'), '{"logfile":"/tmp/Game.log"}\n');

  const root = storeRoot(base);
  assert.ok(fs.existsSync(path.join(root, 'register', 'CURRENT')));
  assert.ok(fs.existsSync(path.join(root, 'settings.json')));
  assert.ok(!fs.existsSync(legacy), 'legacy register dir should be moved');
  fs.rmSync(base, { recursive: true, force: true });
});
