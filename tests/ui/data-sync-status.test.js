'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert');

require('../helpers/installReactStub');
const { textOf, findType, collect } = require('../helpers/reactTree');
const DataSyncStatus = require('../../components/DataSyncStatus');
const Dashboard = require('../../components/Dashboard');
const Identity = require('../../components/Identity');

describe('DataSyncStatus', () => {
  it('compact header control exposes a status button', () => {
    const ctl = new DataSyncStatus({ variant: 'compact' });
    ctl.state.snapshot = {
      members: ['aa', 'bb'],
      fabric: { ready: true, connected: 1 },
      collection: { count: 1 }
    };
    const tree = ctl.render();
    const buttons = collect(tree, (n) => n && n.$$typeof === 'element' && n.type === 'button');
    const chip = buttons.find((n) => n.props && n.props['aria-label'] === 'Data sync status');
    assert.ok(chip, 'missing compact sync button');
    assert.equal(chip.props['data-sync-state'], 'synced');
    assert.match(chip.props.title, /Chat syncing|Devices synced/);
  });

  it('panel lists facts and Sync now', () => {
    const ctl = new DataSyncStatus({ variant: 'panel' });
    ctl.state.snapshot = {
      members: ['aa', 'bb'],
      fabric: { ready: true, connected: 2 },
      local: { candidates: ['192.168.1.9:7777'] },
      collection: { count: 1 },
      inventory: { local: { notes: 12, logs: 6, missions: 40, chat: 3, files: 1 } }
    };
    const text = textOf(ctl.render());
    assert.match(text, /Chat syncing/);
    assert.match(text, /Sync now/);
    assert.match(text, /192\.168\.1\.9:7777/);
    assert.match(text, /This device: 12 notes · 6 logs · 40 missions/);
    assert.match(text, /3 chat on this device/);
  });

  it('offers Manage devices when a handler is provided', () => {
    const ctl = new DataSyncStatus({ variant: 'panel', onManageDevices: () => {} });
    assert.match(textOf(ctl.render()), /Manage devices/);
  });

  it('Dashboard header and Identity linked-devices mount the control', () => {
    const dash = new Dashboard({});
    dash.state.online = true;
    dash.state.status = 'ok';
    assert.strictEqual(findType(dash.render(), DataSyncStatus).length, 1);
    assert.match(Dashboard.CSS, /\.syncstat\{/);

    const LinkedDevices = require('../../components/LinkedDevices');
    const identity = new Identity({});
    identity.state.info = { exists: true, unlocked: true, pubkey: '02' + 'ab'.repeat(32) };
    identity.state.linkedDevices = [];
    assert.ok(findType(identity.renderLinkedDevices(), LinkedDevices).length >= 1);
  });
});
