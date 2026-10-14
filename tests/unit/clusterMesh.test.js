'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const clusterMesh = require('../../functions/clusterMesh');

describe('clusterMesh', () => {
  it('builds coordinator metadata without secrets', () => {
    const meta = clusterMesh.metadataFromLocal({
      pubkey: '02' + 'ab'.repeat(32),
      candidates: ['192.168.1.9:7777'],
      port: 7777,
      mnemonic: 'nope'
    });
    assert.equal(meta.kind, 'gooncitizen-cluster');
    assert.deepEqual(meta.candidates, ['192.168.1.9:7777']);
    assert.ok(!JSON.stringify(meta).includes('nope'));
  });

  it('picks sibling LAN hints only for allowlisted pubkeys', () => {
    const local = 'aa'.repeat(32);
    const sib = '02' + 'bb'.repeat(32);
    const stranger = '02' + 'cc'.repeat(32);
    const hits = clusterMesh.siblingCandidates([
      {
        id: sib,
        metadata: {
          app: 'gooncitizen',
          kind: 'gooncitizen-cluster',
          pubkey: sib,
          candidates: ['10.0.0.4:7777']
        }
      },
      {
        id: stranger,
        metadata: {
          kind: 'gooncitizen-cluster',
          pubkey: stranger,
          candidates: ['10.0.0.8:7777']
        }
      }
    ], { localPubkey: local, allowPubkeys: [sib] });
    assert.equal(hits.length, 1);
    assert.deepEqual(hits[0].candidates, ['10.0.0.4:7777']);
  });

  it('does not dial Hub registrations unless the pubkey is allowlisted', () => {
    const sib = '02' + 'bb'.repeat(32);
    const hits = clusterMesh.siblingCandidates([{
      id: sib,
      metadata: {
        kind: 'gooncitizen-cluster',
        pubkey: sib,
        candidates: ['10.0.0.4:7777']
      }
    }], { localPubkey: 'aa'.repeat(32), allowPubkeys: [] });
    assert.deepEqual(hits, []);
  });

  it('registers and lists via Hub JSON-RPC', async () => {
    const calls = [];
    const fetchImpl = async (url, init) => {
      const body = JSON.parse(init.body);
      calls.push({ url, method: body.method, params: body.params });
      if (body.method === 'RegisterWebRTCPeer') {
        return {
          ok: true,
          json: async () => ({ jsonrpc: '2.0', id: 1, result: { status: 'success', peerId: 'me' } })
        };
      }
      return {
        ok: true,
        json: async () => ({
          jsonrpc: '2.0',
          id: 1,
          result: {
            type: 'ListWebRTCPeersResult',
            peers: [{
              id: '02' + 'dd'.repeat(32),
              metadata: {
                kind: 'gooncitizen-cluster',
                pubkey: '02' + 'dd'.repeat(32),
                candidates: ['192.168.4.12:7777']
              }
            }]
          }
        })
      };
    };
    const out = await clusterMesh.heartbeat({
      hubs: ['https://hub.fabric.pub'],
      pubkey: '02' + 'aa'.repeat(32),
      candidates: ['192.168.4.11:7777'],
      allowPubkeys: ['02' + 'dd'.repeat(32)],
      fetchImpl
    });
    assert.deepEqual(out.registered, ['https://hub.fabric.pub']);
    assert.equal(out.discovered.length, 1);
    assert.equal(out.discovered[0].candidates[0], '192.168.4.12:7777');
    assert.equal(calls[0].method, 'RegisterWebRTCPeer');
    assert.equal(calls[1].method, 'ListWebRTCPeers');
  });
});
