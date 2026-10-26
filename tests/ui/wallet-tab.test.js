'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert');

require('../helpers/installReactStub');
const { textOf, findType } = require('../helpers/reactTree');

const buttons = (tree, label) => findType(tree, 'button').filter((b) => textOf(b).trim().endsWith(label));
const Wallet = require('../../components/Wallet');
const GroupBitcoinPanel = require('../../components/GroupBitcoinPanel');
const BitcoinWalletPanel = require('../../components/BitcoinWalletPanel');
const WalletConstruct = require('../../components/WalletConstruct');
const Dashboard = require('../../components/Dashboard');

const ME = '02' + 'ab'.repeat(32);
const ADDR = 'bcrt1qgroupaddr00000000000000000000000000000';

describe('Wallet tab', () => {
  it('shows Hub Bitcoin, escrow backend, and empty group/escrow copy', () => {
    const page = new Wallet({
      identityPubkey: ME,
      pubkey: ME,
      bitcoinEnable: true
    });
    page.state.loading = false;
    page.state.wallet = {
      mode: 'ledger',
      network: 'regtest',
      feeSats: 10,
      escrows: [],
      bitcoin: { enable: true, network: 'regtest' }
    };
    page.state.groups = [];
    const tree = page.render();
    const text = textOf(tree);
    assert.strictEqual(findType(tree, BitcoinWalletPanel).length, 1);
    assert.match(text, /Escrow backend/);
    assert.match(text, /Alliance treasury/);
    assert.match(text, /federation vault/);
    assert.match(text, /Mission escrows/);
    assert.match(text, /No groups yet/);
    assert.match(text, /No escrows yet/);
    assert.match(text, /ledger/);
  });

  it('embeds a group Bitcoin panel when a group wallet is loaded', () => {
    const page = new Wallet({
      identityPubkey: ME,
      pubkey: ME,
      bitcoinEnable: true
    });
    page.state.loading = false;
    page.state.wallet = { mode: 'ledger', network: 'regtest', escrows: [], bitcoin: { enable: true } };
    page.state.groups = [{
      id: 'group-1',
      name: 'Salvage Wing',
      creator: ME,
      members: [ME, '02' + 'cd'.repeat(32)],
      threshold: 2
    }];
    page.state.groupWallets = {
      'group-1': {
        groupId: 'group-1',
        address: ADDR,
        mode: 'federation',
        threshold: 2,
        keys: [ME, '02' + 'cd'.repeat(32)],
        balanceSats: 2500,
        bitcoinEnable: true
      }
    };
    const tree = page.render();
    assert.match(textOf(tree), /Salvage Wing/);
    assert.strictEqual(findType(tree, GroupBitcoinPanel).length, 1);
  });

  it('is on the Dashboard Wallet tab when Bitcoin is enabled', () => {
    const dash = new Dashboard({});
    dash.state.tab = 'wallet';
    dash.state.online = true;
    dash.state.bitcoinEnable = true;
    const tree = dash.render();
    assert.strictEqual(findType(tree, Wallet).length, 1);
  });
});

describe('Group Bitcoin panel', () => {
  it('shows address, copy, and withdraw for a signer when Bitcoin is on', () => {
    const panel = new GroupBitcoinPanel({
      wallet: {
        groupId: 'group-1',
        federationId: 'fe'.repeat(32),
        address: ADDR,
        mode: 'federation',
        threshold: 2,
        keys: ['a', 'b'],
        balanceSats: 1234,
        bitcoinEnable: true,
        viewerIsSigner: true,
        viewerKey: 'ab'.repeat(32),
        previous: []
      },
      bitcoinEnable: true,
      onCopy: () => {},
      onRefresh: () => {}
    });
    const text = textOf(panel.render());
    assert.match(text, /Copy address/);
    assert.match(text, /Withdraw…/);
    assert.match(text, /Refresh/);
    assert.match(text, /sats/);
    assert.match(text, /2-of-2/);
    assert.match(text, /federation/);
    assert.ok(text.includes(ADDR));
  });

  it('lists withdrawals with a Sign button for a signer who has not signed', () => {
    const wallet = {
      groupId: 'group-1',
      federationId: 'fe'.repeat(32),
      address: ADDR,
      mode: 'federation',
      threshold: 2,
      keys: ['a', 'b'],
      viewerIsSigner: true,
      viewerKey: 'ab'.repeat(32),
      previous: [{ federationId: 'ee'.repeat(32), address: 'bcrt1pold', threshold: 1, keys: ['02' + 'ab'.repeat(32)], balanceSats: 700 }]
    };
    const row = { id: 'cc'.repeat(32), federationId: wallet.federationId, amountSats: 5000, destinationAddress: 'bcrt1qdest', threshold: 2, status: 'pending' };
    const panel = new GroupBitcoinPanel({ wallet, bitcoinEnable: true });
    panel.state.withdrawals = [Object.assign({ signers: ['cd'.repeat(32)] }, row)];
    let tree = panel.render();
    let text = textOf(tree);
    assert.match(text, /Withdrawals/);
    assert.match(text, /1 of 2/);
    assert.match(text, /waiting for signatures/);
    assert.strictEqual(buttons(tree, 'Sign').length, 1);
    assert.strictEqual(buttons(tree, 'Withdraw…').length, 2, 'current vault + the earlier one viewer signs for');
    assert.match(text, /Earlier vaults/);
    assert.ok(text.includes('bcrt1pold'));

    panel.state.withdrawals = [Object.assign({ signers: ['ab'.repeat(32)] }, row)];
    tree = panel.render();
    assert.strictEqual(buttons(tree, 'Sign').length, 0, 'already signed');

    panel.state.form = { destinationAddress: '', amountSats: '', feeSats: '1000' };
    text = textOf(panel.render());
    assert.match(text, /Pay to address/);
    assert.match(text, /Request/);
  });

  it('offers no withdraw to a reader', () => {
    const panel = new GroupBitcoinPanel({
      wallet: { groupId: 'g', address: ADDR, mode: 'federation', threshold: 1, keys: ['a'], viewerIsSigner: false },
      bitcoinEnable: false
    });
    assert.doesNotMatch(textOf(panel.render()), /Withdraw/);
  });

  it('hides balance when Bitcoin is off', () => {
    const panel = new GroupBitcoinPanel({
      wallet: { address: ADDR, mode: 'federation', balanceSats: 99, bitcoinEnable: false },
      bitcoinEnable: false
    });
    const text = textOf(panel.render());
    assert.doesNotMatch(text, /99 sats/);
    assert.ok(text.includes(ADDR));
  });

  it('renders unavailable and error states', () => {
    assert.match(textOf(new GroupBitcoinPanel({}).render()), /Wallet unavailable/);
    assert.match(
      textOf(new GroupBitcoinPanel({ wallet: { error: 'RPC down' } }).render()),
      /RPC down/
    );
  });
});

describe('WalletConstruct.fromLocation', () => {
  it('matches /wallet/construct query drafts', () => {
    const prev = window.location;
    window.location = {
      pathname: '/wallet/construct',
      search: '?to=bcrt1qdest&amountSats=1500',
      href: 'http://127.0.0.1/wallet/construct?to=bcrt1qdest&amountSats=1500',
      hash: ''
    };
    try {
      const loc = WalletConstruct.fromLocation();
      assert.ok(loc);
      assert.match(loc.href, /\/wallet\/construct/);
      assert.match(loc.href, /bcrt1qdest/);
    } finally {
      window.location = prev;
    }
  });

  it('ignores other paths', () => {
    const prev = window.location;
    window.location = { pathname: '/wallet', search: '', href: 'http://127.0.0.1/wallet', hash: '' };
    try {
      assert.strictEqual(WalletConstruct.fromLocation(), null);
    } finally {
      window.location = prev;
    }
  });
});
