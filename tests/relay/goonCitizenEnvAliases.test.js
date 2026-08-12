'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  applyGoonCitizenEnvAliases,
  GOONCITIZEN_ENV_ALIASES
} = require('../../functions/goonCitizenEnvAliases');

test('GOONCITIZEN_ENV_ALIASES maps SC_* onto FABRIC_* only', () => {
  assert.ok(GOONCITIZEN_ENV_ALIASES.length >= 3);
  for (const [from, to] of GOONCITIZEN_ENV_ALIASES) {
    assert.match(from, /^SC_/);
    assert.match(to, /^FABRIC_/);
  }
});

test('applyGoonCitizenEnvAliases fills unset Fabric keys', () => {
  const env = {
    SC_HTTP_HOST: '65.21.231.149',
    SC_FABRIC_PUBLIC_HOST: 'relay.goon.vc'
  };
  assert.equal(applyGoonCitizenEnvAliases(env), 2);
  assert.equal(env.FABRIC_HUB_INTERFACE, '65.21.231.149');
  assert.equal(env.FABRIC_PUBLIC_HOST, 'relay.goon.vc');
});

test('applyGoonCitizenEnvAliases does not override FABRIC_*', () => {
  const env = {
    FABRIC_HUB_INTERFACE: '127.0.0.1',
    SC_HTTP_HOST: '65.21.231.149'
  };
  assert.equal(applyGoonCitizenEnvAliases(env), 0);
  assert.equal(env.FABRIC_HUB_INTERFACE, '127.0.0.1');
});
