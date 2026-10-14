'use strict';

const assert = require('node:assert/strict');
const { describe, it } = require('node:test');

const {
  GC_UI_RUNTIME_LIVE,
  GC_UI_RUNTIME_STATIC,
  classifyLiveRelayProbe,
  isLiveRelayPeeringJson,
  isLiveRelayShipsJson,
  readStoredSiteLoginToken,
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

  it('reads SiteLogin token from delegation then session', () => {
    const mem = Object.create(null);
    const storage = {
      getItem: (k) => (Object.prototype.hasOwnProperty.call(mem, k) ? mem[k] : null),
      setItem: (k, v) => { mem[k] = String(v); }
    };
    assert.equal(readStoredSiteLoginToken(storage), null);
    storage.setItem('fabric.identity.session', JSON.stringify({
      identity: { id: 'x' },
      delegationToken: 'sess-tok'
    }));
    assert.equal(readStoredSiteLoginToken(storage), 'sess-tok');
    storage.setItem('fabric.delegation', JSON.stringify({ token: 'del-tok' }));
    assert.equal(readStoredSiteLoginToken(storage), 'del-tok');
  });

  it('isGoonCitizenVisitor is true only on live API without auth', () => {
    assert.equal(isGoonCitizenVisitor({ runtime: GC_UI_RUNTIME_STATIC }), false);
    assert.equal(isGoonCitizenVisitor({ runtime: GC_UI_RUNTIME_LIVE, auth: {} }), true);
    assert.equal(isGoonCitizenVisitor({
      runtime: GC_UI_RUNTIME_LIVE,
      auth: { siteToken: 'abc' }
    }), false);
    assert.equal(isGoonCitizenVisitor({
      runtime: GC_UI_RUNTIME_LIVE,
      auth: { electronUnlocked: true }
    }), false);
  });

  it('dashboardAuthHeaders attaches Bearer from storage', () => {
    const mem = Object.create(null);
    const storage = {
      getItem: (k) => (Object.prototype.hasOwnProperty.call(mem, k) ? mem[k] : null),
      setItem: (k, v) => { mem[k] = String(v); }
    };
    storage.setItem('fabric.delegation', JSON.stringify({ token: 'bear' }));
    const h = dashboardAuthHeaders({ storage, headers: { Accept: 'application/json' } });
    assert.equal(h.Authorization, 'Bearer bear');
    assert.equal(h.Accept, 'application/json');
  });
});
