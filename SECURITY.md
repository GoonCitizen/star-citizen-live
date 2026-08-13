# Security (GoonCitizen / star-citizen-live)
Star Citizen live relay, desktop shell, and Fabric mesh participant.

## Adversarial environment
Fabric networks are intended for deployment where **peers, relays, hubs, and operators may be hostile**. Design and review against:

- Untrusted TCP / WebSocket / WebRTC neighbors (forgery, replay, amplification, pin hijack)
- Phishing of identity flows (`fabric://login`, device-link) toward attacker-controlled hubs
- Public observability of unsigned or plaintext application traffic unless an explicit seal is used
- No reliance on an “honest majority” of random internet peers for key custody

See also [`docs/THREAT-MODEL.md`](docs/THREAT-MODEL.md) for product claims (opt-in log share, loopback HTTP default, plaintext chat limits).

**Basics coverage:** [`tests/relay/adversarialEnvironment.basics.test.js`](tests/relay/adversarialEnvironment.basics.test.js). Related: [`tests/relay/fabric-hub-allowlist.test.js`](tests/relay/fabric-hub-allowlist.test.js).

## Operator defaults
- Dashboard HTTP binds loopback unless shared mode / server deploy is explicit.
- Gameplay log share off by default (D-017).
- Discord webhooks / bot tokens via env, `settings/local.js`, or Settings UI
  secrets file under the store root — never commit; never put tokens in the
  Fabric Store collection.
- Site login / device-link complete only against allowlisted Hub origins.

## Outstanding (PR #6 / RSI follow-ups)
- **No PR review comments yet** on [PR #6](https://github.com/GoonCitizen/star-citizen-live/pull/6) (author description only) — re-check after Bugbot/CodeRabbit runs; keep this WIP split-ready (overlay/replay vs Fabric mesh vs Discord).
- ~~**`@fabric/*` pin hygiene**~~ — pins: core `2e2aec81…`, http `365f0b49…`, hub `e9e8630…`, discord `8b269fb…` (refreshed via `feature/rsi` then re-pinned). `report:install` keeps `package-lock.json`.
- ~~**Fabric coin types**~~ — current core pin includes **7777** / **7778**; local site-login verify re-exports `@fabric/http`. No SCL-local BIP44 identity hardcode remains to flip.
- ~~**`@fabric/discord` `normalizeDiscordSettings`**~~ — published on discord `8b269fb…`; [`functions/discordConfig.js`](functions/discordConfig.js) requires the package export; local [`functions/normalizeDiscordSettings.js`](functions/normalizeDiscordSettings.js) is a thin re-export.
- **npm audit (prod omit-dev)** — ~~**critical** `screenshot-desktop`~~ bumped to `=1.15.4` (GHSA-gjx4-2c7g-fm94); still hardcode `{ format: 'png' }` in capture paths. Remaining **high**: transitive `serialize-javascript` (mocha), `undici` (discord.js 14.18). Prefer upstream bumps / scoped overrides over `npm audit fix --force`.
- Threat-model follow-ups already listed in [`docs/THREAT-MODEL.md`](docs/THREAT-MODEL.md) (DirectChat E2E / `P2P_FORWARD`, drop GroupChat seal v1, session revoke).
- **PR split** — large WIP still benefits from stacked PRs before merge to `master`.

## Process
1. `npm test` before merging peering, auth, or wallet paths.
2. Never commit `settings/local.js` secrets, `.env`, or live webhooks.
3. Align with `@fabric/core` SECURITY.md when upgrading Fabric deps.
4. Prefer `npm ci` / keep `package-lock.json`; `npm run report:install` removes `node_modules` only.

## Disclosure
Report issues via the repository issue tracker / maintainer contact in README.
