'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const rsi = require('../../functions/rsiService');

const ORG = { sid: 'PERMAFLEET', name: 'PERMAFLEET' };
const CITIZEN = { handle: 'Pilot', bio: 'g00n:abcdef1' };

function memory () {
  const sent = [];
  const res = {
    statusCode: 0,
    headersSent: false,
    writableEnded: false,
    setHeader () {},
    writeHead (status) { this.statusCode = status; this.headersSent = true; },
    end (body) { this.body = body; this.writableEnded = true; sent.push(JSON.parse(body)); }
  };
  return { res, sent };
}

describe('rsi service', () => {
  it('lists the interfaces at the base path', async () => {
    const { res, sent } = memory();
    const handled = await rsi.handle({ method: 'GET', url: '/services/rsi' }, res, '/services/rsi', {
      lookupOrg: async () => { throw new Error('no network'); }
    });
    assert.equal(handled, true);
    assert.equal(sent[0].service, 'rsi');
    assert.deepEqual(sent[0].interfaces.map((entry) => entry.type), [
      'RsiOrganization',
      'RsiCitizen',
      'RsiOwnershipVerification',
      'RsiOwnershipClaim'
    ]);
    assert.ok(sent[0].interfaces.every((entry) => entry.path.startsWith('/services/rsi/')));
  });

  it('reads an org and a citizen through the injected lookups', async () => {
    const lookups = {
      lookupOrg: async (sid) => ({ ok: true, data: Object.assign({ sid }, ORG), cached: false }),
      lookupCitizen: async (handle) => ({ ok: true, data: Object.assign({ handle }, CITIZEN), cached: true })
    };
    const org = await rsi.dispatch('GET', '/orgs/permafleet', new URL('http://localhost/services/rsi/orgs/permafleet'), lookups);
    assert.equal(org.body.type, 'RsiOrganization');
    assert.equal(org.body.data.sid, 'PERMAFLEET');

    const citizen = await rsi.dispatch('GET', '/citizens/Pilot', new URL('http://localhost/services/rsi/citizens/Pilot'), lookups);
    assert.equal(citizen.body.type, 'RsiCitizen');
    assert.equal(citizen.body.cached, true);
    assert.equal(citizen.body.ownership, null);
  });

  it('verifies a biography token and refuses a claim without a key', async () => {
    const lookups = {
      lookupCitizen: async () => ({ ok: true, data: CITIZEN, cached: false }),
      pubkey: () => '02' + 'ab'.repeat(32)
    };
    const missing = await rsi.dispatch('GET', '/claim', new URL('http://localhost/services/rsi/claim'), {});
    assert.equal(missing.status, 400);

    const verified = await rsi.dispatch(
      'GET',
      '/citizens/Pilot/verify',
      new URL('http://localhost/services/rsi/citizens/Pilot/verify'),
      lookups
    );
    assert.equal(verified.status, 200);
    assert.equal(verified.body.type, 'RsiOwnershipVerification');
    assert.equal(typeof verified.body.data.verified, 'boolean');
  });

  it('ignores other paths and can require a session', async () => {
    const { res } = memory();
    assert.equal(await rsi.handle({ method: 'GET', url: '/events' }, res, '/events'), false);
    let refused = false;
    const handled = await rsi.handle({ method: 'GET', url: '/services/rsi' }, res, '/services/rsi', {
      authorize () { refused = true; return false; }
    });
    assert.equal(handled, true);
    assert.equal(refused, true);
    assert.equal(res.writableEnded, false);
  });
});
