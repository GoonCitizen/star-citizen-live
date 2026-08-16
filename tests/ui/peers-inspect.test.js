'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert');

require('../helpers/installReactStub');
const { textOf } = require('../helpers/reactTree');
const Peers = require('../../components/Peers');

const ME = '02' + 'ab'.repeat(32);

describe('Peers inspect', () => {
  it('shows Fabric Network roster chrome', () => {
    const page = new Peers({});
    page.state.loading = false;
    page.state.runtime = {
      identity: ME,
      fabricReady: true,
      fabricListenPort: 7777,
      fabricPeerId: ME,
      fabricConnected: 1,
      shareLogsGlobal: false,
      shareLogsActive: false
    };
    page.state.peers = [{
      id: 'peer-1',
      address: 'hub.fabric.pub:7777',
      alias: 'Hub',
      pubkey: ME,
      connected: true
    }];
    const text = textOf(page.render());
    assert.match(text, /Fabric Network/);
    assert.match(text, /Inspect/);
    assert.match(text, /hub\.fabric\.pub:7777/);
  });

  it('inspects a peer with profile, peering string, and Open profile page', () => {
    const page = new Peers({});
    page.state.loading = false;
    page.state.inspectId = 'peer-1';
    page.state.detailLoading = false;
    page.state.runtime = { fabricListenPort: 7777, fabricAdvertiseHost: 'relay.goon.vc' };
    page.state.peers = [{ id: 'peer-1', pubkey: ME, connected: true }];
    page.state.detail = {
      peer: {
        id: 'peer-1',
        address: 'hub.fabric.pub:7777',
        alias: 'Neorion',
        pubkey: ME,
        connected: true
      },
      profile: {
        pubkey: ME,
        nickname: 'Neorion',
        scHandle: 'neorion',
        bio: 'ops'
      },
      self: false,
      peering: { string: ME + '@hub.fabric.pub:7777' }
    };
    const text = textOf(page.render());
    assert.match(text, /Peer profile/);
    assert.match(text, /Back to roster/);
    assert.match(text, /Open profile page/);
    assert.match(text, /Copy peering string/);
    assert.match(text, /nickname/);
    assert.match(text, /Neorion/);
    assert.match(text, /Star Citizen handle/);
    assert.match(text, /neorion/);
  });
});
