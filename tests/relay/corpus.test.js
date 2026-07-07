'use strict';

/**
 * Replay-corpus regression test.
 *
 * If real Game.log files are present under Gamelogs/ (gitignored exports from
 * players, e.g. Gamelogs/Deadman/*.log), replay a small sample through the parser
 * and assert it does not crash and produces sane output. This is a smoke test
 * against real data; it SKIPS automatically where the corpus is absent (CI, fresh
 * clones), so it never fails for lack of data.
 *
 * To run a deeper pass over more files: set SC_CORPUS_LIMIT (e.g. 20).
 */

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const StarCitizenService = require('../app/server');

function walk (dir) {
  let out = [];
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (_) { return out; }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out = out.concat(walk(p));
    else if (e.name.toLowerCase().endsWith('.log')) out.push(p);
  }
  return out;
}

const corpusDir = path.join(__dirname, '..', 'Gamelogs');
const limit = parseInt(process.env.SC_CORPUS_LIMIT, 10) || 4;
// Smallest files first, so the default smoke test stays fast.
const sample = walk(corpusDir)
  .map((f) => ({ f, size: fs.statSync(f).size }))
  .sort((a, b) => a.size - b.size)
  .slice(0, limit)
  .map((x) => x.f);

test('replay corpus parses real logs without crashing', { skip: sample.length === 0 ? 'no corpus under Gamelogs/ (gitignored)' : false }, async () => {
  for (const f of sample) {
    const s = new StarCitizenService({ discord: { enable: false }, logfile: null, missions: { enable: true } });
    const n = await s.replayLog(f);                       // must not throw
    assert.ok(n > 0, `parsed >0 lines from ${path.basename(f)}`);
    assert.ok(s.logs.length > 0, 'recorded log entries');
    // collection sizes are non-negative and bounded by lines (no runaway)
    for (const coll of [s.players, s.missionGroups, s.incaps, s.notifications, s.combatlog]) {
      assert.ok(Array.isArray(coll) && coll.length <= n, `sane collection size for ${path.basename(f)}`);
    }
    // audit chain (if any mission activity) stays intact
    if (s.missionManager) assert.ok(s.missionManager.verifyAudit(), 'audit chain intact');
  }
});
