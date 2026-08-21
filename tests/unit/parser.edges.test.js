'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert');
const { parseLine, shipName, isNPC, missionType, parseSessionInfo } = require('../../functions/parser');

describe('parser edges', () => {
  it('parseLine classifies empty, null, and unmatched text', () => {
    const empty = parseLine('');
    assert.strictEqual(empty.kind, 'log:raw');
    assert.strictEqual(empty.timestamp, null);
    const nil = parseLine(null);
    assert.strictEqual(nil.kind, 'log:raw');
    const notice = parseLine('<2026-08-12T12:00:00.000Z> [Notice] <UnknownTag> no matching rule body');
    assert.strictEqual(notice.kind, 'log:notice');
    assert.strictEqual(notice.tag, 'UnknownTag');
    assert.strictEqual(notice.verified, true);
  });

  it('shipName / isNPC / missionType tolerate missing input', () => {
    assert.strictEqual(shipName(null), null);
    assert.strictEqual(shipName(''), null);
    assert.strictEqual(isNPC(null), false);
    assert.strictEqual(isNPC(''), false);
    assert.strictEqual(missionType(null), 'Other');
    assert.strictEqual(missionType(''), 'Other');
    assert.strictEqual(parseSessionInfo(''), null);
  });
});
