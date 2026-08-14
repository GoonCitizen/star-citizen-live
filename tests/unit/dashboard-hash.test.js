'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert');

require('../helpers/installReactStub');
const Dashboard = require('../../components/Dashboard');

describe('Dashboard.resolveHash', () => {
  it('maps legacy hashes onto Home / Network views', () => {
    assert.deepStrictEqual(Dashboard.resolveHash('', false), { tab: 'home', networkView: null });
    assert.deepStrictEqual(Dashboard.resolveHash('#analyze', false), { tab: 'home', networkView: null });
    assert.deepStrictEqual(Dashboard.resolveHash('#live', false), { tab: 'network', networkView: 'feed' });
    assert.deepStrictEqual(Dashboard.resolveHash('#feed', false), { tab: 'network', networkView: 'feed' });
    assert.deepStrictEqual(Dashboard.resolveHash('#peers', false), { tab: 'network', networkView: 'peers' });
    assert.deepStrictEqual(Dashboard.resolveHash('#chat', false), { tab: 'chat', networkView: null });
    assert.deepStrictEqual(Dashboard.resolveHash('#notifications', false), {
      tab: 'notifications',
      networkView: null
    });
  });

  it('hides Messages unless Advanced mode is on', () => {
    assert.deepStrictEqual(Dashboard.resolveHash('#messages', false), { tab: 'home', networkView: null });
    assert.deepStrictEqual(Dashboard.resolveHash('#messages', true), {
      tab: 'network',
      networkView: 'messages'
    });
    assert.deepStrictEqual(Dashboard.resolveHash('#network/messages', true), {
      tab: 'network',
      networkView: 'messages'
    });
    assert.deepStrictEqual(Dashboard.resolveHash('#network/messages', false), {
      tab: 'network',
      networkView: 'feed'
    });
  });

  it('keeps query deep links on the Fleets / Groups tabs', () => {
    assert.deepStrictEqual(Dashboard.resolveHash('#fleet?id=f1', false), {
      tab: 'fleet',
      networkView: null
    });
    assert.deepStrictEqual(Dashboard.resolveHash('#fleets?id=f1', false), {
      tab: 'fleet',
      networkView: null
    });
    assert.deepStrictEqual(Dashboard.resolveHash('#groups?id=g1&tab=fleets', false), {
      tab: 'groups',
      networkView: null
    });
  });

  it('maps Keys / Security / Privacy hashes onto dedicated account pages', () => {
    assert.deepStrictEqual(Dashboard.resolveHash('#keys', false), { tab: 'keys', networkView: null });
    assert.deepStrictEqual(Dashboard.resolveHash('#security', false), { tab: 'security', networkView: null });
    assert.deepStrictEqual(Dashboard.resolveHash('#privacy', false), { tab: 'privacy', networkView: null });
  });
});
