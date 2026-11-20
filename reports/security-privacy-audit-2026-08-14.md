# GoonCitizen security & privacy audit
**Scope:** local tree `~/star-citizen-live` on branch `feature/rsi` (`a96d5ae` + uncommitted working tree), as configured by `settings/local.js`.  
**Date:** 2026-08-14. **Method:** code review of LiveRelay + helpers, local settings, threat-model docs, adversary probes, `npm audit --omit=dev`. GitHub PR API was forbidden from this environment; open-PR notes come from `SECURITY.md` / `docs/OUTSTANDING.md` and local branches.  
**No commit.** This file is staged only.

## Status (later 2026-08-14)

H1–H7 and M1–M6 **HTTP leaks are gated** on `SC_MODE=server` / shared bind. Missing session is anonymous (never `_identity.pubkey`). Tests: `tests/relay/privacy-http-auth.test.js`. `shareDiscordCatalog` defaults **off**. `/lookup` omits local tags. Non-loopback HTTP bind `console.warn`s (`functions/httpBindWarning.js`). Production must still be loopback-behind-Caddy with `SC_MODE=server` (H6 is ops).

Living queues (do not treat this report as the tracker): [docs/OUTSTANDING.md](../docs/OUTSTANDING.md), [docs/PRIVACY_REMAINING.md](../docs/PRIVACY_REMAINING.md), [SECURITY.md](../SECURITY.md). Suite PR-comment locks: `@fabric/http` `tests/pr69.review.coverage.js`, Hub `EditDocument` advisory drop, core `loadWallet({ fromFile: true })`, Discord OAuth `state` + 501, Passport 32-byte master key.

**Still open (not HTTP GET leaks):** DirectChat / `P2P_FORWARD`; login/device-link redeem possession proof (`@fabric/http`); mesh flood limits; stolen device key until revoke; Hub heap OOM (ops). Do not freeze Origin-as-capability as correct.

## Local configuration (this machine)

| Knob | Value | Privacy / security note |
|------|--------|-------------------------|
| Branch | `feature/rsi` tracking `origin/feature/rsi` | WIP Android + Fabric mesh; do not merge to `master` |
| HTTP | LiveRelay still listens on **loopback `:3041`** | `settings/local.js` `http.enable: false` is **ignored** by `scripts/node.js` |
| Fabric Peer | **`:7778`**, seed `127.0.0.1:7777` (local Hub) | Peer bind remains `0.0.0.0` unless `FABRIC_INTERFACE` is set |
| Discord | `enable: false` | Catalog gossip default is still **on** if a bot is later enabled |
| Documents | **`enable: true`** | Local Files catalog + chat attach; GET returns `contentBase64` without auth |
| Bitcoin | **`enable: true`**, Hub `127.0.0.1:28380`, `adminTokenFile` → Hub playnet `admin-token-a.txt` | Loopback `POST …/bitcoin/send` injects that token; any local process can spend the Hub wallet |
| Game history | `stores/gooncitizen/history.json` empty corpus | Low local gameplay-PII today; APIs still unauthenticated in server mode |
| `settings/local.js` | **tracked in git** despite `.gitignore` | No live tokens in the file; path to Hub admin token file is committed if this file is committed |

Desktop trust model: **loopback HTTP = operator**. Writes do not require a session from `127.0.0.1`. That is intentional for Electron; it is also the blast radius for XSS, local malware, and `httpSharedMode`.

## Highest-severity findings

### H1 — Private identity notes readable without auth on hosted relay

`GET /services/star-citizen/notes` does not call `requireAuth()`. Viewer is:

```
_authPubkey(req) || (this._identity && this._identity.pubkey) || null
```

On `SC_MODE=server`, an unauthenticated client is treated as the **operator Fabric key**. `listNotes()` then returns every note authored by that key because `enforcePrivacy` only filters when `opts.viewer` is set — and here viewer is the operator.

`GET …/notes/:id` returns the raw store row with **no** visibility check.

**Impact:** Operator intelligence notes (Discord/Fabric subjects, free text) on `relay.goon.vc`.  
**Fix:** Require a session on all note GETs in server/shared mode. Never fall back to `_identity.pubkey` for a missing session. If `enforcePrivacy` and no viewer, return `[]` / 401. Apply the same gate on `GET …/notes/:id`.

### H2 — Local tags dumped without auth

`GET …/local-groups` and `GET …/local-groups/:id` have no `requireAuth()`. These are operator-only Discord/Fabric identity lists.

### H3 — Discord link unlink via operator-identity fallback

`GET|POST|DELETE …/discord/link` uses the same `_authPubkey || _identity.pubkey` fallback and does **not** call `requireAuth()`. On a hosted relay, unauthenticated `DELETE` can unlink the operator’s Discord ↔ Fabric binding.

### H4 — Unauthenticated profile file pin gossips to Federation

`POST …/files/:id/pin` has no `requireAuth()`. It calls `_publishGroupDataShareNow()`, which pushes `profile.files` to groups when `shareDiscordCatalog` / file gossip is active. Locally **documents are enabled**.

### H5 — Server-mode gameplay GETs still open

`GET …/analytics`, `/corpus`, `/combat`, `/activity-tree` have no server-mode session check (unlike `/monitor`, `/feed`, `/search`). A public relay that ever holds history leaks cumulative play stats.

### H6 — Production HTTP currently bare on the public NIC

`docs/PRODUCTION.md` (2026-08-14): RSI HTTP is bound on **`65.21.231.149:3041`**, not loopback-behind-Caddy. Combined with H1–H5 and the 2026-08-14 public probe (`reports/adversary-public-probe.json`), unauthenticated GETs of `/settings`, Discord guilds, groups, missions, peers, and presence roster are **internet-reachable** on that host until rebound.

`scripts/node.js` `serverSettings()` does default `httpHost` to `127.0.0.1`. `resolveHttpListenHost({ mode: 'server' })` without `host` still returns **`0.0.0.0`** — any LiveRelay constructed as server without that override binds all interfaces.

### H7 — Snapshot JPEG + listing unauthenticated on shared LAN

Inside the desktop-only settings block: `GET …/snapshots` and `GET …/snapshots/:id/image` have no session check. These are reduced-size **desktop screen captures**. Harmless on loopback; high if `httpSharedMode` is on.

## Medium findings

| ID | Issue | Where |
|----|--------|--------|
| M1 | `GET …/fs?path=` lists any directory the Node process can read (default `$HOME`). Disabled in server mode; open on LAN shared bind. | `LiveRelay.js` ~6061, `fsBrowser.js` |
| M2 | `GET …/documents/:id` returns `contentBase64` without auth. Local `documents.enable: true`. | `LiveRelay.js` ~8264 |
| M3 | `shareDiscordCatalog` defaults **true** (constructor + Settings UI). Guild/channel/message packs gossip to Federation groups; peers without a bot still merge world-view. | `settingsStore.js` ~49, `LiveRelay.js` ~292, 2481 |
| M4 | Unauthenticated GET of settings / Discord catalog / groups / missions / peers / presence on shared bind or public HTTP. **Confirmed** against `https://relay.goon.vc` (probe 2026-08-14). | threat model follow-up; probe JSON |
| M5 | `GET …/world-view` includes playtimes, pinned files, and `profileNotes.loadAllNotes`. | `LiveRelay.js` ~6672 |
| M6 | Chat `/lookup` mesh replies include **local tag names** and Discord user display names from the bot catalog. | `chatLookup.js` ~275–330, `LiveRelay.js` ~1911 |
| M7 | `_updateIdentityNote` enforces `prev.author === actor` only when `mode === 'server'`. | `LiveRelay.js` ~4855 |
| M8 | Sessions last **24h**, table capped by deleting `Object.keys()[0]`, **no revoke**. | `LiveRelay.js` ~4414 |
| M9 | Global chat + DirectChat are **signed plaintext** vs hubs/relays. GroupChat v1 tip-HKDF is not hub-blind. | `docs/THREAT-MODEL.md` |
| M10 | Stolen device key **is** the actor until `IdentityCrossSignRevoke`. | D-013 / OUTSTANDING |
| M11 | No mesh chat flood / inbound rate limit (adversary local probe; documented follow-up). | OUTSTANDING |
| M12 | Loopback `POST …/bitcoin/send` spends Hub wallet using `adminTokenFile` (playnet token path in tracked `settings/local.js`). | `hubBitcoinProxy.js`, local.js |
| M13 | `settings/local.js` is **git-tracked** despite `.gitignore`. | `git ls-files` |
| M14 | `npm audit --omit=dev`: 7 high (undici via discord.js, serialize-javascript via mocha, extract-zip via puppeteer), 7 moderate, 4 low. No critical. Matches SECURITY.md remaining highs. | lockfile |
| M15 | Android `POST …/identity/session` accepts `xprv` / mnemonic on loopback (gated, still device-local secret in JSON). | `LiveRelay.js` ~7037 |
| M16 | `.npmrc` `allow-git=all` — install-time trust in GitHub git deps (intentional, supply-chain). | `.npmrc` |

## Controls that hold (do not regress)

- Desktop HTTP defaults to `127.0.0.1`; `isLoopbackRequest` uses **socket** `remoteAddress`, not `X-Forwarded-For`.
- `SC_MODE=server` always requires a session for **writes** (including Caddy→loopback). Public probe: chat/mission POSTs returned 401.
- `shareLogsGlobal` / `sharePlaytimes` default **off**.
- Discord token/webhook stay in env or `stores/…/discord.secrets.json`, not the Fabric Store; runtime summary is boolean flags, not secrets.
- Electron: `nodeIntegration: false`, `contextIsolation: true`, `webSecurity: true`; preload is a narrow `contextBridge`.
- Android CORS allowlist: localhost / 127.0.0.1 / `capacitor://` only.
- Feed log highlighter `esc()`s before `<mark>` (no HTML injection from Game.log).
- Chat bodies render as React text nodes (no `dangerouslySetInnerHTML` in `Chat.js`).
- Hub login/device-link complete only against an allowlisted origin.
- `bitcoinRuntimeForSettings` does not echo the admin token to GET `/settings`.
- Game.log is read-only. Files `filePath` ingest is repo-jailed (security-review).
- `GET /monitor`, `/feed`, `/search`, `/collections` require auth in server mode.

## Open PRs / branches (this environment)

GitHub `gh api` returned **Forbidden**, so live PR bodies were not fetched. From tree + remotes:

- **Upstream [PR #7](https://github.com/GoonCitizen/star-citizen-live/pull/7)** — WIP Android, `feature/rsi` → `master`. SECURITY.md: no review comments / no CI on the branch. Do not merge to `master`.
- Historical PR #6 closed (overlay/replay).
- Local: `feature/rsi` (HEAD), `feature/discord` (ahead 2), `feature/fabric-0.1.0` (ahead 3), `master` (ahead 25 of `origin/master`).
- Uncommitted on `feature/rsi` includes profile notes (`functions/profileNotes.js`), identity-note UI, `groupDataSync`, Chat/ProfilePage — **in scope** of H1 and M5.

## Priority

1. **Before any public dashboard claim:** fix H1–H3 (notes, local-groups, Discord link). Treat missing session as anonymous, never as `_identity`.
2. **Production host:** rebind RSI HTTP to loopback behind Caddy/Nginx (H6); confirm `SC_MODE=server`.
3. Auth-gate remaining server GETs (H5, M4, M5) and pin/documents/fs/snapshots (H4, H7, M1, M2).
4. Default `shareDiscordCatalog` **off**; stop putting local tag names in `/lookup` replies (M3, M6).
5. Untrack `settings/local.js`; keep Hub admin token off this app unless sending is required; do not stage that file.
6. Session revoke + shorter TTL; mesh flood limits; DirectChat E2E (already on OUTSTANDING).

## References

- `docs/THREAT-MODEL.md`, `SECURITY.md`, `docs/OUTSTANDING.md`, `docs/PRODUCTION.md`
- `reports/adversary-public-probe.json`, `reports/adversary-local-probe.json`
- Security-review subagent on branch changes (notes GET / fs / documents / pin / Discord gossip)
