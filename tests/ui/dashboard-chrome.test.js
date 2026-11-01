'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert');

require('../helpers/installReactStub');
const { textOf, findType, collect, findByClass, classList } = require('../helpers/reactTree');
const Dashboard = require('../../components/Dashboard');
const GlobalChatDock = require('../../components/GlobalChatDock');
const PassportSignIn = require('../../components/PassportSignIn');
const LinkedSigners = require('../../components/LinkedSigners');
const MissionBroadcastBanner = require('../../components/MissionBroadcastBanner');

const ME = '02' + 'ab'.repeat(32);

describe('Dashboard chrome', () => {
  it('places Missions directly after Home in the header tabs', () => {
    const dash = new Dashboard({});
    dash.state.tab = 'home';
    dash.state.online = true;
    dash.state.status = 'ok';
    const nav = findByClass(dash.render(), 'header-nav')[0];
    assert.ok(nav, 'missing header-nav');
    const labels = collect(nav, (n) => n && n.$$typeof === 'element' && n.type === 'button' &&
      classList(n).includes('tab')).map((n) => textOf(n).trim());
    assert.equal(labels[0], 'Home');
    assert.equal(labels[1], 'Missions');
  });

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

  it('offers a header QR scanner for signer invitations', () => {
    const dash = new Dashboard({});
    dash.state.online = true;
    dash.state.status = 'ok';
    const tree = dash.render();
    const buttons = collect(tree, (n) => n && n.$$typeof === 'element' && n.type === 'button');
    const scan = buttons.find((n) => n.props && n.props['aria-label'] === 'Scan QR to link a signer');
    assert.ok(scan, 'missing QR scan button');
    assert.equal(typeof dash.openQrScanner, 'function');
    assert.equal(typeof dash.applyScannedLink, 'function');
  });

  it('opens My profile from the identity flyout', async () => {
    const { canonicalChatAuthor } = require('../../functions/identity');
    const MESH = '03' + 'cd'.repeat(32);
    const dash = new Dashboard({});
    dash.state.online = true;
    dash.state.status = 'ok';
    dash.state.showIdFlyout = true;
    dash.state.identityPubkey = ME;
    // Mesh publisher (chat author) can differ from the unlocked wallet chip.
    dash.state.meshPubkey = MESH;
    const flyout = dash.renderIdentityFlyout();
    const text = textOf(flyout);
    assert.match(text, /My profile/);
    assert.doesNotMatch(text, /When you fly/);
    const buttons = collect(flyout, (n) => n && n.$$typeof === 'element' && n.type === 'button');
    const myProfile = buttons.find((n) => /My profile/.test(textOf(n)));
    assert.ok(myProfile, 'My profile button');
    const prevHref = global.window.location.href;
    await myProfile.props.onClick();
    const expected = '/profiles/' + encodeURIComponent(canonicalChatAuthor(MESH) || MESH);
    assert.ok(String(global.window.location.href).includes(expected),
      'My profile should open the mesh/chat identity, not the wallet chip (' + expected + ')');
    assert.ok(!String(global.window.location.href).includes(encodeURIComponent(canonicalChatAuthor(ME))),
      'should not open unlocked wallet pubkey when mesh differs');
    try { global.window.location.href = prevHref; } catch (_) { /* ignore */ }
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

  it('opens the primary-group overlay when voice is joined', async () => {
    const prev = window.electronAPI;
    const calls = [];
    window.electronAPI = {
      identity: { get: async () => ({}) },
      setGroupOverlay: async (enabled) => {
        calls.push(!!enabled);
        return { groupOverlay: !!enabled };
      },
      getGroupOverlay: async () => ({ groupOverlay: false })
    };
    try {
      const ActiveVoicePanel = require('../../components/ActiveVoicePanel');
      const dash = new Dashboard({});
      dash.state.online = true;
      dash.state.status = 'ok';
      dash.state.voiceJoined = false;
      dash.state.groupOverlay = false;
      const panel = findType(dash.render(), ActiveVoicePanel)[0];
      assert.ok(panel && typeof panel.props.onVoice === 'function');
      panel.props.onVoice({ joined: true, groupId: 'g1' });
      assert.strictEqual(dash.state.voiceJoined, true);
      assert.strictEqual(dash.state.groupOverlay, true);
      await Promise.resolve();
      assert.deepStrictEqual(calls, [true]);
      panel.props.onVoice({ joined: true, groupId: 'g1' });
      await Promise.resolve();
      assert.deepStrictEqual(calls, [true]);
      panel.props.onVoice({ joined: false });
      assert.strictEqual(dash.state.voiceJoined, false);
      assert.strictEqual(dash.state.groupOverlay, true);
      assert.deepStrictEqual(calls, [true]);
    } finally {
      window.electronAPI = prev;
    }
  });

  it('offers Passport sign-in in the browser shell', () => {
    const login = new PassportSignIn({});
    const text = textOf(login.render());
    assert.match(text, /Sign in with Passport/);
    assert.doesNotMatch(text, /Sign in with GoonCitizen/);

    const dash = new Dashboard({});
    dash.state.tab = 'home';
    dash.state.online = true;
    assert.strictEqual(findType(dash.render(), PassportSignIn).length, 1);
  });

  it('asks for a Passport update when only an older Passport marks the page', async () => {
    const prev = { document: window.document, MessageChannel: window.MessageChannel, postMessage: window.postMessage, location: window.location };
    const marked = (value) => ({ documentElement: { getAttribute: (name) => (name === 'data-fabric-passport' ? value : null) } });
    window.MessageChannel = MessageChannel;
    window.location = { origin: 'https://relay.goon.vc' };
    window.postMessage = (msg, origin, ports) => {
      if (window.answerHello) ports[0].postMessage({ type: 'PASSPORT_HELLO', v: 1 });
    };
    try {
      for (const [marker, hello, expected] of [
        ['abcdefghijklmnopabcdefghijklmnop', false, /Update Fabric Passport/],
        [null, true, /Update Fabric Passport/],
        [null, false, /Install Fabric Passport/]
      ]) {
        window.document = marked(marker);
        window.answerHello = hello;
        const login = new PassportSignIn({});
        login.setState = (next) => Object.assign(login.state, next);
        await login._signIn();
        assert.match(login.state.status, expected);
        assert.strictEqual(login.state.error, true);
      }
    } finally {
      Object.assign(window, prev);
      delete window.answerHello;
    }
  });

  it('shows the signed-in Passport identity with Sign out', () => {
    const login = new PassportSignIn({
      session: { identity: { id: 'id1abc', pubkey: ME }, network: 'regtest' }
    });
    const text = textOf(login.render());
    assert.match(text, /id1abc/);
    assert.match(text, /Sign out/);
    assert.doesNotMatch(text, /Sign in with Passport/);
  });

  it('is a no-op when Electron already owns identity', () => {
    const prev = window.electronAPI;
    window.electronAPI = { identity: { get: async () => ({}) } };
    try {
      const login = new PassportSignIn({});
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
  it('sits in the reserved bottom chrome inset', () => {
    assert.match(GlobalChatDock.CSS, /bottom:\s*var\(--chrome-inset/);
    assert.match(MissionBroadcastBanner.CSS, /bottom:\s*var\(--chrome-inset/);
    const ActiveVoicePanel = require('../../components/ActiveVoicePanel');
    assert.match(ActiveVoicePanel.CSS, /bottom:\s*var\(--chrome-inset/);
  });

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

describe('Linked signers', () => {
  const PEER = '03' + 'cd'.repeat(32);
  const view = (extra = {}) => Object.assign({
    pubkey: ME,
    signers: [],
    identityPeers: [],
    mailboxes: ['https://relay.goon.vc'],
    pairing: null,
    pending: []
  }, extra);
  const buttonsOf = (tree) => collect(tree, (n) => n && n.$$typeof === 'element' && n.type === 'button').map((n) => textOf(n).trim());

  it('offers an invitation or a pasted one when nothing is pairing', () => {
    const ls = new LinkedSigners({});
    ls.state.view = view();
    ls.state.hub = 'https://relay.goon.vc';
    const tree = ls.render();
    const text = textOf(tree);
    assert.match(text, /Add a signer/);
    assert.match(text, /Nothing linked yet/);
    assert.ok(buttonsOf(tree).includes('Show an invitation'));
    assert.ok(buttonsOf(tree).includes('Use invitation'));
    assert.doesNotMatch(text, /device/i);
  });

  it('takes an invitation handed in by the scanner', () => {
    const ls = new LinkedSigners({ invitation: 'fabric:abc' });
    ls.takeInvitation(ls.props.invitation);
    assert.equal(ls.state.invitationInput, 'fabric:abc');
  });

  it('shows the code and asks for scopes before granting', () => {
    const ls = new LinkedSigners({});
    ls.state.view = view({ pairing: { mode: 'invite', status: 'confirm', sas: '123456', peerLabel: 'Passport', rendezvous: 'https://relay.goon.vc' } });
    const tree = ls.render();
    const text = textOf(tree);
    assert.match(text, /123456/);
    assert.match(text, /Only continue if Passport shows the same six digits/);
    assert.match(text, /Act as this player/);
    assert.ok(buttonsOf(tree).includes('The codes match'));
    assert.doesNotMatch(text, /Add a signer/, 'no second pairing while one is open');
    ls.state.scopes = [];
    const match = collect(ls.render(), (n) => n && n.type === 'button' && textOf(n).trim() === 'The codes match')[0];
    assert.equal(match.props.disabled, true);
  });

  it('lists waiting requests with Sign and Decline, and signers with their grants', () => {
    const ls = new LinkedSigners({});
    ls.state.view = view({
      pending: [{ hash: 'ab'.repeat(32), title: 'Sign in to goon.vc', summary: 'Passport asks', from: { label: 'Passport' } }],
      signers: [{
        pubkey: PEER,
        label: 'Passport',
        sameIdentity: true,
        linkedAt: Date.now(),
        given: [{ hash: '01'.repeat(32), direction: 'given', scopes: ['identity', 'passport'], revoked: false }],
        received: [{ hash: '02'.repeat(32), direction: 'received', scopes: ['identity'], revoked: false }]
      }]
    });
    const tree = ls.render();
    const text = textOf(tree);
    assert.match(text, /Waiting for you/);
    assert.match(text, /Sign in to goon.vc/);
    assert.match(text, /Same player/);
    assert.match(text, /You allow: Act as this player, Sign in to websites/);
    assert.match(text, /It allows you: Act as this player/);
    const labels = buttonsOf(tree);
    for (const need of ['Sign', 'Decline', 'Revoke', 'Unlink']) assert.ok(labels.includes(need), need);
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
