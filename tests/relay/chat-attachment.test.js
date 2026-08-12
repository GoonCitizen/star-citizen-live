'use strict';

const test = require('node:test');
const assert = require('node:assert');

const {
  encodeWireBody,
  decodeWireBody,
  normalizeAttachment,
  matchSlashMenu,
  displayCaption,
  messageAttachment,
  DEFAULT_CHAT_ATTACH_PRICE_SATS
} = require('../../functions/chatAttachment');
const ChatManager = require('../../services/ChatManager');
const { Store } = require('../../types/Store');
const { createIdentity } = require('../../functions/identity');

test('chatAttachment: round-trip wire body with default Hub price', () => {
  const attachment = normalizeAttachment({
    documentId: 'abc123',
    name: 'note.txt',
    mime: 'text/plain',
    purchasePriceSats: DEFAULT_CHAT_ATTACH_PRICE_SATS
  });
  assert.strictEqual(attachment.sealed, true);
  const wire = encodeWireBody({ caption: 'hello', attachment });
  assert.ok(wire.startsWith('fabric-doc:'));
  const parsed = decodeWireBody(wire);
  assert.strictEqual(parsed.caption, 'hello');
  assert.strictEqual(parsed.attachment.documentId, 'abc123');
  assert.strictEqual(parsed.attachment.purchasePriceSats, 25);
});

test('chatAttachment: slash menu matches /fi → /file', () => {
  const hits = matchSlashMenu('/fi');
  assert.ok(hits.some((c) => c.cmd === '/file'));
  assert.deepStrictEqual(matchSlashMenu('hello'), []);
});

test('ChatManager.post stores DocumentPublish attachment and encodes wire body', async () => {
  const dir = require('fs').mkdtempSync(require('path').join(require('os').tmpdir(), 'sc-chat-att-'));
  const store = new Store({ path: dir });
  await store.start();
  const cm = new ChatManager({ store });
  const id = createIdentity();
  const record = cm.post({
    channel: 'global',
    body: 'see file',
    author: id.pubkey,
    attachment: {
      documentId: 'deadbeef',
      name: 'ops.txt',
      mime: 'text/plain',
      purchasePriceSats: 25
    }
  });
  assert.ok(record.body.startsWith('fabric-doc:'));
  assert.strictEqual(record.attachment.documentId, 'deadbeef');
  assert.strictEqual(displayCaption(record), 'see file');
  assert.strictEqual(messageAttachment(record).purchasePriceSats, 25);
  if (typeof store.stop === 'function') await store.stop();
});
