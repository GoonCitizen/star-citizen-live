'use strict';

const test = require('node:test');
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const rsi = require('../../functions/rsiLookup');

const ORG_HTML = fs.readFileSync(
  path.join(__dirname, '../fixtures/rsi/org-permafleet.html'),
  'utf8'
);
const CITIZEN_HTML = fs.readFileSync(
  path.join(__dirname, '../fixtures/rsi/citizen-chairmanpow.html'),
  'utf8'
);

test('sanitizeOrgSid / sanitizeRsiTag normalize uppercase SIDs', () => {
  assert.strictEqual(rsi.sanitizeOrgSid('permafleet'), 'PERMAFLEET');
  assert.strictEqual(rsi.sanitizeRsiTag('  G00N  '), 'G00N');
  assert.strictEqual(rsi.sanitizeOrgSid(''), null);
  assert.strictEqual(rsi.sanitizeOrgSid('../x'), null);
  assert.strictEqual(rsi.sanitizeOrgSid('a'.repeat(40)), null);
});

test('sanitizeCitizenHandle accepts handles', () => {
  assert.strictEqual(rsi.sanitizeCitizenHandle('ChairmanPoW'), 'ChairmanPoW');
  assert.strictEqual(rsi.sanitizeCitizenHandle('x'), null);
  assert.strictEqual(rsi.sanitizeCitizenHandle('bad handle'), null);
});

test('parseOrgHtml extracts basic PERMAFLEET fields', () => {
  const org = rsi.parseOrgHtml(ORG_HTML);
  assert.ok(org);
  assert.strictEqual(org.sid, 'PERMAFLEET');
  assert.strictEqual(org.name, 'PERMAFLEET');
  assert.strictEqual(org.memberCount, 252);
  assert.strictEqual(org.commitment, 'Casual');
  assert.strictEqual(org.model, 'Organization');
  assert.strictEqual(org.roleplay, 'Role play');
  assert.match(org.logoUrl, /generic\.jpg/);
  assert.match(org.bannerUrl, /PERMAFLEET-Banner/);
  assert.match(org.description, /group to fly with/);
  assert.strictEqual(org.url, 'https://robertsspaceindustries.com/en/orgs/PERMAFLEET');
});

test('parseCitizenHtml extracts basic ChairmanPoW fields', () => {
  const c = rsi.parseCitizenHtml(CITIZEN_HTML);
  assert.ok(c);
  assert.strictEqual(c.handle, 'ChairmanPoW');
  assert.strictEqual(c.citizenRecord, 7411388);
  assert.strictEqual(c.badge, 'Rear Admiral');
  assert.strictEqual(c.enlisted, 'Nov 16, 2023');
  assert.match(c.location, /Somalia/);
  assert.strictEqual(c.fluency, 'English');
  assert.strictEqual(c.website, 'https://goon.vc');
  assert.match(c.bio, /RED ARMY/);
  assert.strictEqual(c.mainOrgSid, 'PERMAFLEET');
  assert.strictEqual(c.url, 'https://robertsspaceindustries.com/en/citizens/ChairmanPoW');
});

test('parseOrgHtml / parseCitizenHtml return null for 404 shells', () => {
  const missing = '<html><head><title>404 - Roberts Space Industries</title></head><body></body></html>';
  assert.strictEqual(rsi.parseOrgHtml(missing), null);
  assert.strictEqual(rsi.parseCitizenHtml(missing), null);
});

test('lookupOrg uses injectable fetch and caches', async () => {
  rsi.clearCache();
  let calls = 0;
  const fetchImpl = async () => {
    calls += 1;
    return {
      ok: true,
      status: 200,
      text: async () => ORG_HTML
    };
  };
  const first = await rsi.lookupOrg('permafleet', { fetchImpl, ttlMs: 60_000 });
  assert.strictEqual(first.ok, true);
  assert.strictEqual(first.cached, false);
  assert.strictEqual(first.data.sid, 'PERMAFLEET');
  const second = await rsi.lookupOrg('PERMAFLEET', { fetchImpl, ttlMs: 60_000 });
  assert.strictEqual(second.ok, true);
  assert.strictEqual(second.cached, true);
  assert.strictEqual(calls, 1);
  rsi.clearCache();
});

test('lookupCitizen returns 404 when page is missing', async () => {
  rsi.clearCache();
  const fetchImpl = async () => ({
    ok: true,
    status: 200,
    text: async () => '<html><head><title>404 - Roberts Space Industries</title></head></html>'
  });
  const out = await rsi.lookupCitizen('NobodyHere', { fetchImpl, bypassCache: true });
  assert.strictEqual(out.ok, false);
  assert.strictEqual(out.status, 404);
});
