'use strict';

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const {
  fabricKeyStorePlugin,
  keyStoreStatus,
  readWrappedIdentityJson,
  writeWrappedIdentityJson,
  clearWrappedIdentity,
  setSecureFlag
} = require('../../functions/fabricKeyStoreClient');
const { setAndroidSecureFlag } = require('../../functions/androidSecureScreen');

describe('fabricKeyStoreClient', () => {
  let prevWindow;

  beforeEach(() => {
    prevWindow = global.window;
    delete global.window;
  });

  afterEach(() => {
    if (prevWindow === undefined) delete global.window;
    else global.window = prevWindow;
  });

  it('is a silent no-op without Capacitor', async () => {
    assert.equal(fabricKeyStorePlugin(), null);
    assert.deepEqual(await keyStoreStatus(), { available: false });
    assert.equal(await readWrappedIdentityJson(), null);
    assert.deepEqual(await writeWrappedIdentityJson('{}'), { ok: false, skipped: true });
    assert.deepEqual(await clearWrappedIdentity(), { ok: true, skipped: true });
    assert.deepEqual(await setSecureFlag(true), { ok: false, skipped: true });
    assert.deepEqual(await setAndroidSecureFlag(true), { ok: false, skipped: true });
  });

  it('returns null when window.Capacitor throws', async () => {
    global.window = {
      get Capacitor () { throw new Error('no'); }
    };
    assert.equal(fabricKeyStorePlugin(), null);
    assert.deepEqual(await keyStoreStatus(), { available: false });
  });

  it('reads and writes through a mock FabricKeyStore plugin', async () => {
    let json = null;
    let flag = null;
    global.window = {
      Capacitor: {
        Plugins: {
          FabricKeyStore: {
            async status () {
              return { available: true, hasWrappedIdentity: !!json, backend: 'tee' };
            },
            async readIdentity () { return { json }; },
            async writeIdentity (opts) {
              json = String(opts.json);
              return { ok: true, backend: 'tee' };
            },
            async clearIdentity () { json = null; return { ok: true }; },
            async setSecureFlag (opts) { flag = !!opts.enabled; return { ok: true }; }
          }
        }
      }
    };
    assert.equal((await keyStoreStatus()).available, true);
    assert.equal(await readWrappedIdentityJson(), null);
    const written = await writeWrappedIdentityJson('{"v":1}');
    assert.equal(written.ok, true);
    assert.equal(written.backend, 'tee');
    assert.equal(await readWrappedIdentityJson(), '{"v":1}');
    assert.deepEqual(await setAndroidSecureFlag(true), { ok: true, enabled: true });
    assert.equal(flag, true);
    await clearWrappedIdentity();
    assert.equal(await readWrappedIdentityJson(), null);
  });

  it('treats empty json, thrown status, and thrown setSecureFlag as unavailable', async () => {
    global.window = {
      Capacitor: {
        Plugins: {
          FabricKeyStore: {
            async status () { throw new Error('dead'); },
            async readIdentity () { return { json: '' }; },
            async writeIdentity () { return { ok: false }; },
            async setSecureFlag () { throw new Error('no FLAG_SECURE'); }
          }
        }
      }
    };
    assert.deepEqual(await keyStoreStatus(), { available: false });
    assert.equal(await readWrappedIdentityJson(), null);
    assert.equal((await writeWrappedIdentityJson('x')).ok, false);
    assert.deepEqual(await setSecureFlag(false), { ok: false });
  });

  it('status non-object payloads count as unavailable', async () => {
    global.window = {
      Capacitor: {
        Plugins: {
          FabricKeyStore: {
            async status () { return 'nope'; }
          }
        }
      }
    };
    assert.deepEqual(await keyStoreStatus(), { available: false });
  });
});
