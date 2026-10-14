'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert');

const { readAppHash } = require('../../functions/appHash');

require('../helpers/installReactStub');
const Dashboard = require('../../components/Dashboard');

describe('appHash / Dashboard.resolveHash deep links', () => {
  it('parses path + query and aliases fleets → fleet', () => {
    assert.deepStrictEqual(readAppHash('#fleet?id=abc'), {
      path: 'fleet',
      query: { id: 'abc' }
    });
    assert.deepStrictEqual(readAppHash('fleets?id=xyz'), {
      path: 'fleet',
      query: { id: 'xyz' }
    });
    assert.deepStrictEqual(readAppHash('#groups?id=g1&tab=fleets'), {
      path: 'groups',
      query: { id: 'g1', tab: 'fleets' }
    });
  });

  it('resolves fleet/groups hashes with query to the right tab', () => {
    assert.deepStrictEqual(Dashboard.resolveHash('#fleet?id=abc', false), {
      tab: 'fleet',
      networkView: null
    });
    assert.deepStrictEqual(Dashboard.resolveHash('#fleets?id=abc', false), {
      tab: 'fleet',
      networkView: null
    });
    assert.deepStrictEqual(Dashboard.resolveHash('#groups?id=g1&tab=fleets', false), {
      tab: 'groups',
      networkView: null
    });
  });
});
