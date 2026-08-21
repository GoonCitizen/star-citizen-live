'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { fetchClusterSync, publishClusterSync, meshClusterSync } = require('../../functions/clusterSyncClient');

describe('clusterSyncClient', () => {
  it('GET uses identity/cluster/sync and unwraps ClusterSync data', async () => {
    const urls = [];
    const out = await fetchClusterSync('https://relay.example', {
      fetchImpl: async (url) => {
        urls.push(url);
        return {
          ok: true,
          status: 200,
          json: async () => ({
            type: 'ClusterSync',
            data: { members: ['aa'], fabric: { ready: false, connected: 0 } }
          })
        };
      }
    });
    assert.equal(out.ok, true);
    assert.deepEqual(out.data.members, ['aa']);
    assert.ok(urls[0].endsWith('/identity/cluster/sync'));
  });

  it('publish POSTs { publish: true }', async () => {
    let body = null;
    const out = await publishClusterSync('https://relay.example', {
      fetchImpl: async (_url, init) => {
        body = JSON.parse(init.body);
        return {
          ok: true,
          status: 200,
          json: async () => ({ type: 'ClusterSync', data: { members: [] } })
        };
      }
    });
    assert.equal(out.ok, true);
    assert.deepEqual(body, { publish: true });
  });

  it('mesh POSTs { mesh: true }', async () => {
    let body = null;
    const out = await meshClusterSync('https://relay.example', {
      fetchImpl: async (_url, init) => {
        body = JSON.parse(init.body);
        return {
          ok: true,
          status: 200,
          json: async () => ({ type: 'ClusterSync', data: { mesh: { registered: [] } } })
        };
      }
    });
    assert.equal(out.ok, true);
    assert.deepEqual(body, { mesh: true });
  });
});
