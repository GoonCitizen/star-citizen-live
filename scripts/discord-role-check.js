'use strict';

/**
 * Discord role-setup test (M5.3 groundwork).
 *
 * Answers one question: does a Discord user hold the org's "Officer" role?
 * This is the mapping the mission register uses for officer permission.
 *
 * It uses the Discord REST API with a BOT token to read (a) the guild's roles
 * and (b) one member's roles. A single-member lookup needs only that the bot is
 * in the server (no gateway, no message content). Enabling the "Server Members
 * Intent" on the bot avoids any ambiguity and is needed for later features.
 *
 * Run (PowerShell):
 *   $env:DISCORD_BOT_TOKEN="..."; $env:DISCORD_GUILD_ID="..."; $env:DISCORD_USER_ID="..."
 *   node scripts/discord-role-check.js            # checks the "Officer" role
 *   $env:DISCORD_OFFICER_ROLE="Fleet Officer"; node scripts/discord-role-check.js
 *
 * The token is a SECRET — never commit it; regenerate it after testing.
 */

const TOKEN = process.env.DISCORD_BOT_TOKEN;
const GUILD = process.env.DISCORD_GUILD_ID;
const USER = process.env.DISCORD_USER_ID;
const ROLE = process.env.DISCORD_OFFICER_ROLE || 'Officer';
const API = 'https://discord.com/api/v10';

async function dget (path) {
  const r = await fetch(API + path, { headers: { Authorization: `Bot ${TOKEN}`, 'User-Agent': 'PermafleetRoleCheck/0.1' } });
  let json; try { json = JSON.parse(await r.text()); } catch (_) { json = null; }
  return { status: r.status, json };
}

(async () => {
  if (!TOKEN || !GUILD || !USER) {
    console.error('Missing input. Set DISCORD_BOT_TOKEN, DISCORD_GUILD_ID and DISCORD_USER_ID.');
    process.exit(2);
  }
  const roles = await dget(`/guilds/${GUILD}/roles`);
  if (roles.status === 401) { console.error('401 Unauthorized — the bot token is wrong or was reset.'); process.exit(1); }
  if (roles.status === 403) { console.error('403 Forbidden — the bot is not in this server, or lacks access.'); process.exit(1); }
  if (roles.status !== 200 || !Array.isArray(roles.json)) { console.error('Could not read roles:', roles.status, roles.json); process.exit(1); }

  const officer = roles.json.find((r) => r.name.toLowerCase() === ROLE.toLowerCase());
  if (!officer) {
    console.error(`No role named "${ROLE}" found. Roles in this server: ${roles.json.map((r) => r.name).join(', ')}`);
    process.exit(1);
  }
  console.log(`✓ Found role "${officer.name}" (id ${officer.id})`);

  const member = await dget(`/guilds/${GUILD}/members/${USER}`);
  if (member.status === 404) { console.error('404 — that user is not a member of this server, or the IDs are wrong.'); process.exit(1); }
  if (member.status !== 200) { console.error('Could not read member:', member.status, member.json); process.exit(1); }

  const u = member.json.user || {};
  const handle = u.global_name || u.username || USER;
  const held = member.json.roles || [];
  const isOfficer = held.includes(officer.id);

  console.log(`✓ Member: ${handle} (holds ${held.length} role${held.length === 1 ? '' : 's'})`);
  console.log('');
  console.log(`RESULT  isOfficer(${handle}) = ${isOfficer}`);
  console.log(isOfficer
    ? '→ This user WOULD be allowed to post/validate missions.'
    : `→ This user would NOT be an officer (assign the "${officer.name}" role to change that).`);
})().catch((e) => { console.error('Error:', e.message); process.exit(1); });
