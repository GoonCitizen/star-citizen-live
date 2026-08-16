# Security (GoonCitizen / star-citizen-live)
Star Citizen live relay, desktop shell, and Fabric mesh participant.

**Outstanding queue:** [docs/OUTSTANDING.md](docs/OUTSTANDING.md). Product claims: [docs/THREAT-MODEL.md](docs/THREAT-MODEL.md).
Operators of a public seed: [docs/PRODUCTION.md](docs/PRODUCTION.md). Contributors
and other orgs: [DEVELOPERS.md](DEVELOPERS.md).

## Adversarial environment
Fabric networks are intended for deployment where **peers, relays, hubs, and operators may be hostile**. Design and review against:

- Untrusted TCP / WebSocket / WebRTC neighbors (forgery, replay, amplification, pin hijack)
- Phishing of identity flows (`fabric://login`, device-link) toward attacker-controlled hubs
- Public observability of unsigned or plaintext application traffic unless an explicit seal is used
- No reliance on an “honest majority” of random internet peers for key custody

See also [`docs/THREAT-MODEL.md`](docs/THREAT-MODEL.md) for product claims (opt-in log share, loopback HTTP default, plaintext chat limits).

**Basics coverage:** [`tests/relay/adversarialEnvironment.basics.test.js`](tests/relay/adversarialEnvironment.basics.test.js). Related: [`tests/relay/fabric-hub-allowlist.test.js`](tests/relay/fabric-hub-allowlist.test.js).

## Operator defaults
- Dashboard HTTP binds loopback unless shared mode is explicit. Public
  `SC_MODE=server` (`scripts/node.js`) also defaults loopback for Caddy / Nginx
  (`docs/PRODUCTION.md`).
- Gameplay log share off by default (D-017).
- Discord webhooks / bot tokens via env, `settings/local.js`, or Settings UI
  secrets file under the store root — never commit; never put tokens in the
  Fabric Store collection.
- Site login / device-link complete only against allowlisted Hub origins.

## Outstanding (RSI follow-ups)
- **Open GitHub PR** — [PR #7](https://github.com/GoonCitizen/star-citizen-live/pull/7) (`feature/rsi`, WIP Android). [PR #6](https://github.com/GoonCitizen/star-citizen-live/pull/6) is closed historical overlay/replay. Do not merge to `master`.
- ~~**`@fabric/*` pin hygiene**~~ — lockfile Git commit SHAs: core `4a1ff0a5707143d965a2da61f700eda4be3a24ae` ([#185](https://github.com/FabricLabs/fabric/pull/185)), http `cff2ce66a62d358f709b0150d2574d3910931047` ([#69](https://github.com/FabricLabs/fabric-http/pull/69)), hub `0f221d9d6c52edf4471c9d4419b434389ba11094` ([#16](https://github.com/FabricLabs/hub.fabric.pub/pull/16)), discord `175d9f24cc3c75fa46f5a7aef15cb749dec33dc0` ([#2](https://github.com/FabricLabs/fabric-discord/pull/2)). `report:install` wipes `package-lock.json` then `npm i --allow-git=all`. Normal install is `npm ci`. Hub `0f221d9` exports `./functions/bulkSecurityAdvisory` and `./functions/operatorAdminToken`, does not force Bitcoin RPC debug, walks GHSA arrays with `for…of`, and BIP-69-sorts unsigned PSBTs. Http `cff2ce66` sibling-NIC self-filter is in `@fabric/http/functions/fabricPeerHost`. Discord `175d9f2` voice flag `commit()` debounce is in `@fabric/discord`.
- ~~**Fabric coin types**~~ — current core pin includes **7777** / **7778**; local site-login verify re-exports `@fabric/http`. No SCL-local BIP44 identity hardcode remains to flip.
- ~~**`@fabric/discord` `normalizeDiscordSettings`**~~ — [`functions/discordConfig.js`](functions/discordConfig.js) requires the package export; local [`functions/normalizeDiscordSettings.js`](functions/normalizeDiscordSettings.js) is a thin re-export.
- ~~**Identity cluster**~~ — [`functions/identityCluster.js`](functions/identityCluster.js) re-exports `@fabric/hub/functions/identityCluster` (Hub `0f221d9` keys are x-only / compressed hex only). Keep [`functions/identityCrossSign.js`](functions/identityCrossSign.js) local (browser-safe protocol strings; `_normPubkey` matches core).
- **npm audit (prod omit-dev)** — ~~**critical** `screenshot-desktop`~~ bumped to `=1.15.4` (GHSA-gjx4-2c7g-fm94); still hardcode `{ format: 'png' }` in capture paths. Remaining **high**: transitive `serialize-javascript` (mocha), `undici` (discord.js 14.18). Prefer upstream bumps / scoped overrides over `npm audit fix --force`.
- ~~**Shared-mode LAN writes**~~ — [`functions/httpRemoteAuth.js`](functions/httpRemoteAuth.js) requires Bearer/Schnorr on mutating routes for non-loopback peers when `httpSharedMode` is on (same bar as `SC_MODE=server`). Hosted/shared-LAN GETs for notes, local tags, analytics, documents, Discord link/guilds, settings, peers, gameplay collections, groupaudit, chat list/channels, identity cluster, snapshots, and document offers require a session (`tests/relay/privacy-http-auth.test.js`). Unauth `GET /groups` does not dump private groups. `bitcoinRuntimeForSettings` omits `adminToken`. `isLoopbackRequest` ignores `X-Forwarded-For`. Bearer sessions expire in **8h**; `DELETE /services/star-citizen/auth` revokes the presented token. Remaining mesh/Hub/Passport follow-ups: [docs/PRIVACY_REMAINING.md](docs/PRIVACY_REMAINING.md).
- **PR split** — large WIP still benefits from stacked PRs before merge to `master`.

## Process
1. `npm test` before merging peering, auth, or wallet paths.
2. Never commit `settings/local.js` secrets, `.env`, or live webhooks.
3. Align with `@fabric/core` SECURITY.md when upgrading Fabric deps.
4. Prefer `npm ci` / keep `package-lock.json`; `npm run report:install` wipes lockfile then `npm i --allow-git=all`.

## Disclosure
Canonical monitored contact for Fabric/crypto issues: **`security@fabric.pub`**. GitHub Security Advisories are the alternate private channel. Product bugs may use the repository issue tracker.
