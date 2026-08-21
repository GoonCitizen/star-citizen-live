'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  resolveAndroidNodeScript,
  runFromNodejsRoot
} = require('../../functions/androidNodeBoot');

describe('androidNodeBoot', () => {
  it('prefers the staged android-node.js under nodejs/app', () => {
    const fsImpl = {
      existsSync (p) {
        return String(p).endsWith(path.join('app', 'scripts', 'android-node.js'));
      }
    };
    const root = path.join(os.tmpdir(), 'gc-nodejs');
    const script = resolveAndroidNodeScript(root, fsImpl);
    assert.equal(script, path.join(root, 'app', 'scripts', 'android-node.js'));
  });

  it('binds boot HTTP before requiring LiveRelay', () => {
    const src = fs.readFileSync(path.join(__dirname, '../../scripts/android-node.js'), 'utf8');
    const httpIdx = src.indexOf('listenAndroidBootHttp');
    const reqIdx = src.indexOf("require(path.join(root, 'services', 'LiveRelay.js'))");
    assert.ok(httpIdx > -1);
    assert.ok(reqIdx > -1);
    assert.ok(httpIdx < reqIdx);
  });

  it('invokes main() even when require.main is the Capacitor index', async () => {
    let called = 0;
    const result = await runFromNodejsRoot(path.join(os.tmpdir(), 'nodejs'), {
      signalReady: false,
      fs: {
        existsSync (p) {
          return String(p).endsWith(path.join('scripts', 'android-node.js'));
        }
      },
      requireImpl () {
        return {
          main: async () => {
            called += 1;
            return { ok: true };
          }
        };
      }
    });
    assert.equal(called, 1);
    assert.deepEqual(result, { ok: true });
  });
});
