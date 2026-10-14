'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert');

require('../helpers/installReactStub');
const { textOf, findByClass } = require('../helpers/reactTree');
const Notifications = require('../../components/Notifications');
const Fleet = require('../../components/Fleet');
const Library = require('../../components/Library');
const LogBrowser = require('../../components/LogBrowser');
const Settings = require('../../components/Settings');
const FabricMessages = require('../../components/FabricMessages');

const ME = '02' + 'ab'.repeat(32);

describe('Notifications empty + filters', () => {
  it('shows Pending / All / Resolved and empty pending copy', () => {
    const page = new Notifications({});
    page.state.loading = false;
    page.state.items = [];
    page.state.filter = 'pending';
    page.state.pending = 0;
    const tree = page.render();
    const text = textOf(tree);
    assert.match(text, /Notifications/);
    assert.match(text, /Pending/);
    assert.match(text, /All/);
    assert.match(text, /Resolved/);
    assert.match(text, /No pending notifications/);
    assert.ok(findByClass(tree, 'nt-chip').length >= 3);
  });

  it('uses broader empty copy on All when the inbox is empty', () => {
    const page = new Notifications({});
    page.state.loading = false;
    page.state.items = [];
    page.state.filter = 'all';
    const text = textOf(page.render());
    assert.match(text, /No notifications yet/);
  });

  it('lists a resolved row under Resolved and hides it on Pending', () => {
    const page = new Notifications({});
    page.state.loading = false;
    page.state.pubkey = ME;
    page.state.items = [{
      id: 'inbox-1',
      kind: 'GroupOffer',
      status: 'accepted',
      title: 'Salvage Wing',
      ts: '2026-08-14T00:00:00.000Z'
    }];
    page.state.filter = 'resolved';
    assert.match(textOf(page.render()), /Salvage Wing/);
    page.state.filter = 'pending';
    assert.match(textOf(page.render()), /No pending notifications/);
    assert.doesNotMatch(textOf(page.render()), /Salvage Wing/);
  });
});

describe('Fleet empty chrome', () => {
  it('exposes create / import and empty copy', () => {
    const page = new Fleet({});
    page.state.loading = false;
    page.state.fleets = [];
    page.state.samples = [];
    const text = textOf(page.render());
    assert.match(text, /Your fleets/);
    assert.match(text, /New fleet/);
    assert.match(text, /Import JSON/);
    assert.match(text, /No fleets yet/);
    assert.match(text, /New fleet name/);
  });
});

describe('Library empty chrome', () => {
  it('points operators at Settings snapshots when none exist', () => {
    const page = new Library({});
    page.state.loading = false;
    page.state.snapshots = [];
    page.state.error = null;
    const text = textOf(page.render());
    assert.match(text, /No snapshots yet/);
    assert.match(text, /Settings/);
    assert.match(text, /Refresh/);
    assert.match(text, /Purge all/);
  });
});

describe('Log import browser', () => {
  it('offers Browse files and empty-folder copy', () => {
    const page = new LogBrowser({ defaultOpen: false });
    page.state.open = false;
    assert.match(textOf(page.render()), /Browse files/);
    page.state.open = true;
    page.state.listing = { path: '/tmp', dirCount: 0, logCount: 0, entries: [] };
    const open = textOf(page.render());
    assert.match(open, /Hide browser/);
    assert.match(open, /Empty folder/);
    assert.match(open, /Import samples/);
  });
});

describe('Settings overlay chrome', () => {
  it('opens with Privacy, Desktop notifications, and Advanced mode', () => {
    const page = new Settings({ onClose () {} });
    page.state.loading = false;
    const text = textOf(page.render());
    assert.match(text, /Settings/);
    assert.match(text, /Privacy/);
    assert.match(text, /Desktop notifications/);
    assert.match(text, /Advanced mode/);
    assert.match(text, /game logs private/);
    assert.match(text, /Enable advanced mode/);
  });

  it('embedded network variant shows Fabric Network without overlay chrome', () => {
    const page = new Settings({ embedded: true, variant: 'network', onClose () {} });
    page.state.loading = false;
    const text = textOf(page.render());
    assert.match(text, /Fabric Network/);
    assert.match(text, /Advertise host/);
    assert.match(text, /Share logs to global/);
    assert.match(text, /Allow LAN access/);
    assert.match(text, /Open Peers/);
    assert.doesNotMatch(text, /Privacy/);
    assert.doesNotMatch(text, /Enable advanced mode/);
  });
});

describe('Fabric messages empty chrome', () => {
  it('states AMP wire log is not Game.log', () => {
    const page = new FabricMessages({});
    page.state.loading = false;
    page.state.messages = [];
    page.state.meta = { count: 0, capacity: 500 };
    const text = textOf(page.render());
    assert.match(text, /Fabric messages/);
    assert.match(text, /AMP wire/);
    assert.match(text, /Not Game\.log/);
    assert.match(text, /No Fabric Messages yet/);
  });
});
