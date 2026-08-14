# Security (GoonCitizen / star-citizen-live)
Star Citizen live relay, desktop shell, and Fabric mesh participant.

**Outstanding queue:** [docs/OUTSTANDING.md](docs/OUTSTANDING.md). Product claims: [docs/THREAT-MODEL.md](docs/THREAT-MODEL.md).

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
- ~~**`@fabric/*` pin hygiene**~~ — lockfile Git commit SHAs: core `5557a2bfc830a3b472e6d26ed46b1a5fd7c16b9b` ([#185](https://github.com/FabricLabs/fabric/pull/185)), http `7536341d8fb910c9668c3f95e8cadfd5381523de` ([#69](https://github.com/FabricLabs/fabric-http/pull/69)), hub `361a75037f130f24db5350fb550e2b0de0731f6c` ([#16](https://github.com/FabricLabs/hub.fabric.pub/pull/16)), discord `175d9f24cc3c75fa46f5a7aef15cb749dec33dc0` ([#2](https://github.com/FabricLabs/fabric-discord/pull/2)). `report:install` wipes `package-lock.json` then `npm i --allow-git=all`. Normal install is `npm ci`. Hub `361a750` exports `./functions/bulkSecurityAdvisory` and `./functions/operatorAdminToken`. Http `7536341` sibling-NIC self-filter is in `@fabric/http/functions/fabricPeerHost`. Discord `175d9f2` voice flag `commit()` debounce is in `@fabric/discord`.
- ~~**Fabric coin types**~~ — current core pin includes **7777** / **7778**; local site-login verify re-exports `@fabric/http`. No SCL-local BIP44 identity hardcode remains to flip.
- ~~**`@fabric/discord` `normalizeDiscordSettings`**~~ — [`functions/discordConfig.js`](functions/discordConfig.js) requires the package export; local [`functions/normalizeDiscordSettings.js`](functions/normalizeDiscordSettings.js) is a thin re-export.
- ~~**Identity cluster**~~ — [`functions/identityCluster.js`](functions/identityCluster.js) re-exports `@fabric/hub/functions/identityCluster` (Hub `361a750` keys are x-only / compressed hex only). Keep [`functions/identityCrossSign.js`](functions/identityCrossSign.js) local (browser-safe protocol strings; `_normPubkey` matches core).
- **npm audit (prod omit-dev)** — ~~**critical** `screenshot-desktop`~~ bumped to `=1.15.4` (GHSA-gjx4-2c7g-fm94); still hardcode `{ format: 'png' }` in capture paths. Remaining **high**: transitive `serialize-javascript` (mocha), `undici` (discord.js 14.18). Prefer upstream bumps / scoped overrides over `npm audit fix --force`.
- ~~**Shared-mode LAN writes**~~ — [`functions/httpRemoteAuth.js`](functions/httpRemoteAuth.js) requires Bearer/Schnorr on mutating routes for non-loopback peers when `httpSharedMode` is on (same bar as `SC_MODE=server`). Unauth GETs on a shared bind still leak operator settings / catalog. Remaining threat-model follow-ups: DirectChat E2E / `P2P_FORWARD`, drop GroupChat seal v1, session revoke, mesh flood limits.
- **PR split** — large WIP still benefits from stacked PRs before merge to `master`.

## Process
1. `npm test` before merging peering, auth, or wallet paths.
2. Never commit `settings/local.js` secrets, `.env`, or live webhooks.
3. Align with `@fabric/core` SECURITY.md when upgrading Fabric deps.
4. Prefer `npm ci` / keep `package-lock.json`; `npm run report:install` wipes lockfile then `npm i --allow-git=all`.

## Disclosure
Canonical monitored contact for Fabric/crypto issues: **`security@fabric.pub`**. GitHub Security Advisories are the alternate private channel. Product bugs may use the repository issue tracker.
