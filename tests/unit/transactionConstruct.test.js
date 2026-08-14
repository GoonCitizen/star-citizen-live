'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert');

const {
  blankOutput,
  constructHref,
  constructPath,
  fromLocation,
  parseConstructQuery,
  pickUtxoList,
  previewDraft
} = require('../../functions/transactionConstruct');

describe('transactionConstruct', () => {
  it('builds /wallet/construct hrefs from a simple send draft', () => {
    assert.strictEqual(constructPath(), '/wallet/construct');
    assert.strictEqual(constructHref(), '/wallet/construct');
    assert.strictEqual(
      constructHref({ to: 'bcrt1qtest', amountSats: 2500, memo: 'ops' }),
      '/wallet/construct?to=bcrt1qtest&amountSats=2500&memo=ops'
    );
  });

  it('parses query drafts and location paths', () => {
    const q = parseConstructQuery('?to=bcrt1qaa&amountSats=1000');
    assert.strictEqual(q.to, 'bcrt1qaa');
    assert.strictEqual(q.amountSats, '1000');
    assert.ok(fromLocation('/wallet/construct', '?to=bcrt1qaa'));
    assert.strictEqual(fromLocation('/wallet', ''), null);
    assert.ok(fromLocation('/wallet/construct/', ''));
  });

  it('previews multi-output Hub sends and fee as constructor-only', () => {
    const preview = previewDraft({
      outputs: [
        { to: 'bcrt1qa', amountSats: 1000 },
        { to: 'bcrt1qb', amountSats: 2000 },
        blankOutput()
      ],
      feeSats: 250,
      changeAddress: 'bcrt1qchange',
      memo: 'batch'
    });
    assert.strictEqual(preview.ok, true);
    assert.strictEqual(preview.outputCount, 2);
    assert.strictEqual(preview.totalSats, 3000);
    assert.strictEqual(preview.feeSats, 250);
    assert.strictEqual(preview.hubSends.length, 2);
    assert.strictEqual(preview.hubSends[1].to, 'bcrt1qb');
    assert.strictEqual(preview.hubSends[0].memo, 'batch');
    assert.match(preview.feeNote, /preview only/i);
  });

  it('rejects a draft with no valid outputs', () => {
    const preview = previewDraft({ outputs: [blankOutput()] });
    assert.strictEqual(preview.ok, false);
    assert.ok(preview.errors.some((e) => /at least one output/i.test(e)));
  });

  it('picks Hub xpub UTXO lists', () => {
    const rows = pickUtxoList({ utxos: [{ txid: 'aa', vout: 0, amountSats: 12 }] });
    assert.strictEqual(rows.length, 1);
    assert.strictEqual(rows[0].vout, 0);
  });
});
