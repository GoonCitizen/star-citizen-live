'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert');

require('../helpers/installReactStub');
const { textOf, findType, collect } = require('../helpers/reactTree');
const Dashboard = require('../../components/Dashboard');
const GlobalChatDock = require('../../components/GlobalChatDock');
const SiteLogin = require('../../components/SiteLogin');
const FabricLoginModal = require('../../components/FabricLoginModal');
const PubkeyEmoji = require('../../components/PubkeyEmoji');
const MissionBroadcastBanner = require('../../components/MissionBroadcastBanner');
const { emojiFingerprint } = require('../../functions/pubkeyEmoji');

const ME = '02' + 'ab'.repeat(32);

describe('Dashboard chrome', () => {
  it('mounts the public shoutbox dock on Home and hides it on Chat', () => {
    const dash = new Dashboard({});
    dash.state.tab = 'home';
    dash.state.online = true;
    dash.state.status = 'ok';
    const home = dash.render();
    assert.strictEqual(findType(home, GlobalChatDock).length, 1);
    assert.strictEqual(findType(home, GlobalChatDock)[0].props.hide, false);

    dash.state.tab = 'chat';
    const chat = dash.render();
    assert.ok(findType(chat, GlobalChatDock)[0].props.hide);
  });

  it('offers a header QR scanner for device-link', () => {
    const dash = new Dashboard({});
    dash.state.online = true;
    dash.state.status = 'ok';
    const tree = dash.render();
    const buttons = collect(tree, (n) => n && n.$$typeof === 'element' && n.type === 'button');
    const scan = buttons.find((n) => n.props && n.props['aria-label'] === 'Scan QR to link a device');
    assert.ok(scan, 'missing QR scan button');
    assert.equal(typeof dash.openQrScanner, 'function');
    assert.equal(typeof dash.applyScannedLink, 'function');
  });

  it('offers a header data-sync status control', () => {
    const DataSyncStatus = require('../../components/DataSyncStatus');
    const dash = new Dashboard({});
    dash.state.online = true;
    dash.state.status = 'ok';
    assert.strictEqual(findType(dash.render(), DataSyncStatus).length, 1);
  });

  it('offers a header Overlay toggle on desktop', () => {
    const prev = window.electronAPI;
    window.electronAPI = {
      identity: { get: async () => ({}) },
      setGroupOverlay: async () => ({ groupOverlay: true }),
      getGroupOverlay: async () => ({ groupOverlay: false })
    };
    try {
      const dash = new Dashboard({});
      dash.state.online = true;
      dash.state.status = 'ok';
      const text = textOf(dash.render());
      assert.match(text, /Overlay/);
    } finally {
      window.electronAPI = prev;
    }
  });

  it('offers GoonCitizen and Passport site login in the browser shell', () => {
    const login = new SiteLogin({});
    const text = textOf(login.render());
    assert.match(text, /Sign in with GoonCitizen/);
    assert.match(text, /Sign in with Passport/);

    const dash = new Dashboard({});
    dash.state.tab = 'home';
    dash.state.online = true;
    assert.strictEqual(findType(dash.render(), SiteLogin).length, 1);
  });

  it('is a no-op when Electron already owns identity', () => {
    const prev = window.electronAPI;
    window.electronAPI = { identity: { get: async () => ({}) } };
    try {
      const login = new SiteLogin({});
      assert.strictEqual(login.render(), null);
    } finally {
      window.electronAPI = prev;
    }
  });

  it('offers a Network settings cog that mounts embedded Fabric Network settings', () => {
    const Settings = require('../../components/Settings');
    const dash = new Dashboard({});
    dash.state.tab = 'network';
    dash.state.networkView = 'feed';
    dash.state.online = true;
    dash.state.status = 'ok';
    const feed = dash.render();
    const buttons = collect(feed, (n) => n && n.$$typeof === 'element' && n.type === 'button');
    const cog = buttons.find((n) => n.props && n.props['aria-label'] === 'Network settings');
    assert.ok(cog, 'missing Network settings cog');

    dash.state.networkView = 'settings';
    const settingsView = dash.render();
    const mounted = findType(settingsView, Settings);
    assert.ok(mounted.length >= 1);
    assert.equal(mounted[0].props.embedded, true);
    assert.equal(mounted[0].props.variant, 'network');
  });
});

describe('Public shoutbox dock', () => {
  it('toggles closed with Public shoutbox and empty copy when open', () => {
    const dock = new GlobalChatDock({});
    dock.state.open = false;
    dock.state.unread = 3;
    assert.match(textOf(dock.render()), /Public shoutbox/);
    assert.match(textOf(dock.render()), /open/);

    dock.state.open = true;
    dock.state.loading = false;
    dock.state.messages = [];
    const open = textOf(dock.render());
    assert.match(open, /Public shoutbox/);
    assert.match(open, /cleartext mesh/);
    assert.match(open, /No messages yet/);
    assert.match(open, /Full/);
  });
});

describe('Fabric login modal', () => {
  it('renders nothing until a prompt arrives', () => {
    const modal = new FabricLoginModal({});
    assert.strictEqual(modal.render(), null);
  });

  it('asks to approve site login', () => {
    const modal = new FabricLoginModal({});
    modal.state.prompt = {
      kind: 'site-login',
      sessionId: 'sess-1',
      origin: 'https://hub.fabric.pub',
      message: 'challenge-hex'
    };
    const text = textOf(modal.render());
    assert.match(text, /Sign in to website/);
    assert.match(text, /Approve & sign/);
    assert.match(text, /Ignore/);
    assert.match(text, /hub\.fabric\.pub/);
  });

  it('asks to approve a device link', () => {
    const modal = new FabricLoginModal({});
    modal.state.prompt = {
      kind: 'device-link',
      sessionId: 'link-1',
      origin: 'https://relay.goon.vc',
      label: 'Passport',
      initiator: { id: ME }
    };
    const text = textOf(modal.render());
    assert.match(text, /Link this device/);
    assert.match(text, /Approve & link/);
    assert.match(text, /Passport/);
    assert.match(text, /chat and account data sync over Fabric/i);
    const [el] = findType(modal.render(), PubkeyEmoji);
    assert.ok(el, 'missing pubkey emoji');
    const fp = emojiFingerprint({ id: ME });
    assert.match(textOf(new PubkeyEmoji(el.props).render()), new RegExp(fp.emoji.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  });

  it('clears the card when the prompt is dismissed', () => {
    const modal = new FabricLoginModal({});
    modal.state.prompt = { kind: 'device-link', sessionId: 'link-gone' };
    modal._setPrompt(null);
    assert.equal(modal.state.prompt, null);
    assert.strictEqual(modal.render(), null);
  });

  it('keeps Ignore enabled while Approve is in flight', () => {
    const modal = new FabricLoginModal({});
    modal.state.prompt = {
      kind: 'device-link',
      sessionId: 'link-busy',
      origin: 'https://relay.goon.vc',
      initiator: { id: ME }
    };
    modal.state.busy = true;
    const buttons = collect(modal.render(), (n) => n && n.$$typeof === 'element' && n.type === 'button');
    const ignore = buttons.find((n) => /Ignore|Dismiss/.test(textOf(n)));
    assert.ok(ignore, 'missing Ignore');
    assert.equal(ignore.props.disabled, false);
  });

  it('surfaces a hub error on a failed device-link prompt', () => {
    const modal = new FabricLoginModal({});
    modal.state.prompt = {
      kind: 'device-link',
      sessionId: 'link-dead',
      origin: 'https://relay.goon.vc',
      error: 'unknown or expired device link'
    };
    const text = textOf(modal.render());
    assert.match(text, /unknown or expired/);
    const buttons = collect(modal.render(), (n) => n && n.$$typeof === 'element' && n.type === 'button');
    const approve = buttons.find((n) => /Approve/.test(textOf(n)));
    assert.ok(approve);
    assert.equal(approve.props.disabled, true);
  });
});

describe('Mission broadcast banner', () => {
  it('offers Join mission / Ignore / View on a pending share', () => {
    const banner = new MissionBroadcastBanner({});
    banner.state.pending = [{
      id: 'b1',
      source: ME,
      handle: 'Alice',
      mission: { id: 'm1', title: 'Bounty sweep', reward: 500, description: 'Bring a gunner' }
    }];
    const tree = banner.render();
    const text = textOf(tree);
    assert.match(text, /Mission offer/);
    assert.match(text, /Bounty sweep/);
    assert.match(text, /Join mission/);
    assert.match(text, /Ignore/);
    assert.match(text, /View/);
    const links = collect(tree, (n) => n && n.$$typeof === 'element' && n.props && n.props.onClick);
    assert.ok(links.length >= 3);
  });

  it('hides when the notifications tab is open', () => {
    const banner = new MissionBroadcastBanner({ hide: true });
    banner.state.pending = [{ id: 'b1', mission: { title: 'x' } }];
    assert.strictEqual(banner.render(), null);
  });
});
