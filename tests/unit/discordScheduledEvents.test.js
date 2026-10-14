'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert');

const { Store } = require('../../types/Store');
const ev = require('../../functions/discordScheduledEvents');

describe('discordScheduledEvents', () => {
  it('serializes API payloads and recurrence weekdays', () => {
    const row = ev.serializeScheduledEvent({
      id: '100',
      guild_id: 'g1',
      name: 'MINING MONDAY',
      description: 'rocks',
      scheduled_start_time: '2026-08-24T11:00:00+00:00',
      entity_type: 2,
      status: 1,
      channel_id: 'c1',
      recurrence_rule: {
        start: '2026-03-16T11:00:00+00:00',
        frequency: 2,
        interval: 1,
        by_weekday: [0]
      }
    });
    assert.strictEqual(row.name, 'MINING MONDAY');
    assert.strictEqual(row.entityTypeName, 'voice');
    assert.strictEqual(row.statusName, 'scheduled');
    assert.strictEqual(row.recurrenceRule.frequencyName, 'weekly');
    assert.deepStrictEqual(row.recurrenceRule.byWeekdayNames, ['Monday']);
  });

  it('categorizes day themes vs timed training vs specials', () => {
    const theme = ev.categorizeEvent({
      id: '1',
      name: 'SUNDAY FUNDAY',
      scheduled_start_time: '2026-08-16T20:45:00+00:00',
      recurrence_rule: { frequency: 2, interval: 1, by_weekday: [6] }
    });
    assert.strictEqual(theme.kind, 'theme');
    assert.strictEqual(theme.weekday, 'Sunday');

    const timed = ev.categorizeEvent({
      id: '2',
      name: 'TRAINING WEDNESDAY',
      scheduled_start_time: '2026-08-20T00:00:00+00:00',
      recurrence_rule: { frequency: 2, interval: 1, by_weekday: [3] }
    });
    assert.strictEqual(timed.kind, 'timed');
    assert.strictEqual(timed.weekday, 'Wednesday');

    const special = ev.categorizeEvent({
      id: '3',
      name: 'CAPITAL COMBAT',
      scheduled_start_time: '2026-08-16T01:00:00+00:00',
      recurrence_rule: { frequency: 2, interval: 2, by_weekday: [6] }
    });
    assert.strictEqual(special.kind, 'special');
    assert.strictEqual(special.weekday, 'Saturday');

    const ops = ev.categorizeEvent({
      id: '4',
      name: 'HATHOR DOMINANCE',
      scheduled_start_time: '2026-08-18T00:00:00+00:00'
    });
    assert.strictEqual(ops.kind, 'special');
    assert.strictEqual(ops.weekday, 'Monday');
  });

  it('folds and loads guild-events into discordcatalog', () => {
    const store = new Store({ path: null });
    ev.foldScheduledEvents(store, 'g1', [{
      id: 'e1',
      name: 'MINING MONDAY',
      scheduled_start_time: '2026-08-24T11:00:00+00:00',
      entity_type: 2,
      status: 1,
      recurrence_rule: { frequency: 2, interval: 1, by_weekday: [0] }
    }], { via: 'bot' });
    const list = ev.loadScheduledEvents(store, 'g1');
    assert.strictEqual(list.length, 1);
    assert.strictEqual(list[0].id, 'e1');
    const got = ev.getScheduledEvent(store, 'e1', 'g1');
    assert.ok(got);
    const schedule = ev.buildWeekSchedule(list);
    assert.strictEqual(schedule.days.Monday.theme.name, 'MINING MONDAY');
    assert.strictEqual(schedule.counts.theme, 1);
  });

  it('buildWeekSchedule nests timed under day themes', () => {
    const schedule = ev.buildWeekSchedule([
      {
        id: 't',
        name: 'SATURDAY SHENANIGANS',
        scheduled_start_time: '2026-08-15T16:00:00+00:00',
        recurrence_rule: { frequency: 2, interval: 1, by_weekday: [5] }
      },
      {
        id: 's',
        name: '1v1 Tournament',
        scheduled_start_time: '2026-08-15T23:00:00+00:00',
        recurrence_rule: { frequency: 2, interval: 1, by_weekday: [5] }
      }
    ]);
    assert.strictEqual(schedule.days.Saturday.theme.name, 'SATURDAY SHENANIGANS');
    assert.strictEqual(schedule.days.Saturday.special.length, 1);
    assert.strictEqual(schedule.days.Saturday.special[0].name, '1v1 Tournament');
  });
});
