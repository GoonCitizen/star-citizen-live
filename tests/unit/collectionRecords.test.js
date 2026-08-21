'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert');

const {
  hrefFor,
  fabricMessageHref,
  normalizeRecordId,
  load
} = require('../../functions/collectionRecords');

const ALICE = '02' + 'aa'.repeat(32);

describe('collectionRecords', () => {
  it('maps search kinds onto profiles, groups, missions, or /collections/:kind/:id', () => {
    assert.ok(hrefFor('person', 'discord:u1').includes('/profiles/'));
    assert.ok(hrefFor('person', ALICE).includes(encodeURIComponent(ALICE)));
    assert.strictEqual(hrefFor('group', 'grp1'), '/groups/grp1');
    assert.strictEqual(hrefFor('mission', 'ms1'), '/missions/ms1');
    assert.strictEqual(hrefFor('note', 'note:n1'), '/collections/note/n1');
    assert.strictEqual(hrefFor('guild', 'guild:g1'), '/collections/guild/g1');
    assert.strictEqual(hrefFor('channel', 'discord:c1'), '/collections/channel/discord%3Ac1');
    assert.strictEqual(hrefFor('fleet', 'fl1'), '/collections/fleet/fl1');
    assert.ok(fabricMessageHref('deadbeef').includes('/collections/fabric-message/'));
    assert.strictEqual(hrefFor('file', 'aa'.repeat(32)), '/files/' + 'aa'.repeat(32));
    assert.strictEqual(hrefFor('location', 'area18'), '/locations/area18');
    assert.strictEqual(normalizeRecordId('note', 'note:n1'), 'n1');
  });

  it('loads note, guild, channel, and fabric-message records from a corpus', () => {
    const corpus = {
      catalog: {
        guilds: [{
          id: 'g1',
          name: 'Fleet Ops',
          channels: [{ id: 'c1', name: 'general' }],
          members: [{ id: 'u1', displayName: 'Cara' }]
        }]
      },
      notes: [{ id: 'n1', subject: 'discord:u1', subjectHandle: 'Cara', body: 'Nights-only gunner' }],
      chatChannels: [{ key: 'discord:c1', label: '#general', kind: 'discord' }]
    };
    const note = load('note', 'n1', { corpus });
    assert.ok(note);
    assert.strictEqual(note.kind, 'note');
    assert.match(note.title, /gunner/i);
    assert.ok(note.links.some((l) => l.href.includes('/profiles/')));

    const guild = load('guild', 'g1', { corpus });
    assert.strictEqual(guild.title, 'Fleet Ops');

    const channel = load('channel', 'discord:c1', { corpus });
    assert.ok(channel.actions.some((a) => a.rel === 'chat' && a.channel === 'discord:c1'));

    const loc = load('location', 'area18', {
      corpus: {
        locations: [{ slug: 'area18', name: 'Area18', system: 'Stanton', type: 'LandingZone' }]
      }
    });
    assert.strictEqual(loc.title, 'Area18');
    assert.strictEqual(loc.href, '/locations/area18');

    const missingNote = load('note', 'missing', { corpus });
    assert.strictEqual(missingNote, null);

    const wire = load('fabric-message', 'deadbeef', {
      getFabricMessage: (hash) => hash === 'deadbeef' ? { hash, type: 'CONTRACT_MESSAGE' } : null
    });
    assert.strictEqual(wire.missing, false);
    assert.strictEqual(wire.record.type, 'CONTRACT_MESSAGE');

    const absent = load('fabric-message', 'cafebabe', { getFabricMessage: () => null });
    assert.strictEqual(absent.missing, true);
    assert.strictEqual(absent.record.hash, 'cafebabe');
  });
});
