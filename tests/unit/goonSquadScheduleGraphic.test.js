'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert');

const graphic = require('../../functions/goonSquadScheduleGraphic');
const ev = require('../../functions/discordScheduledEvents');

const FIXTURE = [
  {
    id: '1',
    name: 'MINING MONDAY',
    description: 'Find those rocks.',
    scheduled_start_time: '2026-08-24T11:00:00+00:00',
    status: 1,
    user_count: 14,
    recurrence_rule: { frequency: 2, interval: 1, by_weekday: [0] }
  },
  {
    id: '2',
    name: 'HATHOR DOMINANCE',
    description: "Let's get that Carinite!",
    scheduled_start_time: '2026-08-25T00:00:00+00:00',
    status: 1,
    user_count: 5
  },
  {
    id: '3',
    name: 'TRAINING THURSDAY',
    description: 'Fighters only, Arena Commander.',
    scheduled_start_time: '2026-08-21T00:00:00+00:00',
    status: 1,
    user_count: 31,
    recurrence_rule: { frequency: 2, interval: 1, by_weekday: [4] }
  },
  {
    id: '4',
    name: 'Tour Through The Stars',
    description: 'Chaperoned loop tour. Arrive 30 minutes early.',
    scheduled_start_time: '2026-08-22T17:00:00+00:00',
    status: 1,
    user_count: 23,
    recurrence_rule: {
      frequency: 1,
      interval: 1,
      by_n_weekday: [{ n: 4, day: 5 }]
    }
  },
  {
    id: '5',
    name: 'SATURDAY SHENANIGANS',
    description: 'Up to no good.',
    scheduled_start_time: '2026-08-22T16:00:00+00:00',
    status: 1,
    recurrence_rule: { frequency: 2, interval: 1, by_weekday: [5] }
  }
];

describe('goonSquadScheduleGraphic', () => {
  it('escapes XML and wraps long titles', () => {
    assert.strictEqual(graphic.escapeXml('A & B <C>'), 'A &amp; B &lt;C&gt;');
    const lines = graphic.wrapWords('Tour Through The Stars', 14, 3);
    assert.ok(lines.length >= 2);
    assert.ok(lines.join(' ').indexOf('Tour') !== -1);
  });

  it('clocks event starts in Central Time', () => {
    assert.strictEqual(graphic.clockCt('2026-08-22T17:00:00+00:00'), '12:00 PM');
    assert.strictEqual(graphic.dateCt('2026-08-22T17:00:00+00:00'), 'Aug 22');
  });

  it('badges monthly / training / ops rows', () => {
    const schedule = ev.buildWeekSchedule(FIXTURE);
    const tour = schedule.days.Saturday.special[0];
    assert.strictEqual(graphic.badgeFor(tour), 'MONTHLY');
    const train = schedule.days.Thursday.timed[0];
    assert.strictEqual(graphic.badgeFor(train), 'TRAIN');
    const ops = schedule.days.Monday.special[0];
    assert.strictEqual(graphic.badgeFor(ops), 'OPS');
  });

  it('renders a 1920x1080 SVG week board from Discord events', () => {
    const out = graphic.renderWeekScheduleGraphic({
      events: FIXTURE,
      fetchedAt: '2026-08-21T00:18:57.239Z',
      guildName: 'G00N SQUAD'
    });
    assert.strictEqual(out.width, 1920);
    assert.strictEqual(out.height, 1080);
    assert.match(out.svg, /<svg /);
    assert.match(out.svg, /G00N SQUAD/);
    assert.match(out.svg, /WEEKLY OPS/);
    assert.match(out.svg, /MINING MONDAY/);
    assert.match(out.svg, /HATHOR DOMINANCE/);
    assert.match(out.svg, /TRAINING/);
    assert.match(out.svg, /THURSDAY/);
    assert.match(out.svg, /Tour Through/);
    assert.match(out.svg, /MONTHLY/);
    assert.match(out.svg, /#3f7d4e/);
    assert.match(out.svg, /NO THEME/);
    assert.match(out.svg, /AMERICA\/CHICAGO/);
    assert.doesNotMatch(out.svg, /<script/i);
    assert.match(out.html, /<!DOCTYPE html>/);
    assert.match(out.html, /<svg /);
  });
});
