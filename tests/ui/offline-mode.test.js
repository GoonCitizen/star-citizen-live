'use strict';

const { describe, it, after } = require('node:test');
const assert = require('node:assert');

require('../helpers/installReactStub');
const { textOf, findType, collect, findByClass, classList } = require('../helpers/reactTree');
const Dashboard = require('../../components/Dashboard');
const Settings = require('../../components/Settings');
const GlobalChatDock = require('../../components/GlobalChatDock');
const GroupPage = require('../../components/GroupPage');
const WalletConstruct = require('../../components/WalletConstruct');
const OfflineNotice = require('../../components/OfflineNotice');
const offlineMode = require('../../functions/offlineMode');

if (!global.history) {
  global.history = { replaceState () {} };
}

function tabLabels (dash) {
  const nav = findByClass(dash.render(), 'header-nav')[0];
  assert.ok(nav, 'missing header-nav');
  return collect(nav, (n) => n && n.$$typeof === 'element' && n.type === 'button' &&
    classList(n).includes('tab')).map((n) => textOf(n).trim());
}

describe('Offline Mode UI', () => {
  after(() => {
    try { global.localStorage.removeItem(offlineMode.PREF_KEY); } catch (_) { /* ignore */ }
  });

  it('settings overlay offers one Offline Mode switch and hides networking sections when it is on', () => {
    const page = new Settings({ onClose () {} });
    page.state.loading = false;
    page.state.editable = true;
    const off = textOf(page.render());
    assert.match(off, /Offline Mode/);
    assert.match(off, /Privacy/);
    assert.match(off, /Discord bot/);
    const box = collect(page.render(), (n) => n && n.props && n.props['data-testid'] === 'settings-offline-mode');
    assert.equal(box.length, 1);
    assert.equal(box[0].props.type, 'checkbox');
    assert.equal(box[0].props.checked, false);

    page.state.offlineMode = true;
    const on = textOf(page.render());
    assert.match(on, /Offline Mode/);
    assert.match(on, /Game\.log path/);
    assert.doesNotMatch(on, /Privacy/);
    assert.doesNotMatch(on, /Discord bot/);
    assert.doesNotMatch(on, /Desktop notifications/);
    assert.doesNotMatch(on, /Allow LAN access/);
    assert.doesNotMatch(on, /Fabric Network/);
    assert.doesNotMatch(on, /Primary group overlay/);
  });

  it('hides Chat, Groups, Network, Wallet, Files, and the shoutbox dock', () => {
    const dash = new Dashboard({});
    dash.state.online = true;
    dash.state.status = 'ok';
    dash.state.tab = 'home';
    dash.state.offlineMode = false;
    dash.state.advancedMode = true;
    dash.state.bitcoinEnable = true;
    dash.state.documentsEnable = true;
    const online = tabLabels(dash);
    assert.ok(online.includes('Chat'));
    assert.ok(online.includes('Groups'));
    assert.ok(online.includes('Network'));
    assert.ok(online.includes('Wallet'));
    assert.ok(online.includes('Files'));
    assert.equal(findType(dash.render(), GlobalChatDock).length, 1);

    dash.state.offlineMode = true;
    const labels = tabLabels(dash);
    assert.ok(labels.includes('Home'));
    assert.ok(labels.includes('Missions'));
    assert.ok(labels.includes('Fleets'));
    assert.ok(!labels.includes('Chat'));
    assert.ok(!labels.includes('Groups'));
    assert.ok(!labels.includes('Network'));
    assert.ok(!labels.includes('Wallet'));
    assert.ok(!labels.includes('Files'));
    assert.equal(findType(dash.render(), GlobalChatDock).length, 0);
  });

  it('sends a hidden hash tab home', () => {
    const dash = new Dashboard({});
    dash.state.offlineMode = true;
    dash.state.tab = 'chat';
    dash.showTab('chat', { fromHash: true });
    assert.equal(dash.state.tab, 'home');
  });

  it('dedicated group and wallet pages stand in for networking', () => {
    const group = new GroupPage({});
    group.state.loading = false;
    group.state.offlineMode = true;
    const groupTree = group.render();
    assert.equal(findType(groupTree, OfflineNotice).length, 1);
    assert.match(textOf(OfflineNotice({ backHref: '/' })), /Offline Mode/);

    const wallet = new WalletConstruct({});
    wallet.state.offlineMode = true;
    const walletTree = wallet.render();
    assert.equal(findType(walletTree, OfflineNotice).length, 1);
    assert.equal(findType(walletTree, 'h1').length, 0);
  });
});
