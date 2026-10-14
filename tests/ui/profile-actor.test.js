'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert');

require('../helpers/installReactStub');
const { textOf } = require('../helpers/reactTree');
const ProfilePage = require('../../components/ProfilePage');

describe('Profile identity rollup', () => {
  it('renders a deterministic Discord profile with platform chips', () => {
    const page = new ProfilePage({ pubkey: 'discord:u1' });
    page.state.loading = false;
    page.state.error = null;
    page.state.detail = {
      self: false,
      pubkey: 'discord:u1',
      profile: { nickname: 'Cara' },
      peering: { string: '' },
      actor: {
        canonical: 'discord:u1',
        requested: { platform: 'discord', nativeId: 'u1', key: 'discord:u1' },
        platforms: [{
          platform: 'discord',
          nativeId: 'u1',
          key: 'discord:u1',
          href: '/profiles/discord%3Au1',
          handle: 'cara'
        }],
        discord: {
          userId: 'u1',
          displayName: 'Cara',
          username: 'cara',
          guilds: [{ id: 'g1', name: 'Fleet Ops' }]
        }
      },
      discord: {
        userId: 'u1',
        displayName: 'Cara',
        username: 'cara',
        guilds: [{ id: 'g1', name: 'Fleet Ops' }]
      }
    };
    const text = textOf(page.render());
    assert.match(text, /Cara/);
    assert.match(text, /discord:u1/);
    assert.match(text, /Open in Chat/);
    assert.match(text, /Fleet Ops/);
    assert.match(text, /Identities across Fabric/);
  });
});
