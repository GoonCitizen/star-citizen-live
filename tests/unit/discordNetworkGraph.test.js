'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert');

const {
  buildDiscordNetworkGraph,
  neighborsForUser,
  filterNetworkUsers
} = require('../../functions/discordNetworkGraph');

describe('discordNetworkGraph', () => {
  const catalog = {
    guilds: [
      {
        id: 'g1',
        name: 'Fleet Ops',
        members: [
          { id: 'u1', displayName: 'Alice', username: 'alice' },
          { id: 'u2', displayName: 'Bob', username: 'bob' },
          { id: 'bot', displayName: 'GoonBot', username: 'GoonBot', bot: true }
        ]
      },
      {
        id: 'g2',
        name: 'Social',
        members: [
          { id: 'u1', displayName: 'Alice', username: 'alice' },
          { id: 'u3', displayName: 'Cara', username: 'cara' }
        ]
      }
    ],
    identityLinks: [
      { discordUserId: 'u1', pubkey: '02aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', username: 'alice' }
    ]
  };

  it('builds users with multi-guild membership and co-membership edges', () => {
    const graph = buildDiscordNetworkGraph(catalog);
    assert.strictEqual(graph.stats.guildCount, 2);
    assert.strictEqual(graph.stats.multiGuildHumanCount, 1);
    assert.strictEqual(graph.stats.linkedCount, 1);
    const alice = graph.users.find((u) => u.id === 'u1');
    assert.ok(alice);
    assert.deepStrictEqual(alice.guildIds.sort(), ['g1', 'g2']);
    assert.ok(alice.linkedPubkey);
    assert.ok(graph.edges.some((e) => e.sharedCount === 1 &&
      ((e.a === 'u1' && e.b === 'u2') || (e.a === 'u2' && e.b === 'u1'))));
  });

  it('lists neighbors by shared server count', () => {
    const graph = buildDiscordNetworkGraph(catalog);
    const neighbors = neighborsForUser(graph, 'u1', { excludeBots: true });
    assert.ok(neighbors.length >= 2);
    assert.ok(neighbors.every((n) => n.sharedCount >= 1));
    assert.ok(neighbors.some((n) => n.user.id === 'u2' && n.sharedGuildNames.includes('Fleet Ops')));
  });

  it('filters network users by query', () => {
    const graph = buildDiscordNetworkGraph(catalog);
    assert.strictEqual(filterNetworkUsers(graph.users, 'cara').length, 1);
    assert.ok(filterNetworkUsers(graph.users, 'fleet').some((u) => u.id === 'u1'));
  });
});
