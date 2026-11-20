'use strict';

const assert = require('node:assert/strict');
const { describe, it } = require('node:test');

const {
  GC_UI_RUNTIME_LIVE,
  GC_UI_RUNTIME_STATIC,
  classifyLiveRelayProbe,
  isLiveRelayPeeringJson,
  isLiveRelayShipsJson,
  fetchSiteSession,
  endSiteSession,
  isGoonCitizenVisitor
} = require('../../functions/goonCitizenClientEnvironment');
const { dashboardAuthHeaders } = require('../../functions/dashboardAuthHeaders');

describe('goonCitizenClientEnvironment', () => {
  it('classifies HTML / CDN as static', () => {
    assert.equal(classifyLiveRelayProbe({ status: 200, bodyText: '<!DOCTYPE html><html>' }).runtime, GC_UI_RUNTIME_STATIC);
    assert.equal(classifyLiveRelayProbe({
      status: 200,
      json: { protection: true, error: 'cdn' }
    }).runtime, GC_UI_RUNTIME_STATIC);
  });

  it('classifies peering and ships JSON as liveRelay', () => {
    assert.ok(isLiveRelayPeeringJson({
      kind: 'PeeringCapability',
      endpoints: { starCitizen: '/services/star-citizen', sessions: '/sessions' }
    }));
    assert.equal(classifyLiveRelayProbe({
      status: 200,
      json: { kind: 'PeeringCapability', endpoints: { sessions: '/sessions' } }
    }).runtime, GC_UI_RUNTIME_LIVE);

    assert.ok(isLiveRelayShipsJson({ success: true, data: [] }));
    assert.equal(classifyLiveRelayProbe({
      status: 200,
      json: { success: true, data: [{ id: 'a' }] }
    }).runtime, GC_UI_RUNTIME_LIVE);
  });

  it('treats 401 as liveRelay (session gate) and 502 as static', () => {
    assert.equal(classifyLiveRelayProbe({ status: 401, json: { error: 'Authentication required' } }).runtime, GC_UI_RUNTIME_LIVE);
    assert.equal(classifyLiveRelayProbe({ status: 502 }).runtime, GC_UI_RUNTIME_STATIC);
  });

  it('reads the Passport session from /sessions/current with the cookie', async () => {
    const calls = [];
    const session = { identity: { id: 'id1x', pubkey: '02' + 'ab'.repeat(32) }, network: 'regtest' };
    const ok = async (url, init) => {
      calls.push({ url, init });
      return { ok: true, json: async () => ({ session }) };
    };
    assert.deepEqual(await fetchSiteSession(ok, 'https://relay.goon.vc/'), session);
    assert.equal(calls[0].url, 'https://relay.goon.vc/sessions/current');
    assert.equal(calls[0].init.credentials, 'same-origin');
    assert.equal(await fetchSiteSession(async () => ({ ok: false })), null);
    assert.equal(await fetchSiteSession(async () => ({ ok: true, json: async () => ({ session: { identity: {} } }) })), null);
    assert.equal(await fetchSiteSession(async () => { throw new Error('offline'); }), null);
    assert.equal(await endSiteSession(async (url, init) => ({ ok: init.method === 'DELETE' })), true);
  });

  it('isGoonCitizenVisitor is true only on live API without auth', () => {
    assert.equal(isGoonCitizenVisitor({ runtime: GC_UI_RUNTIME_STATIC }), false);
    assert.equal(isGoonCitizenVisitor({ runtime: GC_UI_RUNTIME_LIVE, auth: {} }), true);
    assert.equal(isGoonCitizenVisitor({
      runtime: GC_UI_RUNTIME_LIVE,
      auth: { siteToken: 'abc' }
    }), true, 'a stored token no longer counts');
    assert.equal(isGoonCitizenVisitor({
      runtime: GC_UI_RUNTIME_LIVE,
      auth: { siteSession: { identity: { pubkey: '02' + 'ab'.repeat(32) } } }
    }), false);
    assert.equal(isGoonCitizenVisitor({
      runtime: GC_UI_RUNTIME_LIVE,
      auth: { electronUnlocked: true }
    }), false);
  });

  it('dashboardAuthHeaders adds Bearer only for an explicit token', () => {
    const h = dashboardAuthHeaders({ headers: { Accept: 'application/json' } });
    assert.equal(h.Authorization, undefined);
    assert.equal(h.Accept, 'application/json');
    assert.equal(dashboardAuthHeaders({ token: 'bear' }).Authorization, 'Bearer bear');
  });
});
