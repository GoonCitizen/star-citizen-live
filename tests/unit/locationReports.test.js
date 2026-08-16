'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert');

const { Store } = require('../../types/Store');
const locationReports = require('../../functions/locationReports');

const ALICE = '02' + 'aa'.repeat(32);

describe('locationReports', () => {
  it('records QT sightings and summarizes unique players', () => {
    const store = new Store({ path: null });
    const rec = locationReports.recordSighting(store, {
      place: 'rs_ext_cru-leo1',
      actor: ALICE,
      nickname: 'Neorion',
      kind: 'visit',
      role: 'location',
      at: '2026-08-15T12:00:00.000Z'
    });
    assert.ok(rec);
    assert.match(rec.name, /Ambitious Dream Station/i);
    assert.strictEqual(rec.sightings.length, 1);

    locationReports.recordSighting(store, {
      place: rec.slug,
      actor: ALICE,
      nickname: 'Neorion',
      kind: 'visit',
      role: 'location',
      at: '2026-08-15T12:04:00.000Z'
    });
    const again = locationReports.getRecord(store, rec.slug);
    assert.strictEqual(again.sightings.length, 1, 'dedupes the same actor within 10 minutes');

    locationReports.recordSighting(store, {
      place: rec.slug,
      actor: 'player:Kersa',
      handle: 'Kersa',
      kind: 'presence',
      role: 'location',
      at: '2026-08-15T12:05:00.000Z'
    });
    const sum = locationReports.summarize(store, rec.slug);
    assert.strictEqual(sum.playerCount, 2);
    assert.ok(sum.recent.some((p) => p.nickname === 'Neorion'));
    assert.ok(sum.href || locationReports.locationHref(rec.slug).includes('/locations/'));
  });

  it('folds presence location + destination and lists recent locations', () => {
    const store = new Store({ path: null });
    locationReports.foldPresence(store, ALICE, {
      nickname: 'Neorion',
      online: true,
      location: { slug: 'area18', name: 'Area18' },
      destination: { slug: 'daymar', name: 'Daymar' },
      updatedAt: '2026-08-15T18:00:00.000Z'
    });
    const recent = locationReports.listRecent(store, { limit: 8 });
    assert.ok(recent.some((r) => /area.?18/i.test(r.name) || r.slug === 'area18'));
    assert.ok(recent.some((r) => /daymar/i.test(r.name) || r.slug === 'daymar'));

    const roster = {
      [ALICE]: {
        online: true,
        nickname: 'Neorion',
        location: { slug: 'area18' },
        updatedAt: '2026-08-15T18:00:00.000Z'
      }
    };
    const here = locationReports.onlineAt(roster, 'area18');
    assert.strictEqual(here.length, 1);
    assert.equal(here[0].here, true);
    assert.ok(here[0].href && here[0].href.includes('/profiles/'));
  });

  it('skips cleared place slugs', () => {
    const store = new Store({ path: null });
    const rec = locationReports.recordSighting(store, {
      place: { slug: '__none__', cleared: true },
      actor: ALICE,
      kind: 'presence',
      role: 'location'
    });
    assert.equal(rec, null);
  });
});
