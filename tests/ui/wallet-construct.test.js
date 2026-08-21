'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert');

require('../helpers/installReactStub');
const { textOf, collect } = require('../helpers/reactTree');
const BitcoinWalletPanel = require('../../components/BitcoinWalletPanel');
const WalletConstruct = require('../../components/WalletConstruct');
const { constructHref } = require('../../functions/transactionConstruct');

describe('wallet send + constructor', () => {
  it('hides the send form until Send is pressed', () => {
    const panel = new BitcoinWalletPanel({
      bitcoinEnable: true,
      identityPubkey: '02' + 'ab'.repeat(32),
      identityLocked: false
    });
    panel.state.xpub = 'xpub1test';
    panel.state.status = { available: true, status: 'ONLINE', network: 'regtest' };
    const closed = textOf(panel.render());
    assert.match(closed, /\bSend\b/);
    assert.doesNotMatch(closed, /Send to/);
    assert.doesNotMatch(closed, /Advanced constructor/);

    panel.setState({ sendOpen: true, to: 'bcrt1qdest', amountSats: '1500', memo: 'ops' });
    const open = panel.render();
    const openText = textOf(open);
    assert.match(openText, /Send to/);
    assert.match(openText, /Advanced constructor/);
    const links = collect(open, (n) => n && n.$$typeof === 'element' && n.props && n.props.href);
    assert.ok(links.some((n) => String(n.props.href).startsWith('/wallet/construct')));
    assert.strictEqual(
      constructHref({ to: 'bcrt1qdest', amountSats: '1500', memo: 'ops' }),
      '/wallet/construct?to=bcrt1qdest&amountSats=1500&memo=ops'
    );
  });

  it('renders the advanced constructor with outputs, fee, and preview', () => {
    const page = new WalletConstruct({
      to: 'bcrt1qdest',
      amountSats: '2500',
      memo: 'ops'
    });
    page.state.receive = { address: 'bcrt1qchange', path: "m/44'/0'/0'/0/0" };
    page.state.status = { network: 'regtest', available: true };
    page.state.utxos = [{ txid: 'ab'.repeat(32), vout: 1, amountSats: 50000 }];
    page.state.error = null;
    const text = textOf(page.render());
    assert.match(text, /Transaction constructor/);
    assert.match(text, /Send to/);
    assert.match(text, /Add output/);
    assert.match(text, /Fee sats/);
    assert.match(text, /Change address/);
    assert.match(text, /Preview/);
    assert.match(text, /Watch UTXOs/);
    assert.match(text, /Broadcast/);
    assert.match(text, /bcrt1qdest/);
    assert.match(text, /2500/);
    assert.match(text, /bcrt1qchange/);
  });
});
