'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const { resolveLogFile, candidateLogs, channelFromPath } = require('../app/locate');

test('channelFromPath pulls the channel folder from a log path', () => {
  assert.strictEqual(channelFromPath('E:\\Roberts Space Industries\\StarCitizen\\HOTFIX\\Game.log'), 'HOTFIX');
  assert.strictEqual(channelFromPath('C:/Program Files/Roberts Space Industries/StarCitizen/LIVE/Game.log'), 'LIVE');
  assert.strictEqual(channelFromPath(null), null);
});

test('candidateLogs expands bases x channels', () => {
  const c = candidateLogs({ bases: ['X:\\SC'], channels: ['LIVE', 'HOTFIX'] });
  assert.strictEqual(c.length, 2);
  assert.strictEqual(c[0].channel, 'LIVE');
  assert.ok(c[1].file.endsWith('HOTFIX\\Game.log') || c[1].file.endsWith('HOTFIX/Game.log'));
});

test('explicit path always wins', () => {
  const r = resolveLogFile({ explicit: 'E:\\SC\\LIVE\\Game.log' });
  assert.strictEqual(r.source, 'explicit');
  assert.strictEqual(r.channel, 'LIVE');
});

test('auto-detect picks the most recently modified channel log', () => {
  const mtimes = {
    'E:\\SC\\LIVE\\Game.log': 100,
    'E:\\SC\\HOTFIX\\Game.log': 500,        // freshest -> should win
    'E:\\SC\\TECH-PREVIEW\\Game.log': 50
  };
  const statSync = (f) => { if (f in mtimes) return { mtimeMs: mtimes[f] }; throw new Error('ENOENT'); };
  const r = resolveLogFile({ bases: ['E:\\SC'], statSync });
  assert.strictEqual(r.source, 'auto-latest');
  assert.strictEqual(r.channel, 'HOTFIX');
});

test('forced channel restricts the search', () => {
  const statSync = () => ({ mtimeMs: 1 });   // every candidate "exists"
  const r = resolveLogFile({ bases: ['E:\\SC'], channel: 'PTU', statSync });
  assert.strictEqual(r.source, 'channel');
  assert.strictEqual(r.channel, 'PTU');
});

test('returns none when nothing is found', () => {
  const statSync = () => { throw new Error('ENOENT'); };
  const r = resolveLogFile({ bases: ['E:\\SC'], statSync });
  assert.strictEqual(r.source, 'none');
  assert.strictEqual(r.file, null);
});
