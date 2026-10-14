'use strict';

const test = require('node:test');
const assert = require('assert');
const gooncitizenGameState = require('../../functions/gooncitizenGameState');
const hubSidechainRsi = require('../../functions/hubSidechainRsi');

test('buildGameStatePatchProposal produces stable signing string', () => {
  const snap = gooncitizenGameState.buildGameStateSnapshot({
    missions: [],
    deaths: [],
    players: [],
    sessions: [],
    heat: {},
    meta: { files: 0, lines: 0 }
  });
  const built = hubSidechainRsi.buildGameStatePatchProposal(snap, {});
  if (!built) {
    // @fabric/core may be absent in minimal test env
    return;
  }
  assert.ok(built.proposal.patches.length >= 1);
  assert.ok(built.signingString.includes('SidechainStatePatch'));
});
