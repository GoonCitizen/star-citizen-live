'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert');

const { createIdentity, canonicalChatAuthor } = require('../../functions/identity');
const settingsStore = require('../../functions/settingsStore');
const {
  parseDiscordActor,
  discordActorKey,
  canonicalChatActor,
  generateLinkCode,
  isLinkCode,
  parseLinkCommand,
  buildChallenge,
  challengeIsFresh,
  sanitizeLinks,
  upsertLink,
  removeLink,
  linkForDiscordUser,
  linkForPubkey,
  mergeDiscordThreadMessages,
  applyLinksToMessages,
  formatOutboundDiscordContent,
  CHALLENGE_TTL_MS
} = require('../../functions/discordIdentityLink');

describe('discordIdentityLink', () => {
  it('parses discord actors without treating Fabric pubkeys as Discord ids', () => {
    assert.strictEqual(parseDiscordActor('discord:u1'), 'u1');
    assert.strictEqual(parseDiscordActor('02aa'), null);
    assert.strictEqual(discordActorKey('u1'), 'discord:u1');
    assert.strictEqual(discordActorKey('discord:u1'), 'discord:u1');
    assert.strictEqual(canonicalChatActor('discord:u1'), 'discord:u1');
  });

  it('canonicalChatActor accepts Fabric pubkeys', () => {
    const alice = createIdentity();
    assert.strictEqual(canonicalChatActor(alice.pubkey), canonicalChatAuthor(alice.pubkey));
  });

  it('parses !link / !unlink commands', () => {
    assert.deepStrictEqual(parseLinkCommand('!link ABC23XYZ'), { action: 'link', code: 'ABC23XYZ' });
    assert.deepStrictEqual(parseLinkCommand('  !LINK abc23xyz  '), { action: 'link', code: 'ABC23XYZ' });
    assert.deepStrictEqual(parseLinkCommand('!link'), { action: 'link', code: null });
    assert.deepStrictEqual(parseLinkCommand('!unlink'), { action: 'unlink', code: null });
    assert.strictEqual(parseLinkCommand('hello fleet'), null);
    assert.strictEqual(parseLinkCommand('!ping'), null);
  });

  it('issues 8-character link codes and expires challenges', () => {
    const code = generateLinkCode();
    assert.strictEqual(isLinkCode(code), true);
    const alice = createIdentity();
    const now = 1_700_000_000_000;
    const challenge = buildChallenge({ pubkey: alice.pubkey, now, code });
    assert.strictEqual(challenge.code, code);
    assert.ok(challengeIsFresh(challenge, now + 1000));
    assert.ok(!challengeIsFresh(challenge, now + CHALLENGE_TTL_MS + 1));
  });

  it('upserts one Discord user ↔ one Fabric pubkey and resolves authors', () => {
    const alice = createIdentity();
    const bob = createIdentity();
    let links = upsertLink([], {
      discordUserId: 'u1',
      pubkey: alice.pubkey,
      username: 'alice'
    });
    assert.strictEqual(links.length, 1);
    assert.strictEqual(linkForDiscordUser(links, 'u1').pubkey, canonicalChatAuthor(alice.pubkey));
    assert.ok(linkForPubkey(links, alice.pubkey));

    links = upsertLink(links, {
      discordUserId: 'u1',
      pubkey: bob.pubkey,
      username: 'alice'
    });
    assert.strictEqual(links.length, 1);
    assert.strictEqual(linkForPubkey(links, alice.pubkey), null);
    assert.ok(linkForPubkey(links, bob.pubkey));

    const { links: next, removed } = removeLink(links, { discordUserId: 'u1' });
    assert.ok(removed);
    assert.deepStrictEqual(next, []);
  });

  it('merges stored ChatMessages over Discord insight and applies links', () => {
    const alice = createIdentity();
    const pk = canonicalChatAuthor(alice.pubkey);
    const insight = [{
      id: 'discord-msg:m1',
      discordMessageId: 'm1',
      author: 'discord:u1',
      handle: 'alice',
      body: 'o7',
      ts: '2026-08-12T12:00:00.000Z',
      kind: 'discord'
    }];
    const stored = [{
      id: 'stored-1',
      discordMessageId: 'm1',
      author: pk,
      handle: 'Neorion',
      body: 'o7',
      ts: '2026-08-12T12:00:00.000Z',
      kind: 'discord'
    }];
    const merged = mergeDiscordThreadMessages(stored, insight);
    assert.strictEqual(merged.length, 1);
    assert.strictEqual(merged[0].author, pk);
    assert.strictEqual(merged[0].handle, 'Neorion');

    const remapped = applyLinksToMessages(insight, [{
      discordUserId: 'u1',
      pubkey: alice.pubkey,
      username: 'alice'
    }]);
    assert.strictEqual(remapped[0].author, pk);
    assert.strictEqual(remapped[0].linked, true);
    assert.strictEqual(applyLinksToMessages(insight, [])[0].author, 'discord:u1');
  });

  it('prefixes outbound Discord posts with the operator handle', () => {
    assert.strictEqual(formatOutboundDiscordContent('Neorion', 'o7'), '**Neorion:** o7');
  });

  it('persists identity links through the settings allowlist', () => {
    assert.ok(settingsStore.ALLOWED_KEYS.includes('discordIdentityLinks'));
    const alice = createIdentity();
    const cleaned = sanitizeLinks([{
      discordUserId: 'u1',
      pubkey: alice.pubkey,
      username: 'alice',
      extra: 'drop-me'
    }, { discordUserId: '', pubkey: 'nope' }]);
    assert.strictEqual(cleaned.length, 1);
    assert.strictEqual(cleaned[0].discordUserId, 'u1');
    assert.ok(!cleaned[0].extra);
  });
});
