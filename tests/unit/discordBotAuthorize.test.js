'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert');

const {
  REQUIRED_BOT_PERMISSIONS,
  discordSnowflakeId,
  formatPermissionList,
  missingRequiredBotPermissions,
  discordBotAuthorizeUrl,
  looksLikeMissingPermissionError,
  botPermissionNotice,
  httpErrorBody
} = require('../../functions/discordBotAuthorize');

describe('discordBotAuthorize', () => {
  it('accepts numeric Discord snowflakes only', () => {
    assert.strictEqual(discordSnowflakeId('123456789012345678'), '123456789012345678');
    assert.strictEqual(discordSnowflakeId(' 111 '), '111');
    assert.strictEqual(discordSnowflakeId('app-1'), null);
    assert.strictEqual(discordSnowflakeId('javascript:alert(1)'), null);
    assert.strictEqual(discordSnowflakeId('https://evil.example/'), null);
  });

  it('builds a bot authorize URL with required permissions and optional guild', () => {
    const url = discordBotAuthorizeUrl({
      appId: '123456789012345678',
      guildId: '987654321098765432'
    });
    assert.ok(url);
    const parsed = new URL(url);
    assert.strictEqual(parsed.origin + parsed.pathname, 'https://discord.com/oauth2/authorize');
    assert.strictEqual(parsed.searchParams.get('client_id'), '123456789012345678');
    assert.strictEqual(parsed.searchParams.get('permissions'), String(REQUIRED_BOT_PERMISSIONS));
    assert.strictEqual(parsed.searchParams.get('scope'), 'bot');
    assert.strictEqual(parsed.searchParams.get('guild_id'), '987654321098765432');
    assert.strictEqual(parsed.searchParams.get('disable_guild_select'), 'true');
    assert.strictEqual(parsed.searchParams.get('integration_type'), '0');
    assert.strictEqual(discordBotAuthorizeUrl({ appId: 'not-a-snowflake' }), null);
    assert.strictEqual(discordBotAuthorizeUrl({}), null);
  });

  it('lists missing required bot bits and formats a notice with an authorize link', () => {
    assert.deepStrictEqual(missingRequiredBotPermissions({ view: true, send: false }), [
      'Send Messages'
    ]);
    assert.deepStrictEqual(
      missingRequiredBotPermissions({ view: false, send: false, readHistory: false }),
      ['View Channel', 'Send Messages', 'Read Message History']
    );
    assert.deepStrictEqual(missingRequiredBotPermissions({ view: true, send: true }), []);
    assert.strictEqual(formatPermissionList(['Send Messages']), 'Send Messages');
    assert.strictEqual(formatPermissionList(['View Channel', 'Send Messages']),
      'View Channel and Send Messages');

    const notice = botPermissionNotice({
      bot: { view: true, send: false },
      appId: '123456789012345678',
      guildId: '111'
    });
    assert.ok(notice);
    assert.ok(/cannot send/i.test(notice.text));
    assert.ok(/Send Messages/.test(notice.text));
    assert.strictEqual(notice.linkLabel, 'Authorize permission');
    assert.ok(notice.url.indexOf('https://discord.com/oauth2/authorize?') === 0);
    assert.ok(notice.url.includes('guild_id=111'));

    const noApp = botPermissionNotice({ bot: { view: false, send: false } });
    assert.ok(noApp);
    assert.strictEqual(noApp.url, null);
    assert.ok(/Application ID/i.test(noApp.text));
    assert.strictEqual(botPermissionNotice({ bot: { view: true, send: true } }), null);
  });

  it('detects Discord missing-permission errors and shapes HTTP bodies', () => {
    assert.strictEqual(looksLikeMissingPermissionError({ code: 50013, message: 'x' }), true);
    assert.strictEqual(looksLikeMissingPermissionError('Missing Access'), true);
    assert.strictEqual(looksLikeMissingPermissionError('unknown channel'), false);
    assert.deepStrictEqual(
      httpErrorBody({
        error: 'Discord: Missing Permissions',
        authorizeUrl: 'https://discord.com/oauth2/authorize?client_id=1'
      }),
      {
        error: 'Discord: Missing Permissions',
        authorizeUrl: 'https://discord.com/oauth2/authorize?client_id=1'
      }
    );
    assert.deepStrictEqual(httpErrorBody({ error: 'nope' }), { error: 'nope' });
  });
});
