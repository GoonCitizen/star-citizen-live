'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert');

const {
  parseActor,
  profileHref,
  rollupActor,
  discordUserFromCatalog
} = require('../../functions/identityActor');

const ALICE = '02' + 'aa'.repeat(32);

describe('identityActor', () => {
  it('parses Fabric pubkeys and platform-prefixed chat ids', () => {
    assert.deepStrictEqual(parseActor(ALICE), {
      platform: 'fabric',
      nativeId: ALICE,
      key: ALICE
    });
    assert.deepStrictEqual(parseActor('discord:u1'), {
      platform: 'discord',
      nativeId: 'u1',
      key: 'discord:u1'
    });
    assert.deepStrictEqual(parseActor('slack:U99'), {
      platform: 'slack',
      nativeId: 'U99',
      key: 'slack:U99'
    });
    assert.strictEqual(parseActor('not-a-key'), null);
    assert.strictEqual(parseActor('discord:dm:u1'), null);
    assert.ok(profileHref('discord:u1').includes('/profiles/'));
    assert.ok(profileHref('discord:u1').includes(encodeURIComponent('discord:u1')));
  });

  it('rolls Discord and Fabric identities onto one canonical actor', () => {
    const catalog = {
      guilds: [{
        id: 'g1',
        name: 'Fleet Ops',
        members: [{ id: 'u1', displayName: 'Cara', username: 'cara' }]
      }]
    };
    const links = [{ discordUserId: 'u1', pubkey: ALICE, username: 'cara' }];
    const fromDiscord = rollupActor('discord:u1', { links, catalog });
    assert.ok(/a{64}$/i.test(fromDiscord.canonical));
    assert.ok(fromDiscord.platforms.some((p) => p.platform === 'fabric' && /a{64}$/i.test(p.key)));
    assert.ok(fromDiscord.platforms.some((p) => p.platform === 'discord' && p.nativeId === 'u1'));
    assert.strictEqual(fromDiscord.discord.displayName, 'Cara');
    assert.strictEqual(fromDiscord.discord.guilds[0].name, 'Fleet Ops');

    const fromFabric = rollupActor(ALICE, { links, catalog });
    assert.ok(/a{64}$/i.test(fromFabric.canonical));
    assert.ok(fromFabric.platforms.some((p) => p.platform === 'discord'));

    const stub = discordUserFromCatalog(catalog, 'u9');
    assert.strictEqual(stub.userId, 'u9');
    assert.deepStrictEqual(stub.guilds, []);
  });
});
