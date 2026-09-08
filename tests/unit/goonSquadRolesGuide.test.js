'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert');

const guide = require('../../functions/goonSquadRolesGuide');

const FIXTURE = {
  guildId: '1190527980120850493',
  guildName: 'G00N SQUAD',
  memberCount: 1287,
  countsSource: 'rest_members',
  roles: [
    { id: '1', name: 'GREENBACKS', position: 58, colorHex: '#2ecc71', holders: 864 },
    { id: '2', name: 'PERMAFLEET', position: 119, holders: 211 },
    { id: '3', name: '[P] Prospect I', position: 113, holders: 245 },
    { id: '4', name: '[P4] Prospect IV', position: 116, holders: 50 },
    { id: '5', name: 'TURTLE BRIGADE', position: 143, holders: 48 },
    { id: '6', name: '[LT] Lieutenant', position: 154, holders: 15 },
    { id: '7', name: 'LIVE NOW', position: 175, holders: 0, managed: false },
    { id: '8', name: 'Ticket Tool', position: 43, holders: 1, managed: true }
  ],
  roleCounts: {
    GREENBACKS: 864,
    PERMAFLEET: 211,
    '[P] Prospect I': 245
  }
};

describe('goonSquadRolesGuide', () => {
  it('escapes HTML entities', () => {
    assert.strictEqual(guide.escapeHtml('A & B <C>'), 'A &amp; B &lt;C&gt;');
  });

  it('builds ladder + section holder counts from DiscordGuildRoles', () => {
    const model = guide.buildGuideModel(FIXTURE, { source: 'test' });
    assert.strictEqual(model.guildName, 'G00N SQUAD');
    assert.strictEqual(model.memberCount, 1287);
    const entry = model.sections.find((s) => s.id === 'entry');
    assert.ok(entry);
    const green = entry.rows.find((r) => r.name === 'GREENBACKS');
    assert.strictEqual(green.holders, 864);
    assert.strictEqual(green.present, true);
    const prospect = model.sections.find((s) => s.id === 'prospect');
    const p1 = prospect.rows.find((r) => r.name === '[P] Prospect I');
    assert.strictEqual(p1.holders, 245);
    assert.ok(model.ladder.some((s) => s.label === 'PERMAFLEET' && s.holders === 211));
  });

  it('lists uncategorized non-managed roles in other', () => {
    const model = guide.buildGuideModel(FIXTURE);
    const names = model.other.map((r) => r.name);
    assert.ok(names.includes('LIVE NOW'));
    assert.ok(!names.includes('Ticket Tool'));
    assert.ok(!names.includes('GREENBACKS'));
  });

  it('renders a standalone HTML guide with role tables', () => {
    const model = guide.buildGuideModel(FIXTURE, {
      generatedAt: '2026-09-06T21:00:00.000Z',
      source: 'test'
    });
    const html = guide.renderRolesGuideHtml(model);
    assert.ok(html.indexOf('<!DOCTYPE html>') === 0);
    assert.ok(html.includes('G00N SQUAD'));
    assert.ok(html.includes('Discord Roles Guide'));
    assert.ok(html.includes('Prospect track'));
    assert.ok(html.includes('GREENBACKS'));
    assert.ok(html.includes('864'));
    assert.ok(html.includes('/discord/guilds/1190527980120850493/roles'));
  });

  it('accepts roster-shaped roleCatalog input', () => {
    const model = guide.buildGuideModel({
      guildName: 'G00N SQUAD',
      roleCatalog: [{ id: '1', name: 'PERMAFLEET', position: 1 }],
      roleCounts: { PERMAFLEET: 99 }
    });
    const membership = model.sections.find((s) => s.id === 'membership');
    const pf = membership.rows.find((r) => r.name === 'PERMAFLEET');
    assert.strictEqual(pf.holders, 99);
  });
});
