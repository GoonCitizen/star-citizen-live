'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert');

const {
  matchSlashMenu,
  listSlashCommands,
  normalizeAttachment,
  isWireEncoded,
  encodeWireBody,
  decodeWireBody,
  displayCaption,
  discordCaptionForAttach
} = require('../../functions/chatAttachment');

describe('chatAttachment slash + wire edges', () => {
  it('lists lookup/help/file/price and matches prefixes', () => {
    const cmds = listSlashCommands().map((c) => c.cmd);
    assert.ok(cmds.includes('/lookup'));
    assert.ok(cmds.includes('/help'));
    assert.deepStrictEqual(matchSlashMenu('/l').map((c) => c.cmd), ['/lookup']);
    assert.deepStrictEqual(matchSlashMenu('/').map((c) => c.cmd), cmds);
    assert.deepStrictEqual(matchSlashMenu('lookup'), []);
  });

  it('normalizeAttachment drops records without a document id', () => {
    assert.strictEqual(normalizeAttachment(null), null);
    assert.strictEqual(normalizeAttachment({ name: 'x' }), null);
    const att = normalizeAttachment({ id: 'doc1', purchasePriceSats: -3, size: 12 });
    assert.strictEqual(att.documentId, 'doc1');
    assert.strictEqual(att.purchasePriceSats, 0);
    assert.strictEqual(att.sealed, false);
    assert.strictEqual(att.size, 12);
  });

  it('decodeWireBody recovers caption when the first line is fabric-doc', () => {
    const wire = encodeWireBody({
      caption: 'ops brief',
      attachment: { documentId: 'aa', name: 'ops.txt', mime: 'text/plain', purchasePriceSats: 0 }
    });
    assert.ok(isWireEncoded(wire));
    const parsed = decodeWireBody(wire);
    assert.strictEqual(parsed.caption, 'ops brief');
    assert.strictEqual(displayCaption({ body: wire }), 'ops brief');
    assert.strictEqual(isWireEncoded('hello'), false);
  });

  it('discordCaptionForAttach is caption-only (no fabric-doc wire)', () => {
    const att = { documentId: 'aa', name: 'ops.txt', mime: 'text/plain' };
    assert.strictEqual(discordCaptionForAttach('', att), '📎 ops.txt');
    assert.ok(!discordCaptionForAttach('hello', att).includes('fabric-doc:'));
    assert.ok(discordCaptionForAttach('hello', att).includes('ops.txt'));
  });
});
