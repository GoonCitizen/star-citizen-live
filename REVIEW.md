# Project Review & AI Collaboration Log
Shared, async channel between the **product owner (Neorion)**, **Claude Code**, and
**OpenAI Codex**. Read `AGENTS.md` §10 first — it defines the rules. **The owner
controls all development; agents propose only and never merge to `main`.**

How to use this file: an agent adds its findings/replies under the right heading,
commits on a branch, opens a PR. The next agent reads on pull and responds here.
The owner records the decision in **§ Owner decisions** — that is the only section
that authorises work.

---

## Cursor / agent findings (2026-08-14) — Public relay operator cut
**Branch:** `feature/rsi` · **Scope:** `docs/PRODUCTION.md` + `SC_MODE=server` Fabric Peer.

Public `relay.goon.vc` cannot be HTTP-only: it is a default Fabric seed. Caddy →
loopback also cannot use the desktop unlocked-identity write path. This cut keeps
Peer on in server mode (`SC_FABRIC=0` to disable), seeds hubs minus self, binds
HTTP loopback from `scripts/node.js`, and documents nvm 24.15 + pm2. `/settings`
and `/peers` HTTP remain 404 in server mode (existing test). Operators configure
via env + Store.

---

## Cursor / agent findings (2026-08-13) — Adversarial local network pressure

**Branch:** `feature/rsi` · **Scope:** local-only (desktop `*:3041` / Fabric `*:7778`,
loopback hub `127.0.0.1:7777`). Did **not** flood public hubs. Probe script:
`scripts/adversary-local-probe.js` → `reports/adversary-local-probe.json`.

### Verdict
With **`httpSharedMode: true`**, the desktop LiveRelay is an **open LAN control
plane** for the unlocked operator identity. Browser UI correctly locks compose
(“Unlock your identity”), but **raw HTTP does not** — LAN clients speak *as*
WATCHMAN. Separately, ephemeral Fabric peers dialing the local mesh delivered
**15 adversary global chat floods** into the desktop Chat tab (authors
`359351ea…` / `89521063…` / `106506e6…`).

### Evidence

| Finding | Severity | Notes |
|---------|----------|--------|
| `POST …/chat/messages` no auth → attributed to unlocked identity (`WATCHMAN` / `dc6142cd…`) | **blocker** (when shared bind) | UI disabled in browser; API still posts |
| Same path posts into `group:<id>` without membership (`enforceMembership` only in `server` mode) | important | Bodies stored as WATCHMAN |
| `POST …/missions` creates open register missions (`createdBy: null`, bootstrap officers) | important | Left 3 `adv-*` open missions on the node |
| Unauth `GET /settings`, groups, discord guilds, peers, missions, presence | important | Peer roster + Discord botReady leaked |
| 3 LiveRelay adversaries on `18000–18002` → global chat on desktop | important (mesh) | `listPeers` showed `connected=0` but floods still landed (likely via `127.0.0.1:7777` faucet/relay) |
| Browser Chat compose locked without unlock | ok | Does **not** protect the shared HTTP API |

### Threat-model gap
`docs/THREAT-MODEL.md` already says LAN bind is opt-in. It does **not** spell out
that shared HTTP + unlocked identity = **impersonation of the operator** for chat,
group channels, and mission create (local/bootstrap officer mode). Proposed
follow-ups (owner decide):
1. When `httpSharedMode`, require Schnorr envelope (or Bearer) for mutating routes —
   same as `serverMode`.
2. Banner / Settings warning: “LAN clients act as your unlocked identity.”
3. Rate-limit inbound mesh global chat / drop anonymous floods without alias.
4. Cancel or quarantine probe missions `mission-msr0qh5e-1`, `mission-msr0rgqt-2`,
   `mission-msr0rnlq-3` on the desktop register.

### What we did
- Spun 3 adversarial LiveRelay peers + HTTP pressure script (untracked/tooling).
- Navigated dashboard Chat / Missions / Network in the IDE browser; confirmed
  adversary pubkey floods visible in Global (131 messages).

---

## Cursor / agent findings (2026-08-13) — AGENTS release-readiness evaluation

**Branch:** `feature/rsi` · **Context:** how to update AGENTS docs to push toward a
release without inventing a ship cut.

### Verdict
Multi-repo “Release posture” campaigns are **secondary**. The release risk here is
**stale AGENTS halves** that contradict the live tree and misdirect agents.

### Evidence (important)
| Claim in old AGENTS | Reality on `feature/rsi` | Severity |
|---------------------|--------------------------|----------|
| §4: `app/server.js` is what runs / package `main` | **`app/` does not exist**; `main` → `main.js`; `npm start` → `scripts/node.js` → `LiveRelay.js` | blocker (docs) |
| §10: “Fabric was removed” | Conflicts with §2 / D-009 / D-010 (Peer uplink is live) | important |
| §4: `scripts/node.js` listed as legacy | It is the **CLI entry** | important |
| Header: last reviewed `feature/fabric-free-m1` · 2026-07-24 | Current work is **`feature/rsi`** | important |
| §5: “55 tests”; M4/M5.3/M6 as “next” | Test layout is multi-suite; Discord bot + desktop packaging already exist in some form — milestone list was fossil | nice |
| June-2026 review below asks Codex to review `app/` | Historical; must not be treated as active work order | important |

### What we did (low-hanging fruit — docs only)
- Surgically repaired **`AGENTS.md`**: header + Release posture, replaced §4,
  softened §5/§6/§8, fixed §10 ground truths, demoted this file’s June request
  from “active.”
- Logged a short entry in **`PROGRESS.md`**.
- Hub / core / fabric-http AGENTS rewrites **deferred** (those repos already point
  at `docs/PRODUCTION*.md` / `npm run ci`).

### Still needs owner (proposal only)
- Name the **release cut** (desktop installer vs `relay.goon.vc` vs both) so
  AGENTS can list real blockers instead of “TBD.”
- Optionally refresh `CONTINUE.md` / older `PROGRESS.md` M1 framing later.

---

## Branch ready for review (2026-06-19) — HISTORICAL

> **Status:** historical. Branch **`feature/death-and-mission-lifecycle`** / trunk
> **`feature/fabric-free-m1`** and the `app/` paths below are **not** the current
> `feature/rsi` work order. Kept for the collaboration trail.

Branch **`feature/death-and-mission-lifecycle`** is ready for an independent pass,
proposed for merge into the fork trunk **`feature/fabric-free-m1`** (there is no
`main` on the remote). 5 commits, ~+900 lines, zero new runtime deps, 55 tests green.

Scope of the change set (all current-build, SC 4.8.0):
- **Parser** — `player:death` (corpse `body_01_noMagicPocket` marker), `mission:start`
  (`MissionStartCommsNotification`), `mission:end` (`EndMission` CompletionType).
- **Service/REST** — `deaths` collection, mission lifecycle on `…/missiongroups`,
  `…/analytics` (merged history+live), `missionStats`.
- **Dashboard** — Live/Analyze tabs; KPI strip, activity heatmap, outcome donut,
  type bars, pilot leaderboard, pilot comparison; month/year add-remove slicer.
- **Backfill** — `scripts/backfill.js` (`npm run backfill`) → compact gitignored
  `stores/history.json` (1,525 logs ingested; 3 pilots; 10 months).

Specific things worth a skeptical look: the death-marker dedupe (one event per
corpse burst), `_analyticsDataset()` payload size/caps, month-vs-UTC boundary in
the time slicer, and per-pilot attribution when a log has no login handle.

---

## Requested review (for OpenAI Codex) — HISTORICAL (2026-06-19)

> **Do not execute as current scope.** Paths like `app/server.js` / `app/locate.js`
> no longer exist on `feature/rsi`. Re-open only if the owner asks.

Please perform an **independent project review** and write findings under
*§ Codex findings*. Scope:

1. **Architecture & code** — `app/` (server, parser, locate, store), `services/`,
   `types/`. Soundness, simplicity, bugs, dead code, test coverage gaps. The repo is
   intentionally zero-runtime-dependency Node built-ins — flag anything that breaks that.
2. **Log-parsing claims** — sanity-check the combat/mission findings against the code
   and `PROGRESS.md`. (Note the **ground truths** in `AGENTS.md` §10 — kills removed
   after 4.3.0, etc. — challenge them only with new evidence, don't re-assume.)
3. **Mission register (M5)** — `services/MissionManager.js`, the REST API in
   `app/server.js`, and `DESIGN-missions-mvp.md`. Lifecycle correctness, the
   officer-validation/audit model, security of the endpoints.
4. **Security & secrets** — handling of tokens/webhooks; the `settings/local.js` /
   `auth.txt` tracked-secret footgun; the Discord bot-token guidance.
5. **Roadmap realism & honesty** — are claims in the briefs labelled correctly
   (validated vs inferred)? Anything overstated for stakeholders?
6. **Packaging plan** — `app/locate.js` Windows-only TODO; the cross-platform
   (Windows `.exe` + Linux) plan in the briefs.

For each finding give: **file:line**, **severity** (blocker / important / nice),
**what & why**, and a **suggested** change — *as a proposal*, not an applied edit.

---

## Codex findings
_(Codex: add dated entries here. One finding per bullet, with file:line + severity.)_

> _none yet_

## Claude / Cursor responses
_(Respond to specific findings here, agree/disagree with reasons, cite files.)_

> **2026-08-14 — GoonCitizen shared-mode writes + pin bump:** No open GitHub PR
> for this RSI cut ([PR #6](https://github.com/GoonCitizen/star-citizen-live/pull/6)
> closed; public review comments empty). In-repo REVIEW 2026-08-13 blocker #1
> implemented for **writes**: `shouldEnforceRemoteAuth` (server mode, or
> `httpSharedMode` from a non-loopback peer). Loopback still uses the unlocked
> identity. GET leaks and mesh flood rate-limits left open. Pins: core
> `39bfbcb7b` / http `17abf49` / hub `c4efe57` / discord `f8708e27`.

> **2026-08-13 — AGENTS fossil evaluation:** Confirmed `app/` absent on
> `feature/rsi`; applied surgical `AGENTS.md` repair (Release posture, §4–§6, §8,
> §10). Hub/core multi-repo AGENTS rewrites deferred. Owner still needed for the
> release cut. See § “Cursor / agent findings” above.

> **2026-08-12 — [PR #6](https://github.com/GoonCitizen/star-citizen-live/pull/6) (`feature/rsi`):** GitHub conversation still has **no review comments** (author note only; Reviews empty). Re-ran `npm run report:install` with core/http/hub/**discord** on `feature/rsi`, then re-pinned (`2e2aec81…` / `365f0b49…` / `e9e8630…` / discord `8b269fb…`). Discord now exports `normalizeDiscordSettings` — dropped SCL try/catch fallback (local file is a thin re-export). Bumped `screenshot-desktop` to `1.15.4` (clears critical GHSA). Remaining: PR split, DirectChat E2E / seal v1 drop, session revoke, transitive undici/serialize-javascript. Re-check after Bugbot/CodeRabbit if they post later.

## Owner decisions / approved actions
_(Neorion: the ONLY section that authorises work. Mark each item: approved / declined /
deferred, and which agent should action it.)_

> _none yet_ — **pending:** name release cut (desktop / relay.goon.vc / both) so
> AGENTS can list concrete ship blockers.
