# AGENTS.md — Project context for AI coding assistants

> **This is the canonical, tool-agnostic context file for this repo.** It is the
> single source of truth for AI coding tools. OpenAI's tooling (Codex) reads
> `AGENTS.md`; Claude Code reads `CLAUDE.md`, which simply imports this file. Keep
> project context **here** so the two never drift. (`PROJECT_CONTEXT.md` is a
> legacy pointer to this file as well.)
>
> **Last reviewed against source:** branch `feature/fabric-free-m1` · 2026-06-15.
> If you change architecture, commands, or state, update **this file** and the
> reality it describes — not a copy.

---

## 1. What this project is

A **Node.js service that watches the Star Citizen `Game.log` file (read-only) and
relays gameplay** — logins, missions/objectives, combat-progress, and (on older
game builds) kills — to a **live web dashboard**, an optional **Discord webhook**,
and a small **REST API**. On top of the relay sits an **officer-validated mission
register**: officers post missions/fleet actions (in-game *or* out-of-game),
members apply and do the work, and an officer validates completion. Every register
mutation is recorded in a **hash-chained, tamper-evident audit log**.

The relay also powers an **activity-analytics dashboard** (missions, outcomes,
deaths, sessions and an activity heatmap, sliced by pilot / mission type / month &
year) and lets players **backload their saved logs** (`npm run backfill` over the
game's `logbackups`) so the org can see real history, not just the live session.

**One-line summary:** turn the live game log into a Discord/dashboard/API feed,
analyse activity (incl. backloaded history), and run an officer-validated mission
register with an auditable trail on top.

**Core goals (do not regress — see `DECISIONS.md` D-005, D-007):** (1) the officer-
validated mission register with an auditable trail; (2) the activity-analytics
dashboard; (3) player log backload into shared history. New work must protect these.

**Product context for non-technical readers:** `SOLUTION-BRIEF.md`.

### Important reality check (read before touching the parser)
- **Kills are NOT logged in the current game (SC 4.8.0).** CIG removed
  `<Actor Death> CActor::Kill` / `<Vehicle Destruction>` logging after **4.3.0**.
  The kill parser + 💀 dashboard panel + Discord wiring all exist and are
  **format-verified against real ≤4.3.0 logs** (417 real kills), but they only
  fire on historical logs — **not live on 4.8.0**. See `PROGRESS.md` (top entry)
  and the `sc-log-combat-vs-missions` memory.
- What the current log *does* give richly: **missions, objectives, notifications,
  player logins, sessions/builds, and an "Incapacitated:" (player-down) signal.**
  Combat is surfaced indirectly as a **combat-progress proxy** inferred from
  mission objective text (clearly labelled as a proxy, not exact kills).

---

## 2. Origin, attribution & license

- **Forked from:** `martindale/star-citizen-live`, branch `feature/fabric-0.1.0`
  (upstream `GoonCitizen/star-citizen-live`). Package: `@rsi/star-citizen`.
- **License:** **MIT** — keep the original copyright/license notice in files.
- **This fork's direction:** the original was a **Fabric** (decentralized/p2p)
  service. We **removed Fabric** (see `DECISIONS.md` → D-002) and rebuilt the core
  as a standard, zero-dependency Node service. The original Fabric code is kept for
  reference (see §4) but is **not** what runs.

---

## 3. Build / run / test commands

Requires **Node.js LTS** (uses the built-in test runner + global `fetch`, so
Node 18+). **No `npm install` step is needed** — the running service has **zero
runtime dependencies** (only Node built-ins: `http`, `crypto`, `events`, `fs`,
`readline`).

```bash
npm start        # run the service  -> http://localhost:3041/  (dashboard)
                 #                      http://localhost:3041/services/star-citizen  (status JSON)
npm test         # run the test suite (Node built-in runner: node --test test/*.test.js)
npm run replay /path/to/Game.log   # replay a saved log and tally detected events
```

- `npm start` → `node app/server.js`. It **auto-detects** the SC install across
  drive roots and channels (LIVE/PTU/EPTU/HOTFIX/TECH-PREVIEW) and tails the
  freshest `Game.log` (the one you're actually playing). It is **read-only** — it
  never edits the game install.
- `npm run replay <path>` → `node scripts/replay.js` — offline; the fastest way to
  test the parser without being in-game.
- `npm run start:fabric` → **deprecated** original Fabric entry (`scripts/node.js`),
  kept only for reference.

### Environment variables (config; secrets via env only)
| Var | Purpose |
|-----|---------|
| `SC_LOGFILE` | Force an exact `Game.log` path (highest priority). |
| `SC_CHANNEL` | Force a channel, e.g. `HOTFIX` (when auto-detect ties). |
| `SC_SEED` | Pre-fill the monitor from a different log on start. |
| `DISCORD_WEBHOOK_URL` | Enable Discord posting (optional). |
| `SC_OFFICERS` | Comma-separated officer allowlist for the mission register. |
| `SC_REGISTER_DIR` | Persist the mission register to disk (default: in-memory). |

Settings can also come from `settings/local.js` (copy `settings/example.js`).
**Never commit secrets** — `settings/local.js`, `settings/auth.txt`, and `.env`
are gitignored. See §7.

---

## 4. Project structure

### Active code (the Fabric-free service — this is what runs)
| Path | Role |
|------|------|
| `app/server.js` (~530 lines) | The service. EventEmitter-based; in-memory collections, REST + dashboard, read-only log poller + offline `replayLog()`, Discord webhook, mission-register seam. **Main entry** (`package.json` `main`). |
| `app/parser.js` (~230 lines) | Rule-based SC 4.x `Game.log` parser. Each rule is `VERIFIED` or `UNVERIFIED` (see §6). Also exports `shipName`, `parseSessionInfo`, `missionType`, `isNPC`. |
| `app/locate.js` | `resolveLogFile()` — auto-detects install/channel by scanning drives × known sub-paths × channels, picks the freshest log. **Windows-only today** (Proton/Wine detection is a TODO for the Linux relay). |
| `app/store.js` | Tiny keyed-collection store; in-memory by default, optional file persistence. Zero deps; swappable for `node:sqlite` at deploy. |
| `app/ui.html` | The live dashboard (served at `/`). |
| `services/MissionManager.js` | The **real** officer-validated mission register (M5): full lifecycle + officer allowlist + hash-chained audit (`verifyAudit()`). Backed by `app/store.js`. |
| `types/Mission.js` | Mission data model with `secp256k1`/`musig2` multisig signing — **reserved for M6** (signed audit); not on the current path. |
| `scripts/replay.js` | `npm run replay` entry. |
| `scripts/discord-role-check.js` | Discord Officer-role check tool (M5.3 groundwork). |
| `constants.js` | Brand/name constants. |
| `settings/example.js` | Config template → copy to `settings/local.js` (gitignored). |
| `test/*.test.js` | Test suite (Node built-in runner): `api`, `corpus`, `locate`, `missions`, `parser`, `service`. `test/fixtures/sample-combat.log` is a committed sample. |

### Legacy / reference only (the original Fabric code — NOT run)
`services/StarCitizen.js` (~805 lines, extends Fabric `Hub`), `types/StarCitizenAPI.js`,
`components/Interface.js`, `scripts/node.js`, `tests/rsi.stream.js` (mocha).
Kept during migration; safe to ignore unless explicitly working on migration.

### REST API (base path: `/services/star-citizen`)
- `GET /` — live dashboard (HTML). `GET /services/star-citizen` — status summary.
- `GET …/monitor` — snapshot for the dashboard (counts, recent, flagged, kills, missions).
- `GET …/missiongroups` — missions grouped by MissionId (objectives nested).
- `GET …/combat` — combat-progress proxy (inferred from objectives).
- Collections `GET …/<name>` for: `activities`, `players`, `logins`, `vehicles`,
  `kills`, `incaps`, `missionlog`, `notifications`, `messages`. `POST` is accepted
  on `activities`, `players`, `vehicles`, `kills` (for future remote relays).
- **Mission register:** `GET|POST …/missions`, `GET …/missions/:id`,
  `GET …/missions/:id/applications`, `POST …/missions/:id/{apply,claim,cancel}`,
  `POST …/applications/:id/decision`, `POST …/claims/:id/validate`, and read lists
  `GET …/{applications,claims,validations,audit}`. Errors map to **403** (officer
  forbidden), **404** (not found), else **400**.

> ⚠️ `API.md` is **stale** auto-generated JSDoc for the *legacy Fabric* classes.
> The list above (from `app/server.js`) is the real API.

---

## 5. Current state — what works vs. what's next

**Built and tested (55 tests pass):**
- Read-only live log monitoring with **auto-detect** of install/channel, plus
  **offline replay**. Survives the game rotating/recreating `Game.log`
  (session tracking).
- Rule-based parser: logins, sessions/build/hardware, level/mode loads, missions,
  objectives, notifications (HUD vs. mission split), mission-type classification,
  player-down (incapacitation) detection, and a combat-progress proxy.
- **Current-build (4.8.0) death + mission lifecycle:** `player:death` (corpse
  `body_01_noMagicPocket` marker), `mission:start` and `mission:end`
  (CompletionType: Complete/Abandon/Fail/Deactivate). Kills are still parsed but
  dormant on the current game (only ≤4.3.0 logged them — §1).
- **Activity-analytics dashboard** (Analyze tab): KPI strip, activity heatmap,
  outcome donut, mission-type bars, pilot leaderboard, pilot comparison; **month/
  year add-remove slicer**; served by `GET …/analytics`.
- **Player log backload:** `npm run backfill` (`scripts/backfill.js`) ingests saved
  logs into a compact, gitignored `stores/history.json` (per-pilot, attributed by
  login handle); merged with the live session in the analytics view.
- Kill / vehicle-destruction parsing — **format-verified on real ≤4.3.0 logs**,
  wired to the dashboard 💀 panel + Discord, but dormant on the current game (§1).
- Live dashboard + REST API + optional Discord webhook embeds.
- **Mission register (M5):** full lifecycle (open → apply → accept → claim →
  officer validate → completed | reject/cancel), officer allowlist, and a
  hash-chained tamper-evident audit log, exposed over REST.

**Next milestones (see `PROGRESS.md` → "Up next" and `DECISIONS.md` → D-005):**
- **M4** — deploy the central service to a small VPS (+ persistence; `node:sqlite`).
- **M5.3** — Discord **bot** (slash commands + Scheduled-Events hook) for two-way
  commands and identity (officer = a Discord role).
- **M6** — signed audit trail (fold in `types/Mission.js` multisig).
- **Packaging** — one-click relay installers for Windows (Node SEA `.exe`) and
  Linux (incl. Proton/Wine log detection + systemd for the server).

---

## 6. Conventions

- **Style:** CommonJS (`require`/`module.exports`), `'use strict'`, 2-space indent,
  semicolons, single quotes. Match the surrounding file.
- **Zero runtime deps.** Do not add an npm dependency to the running service
  without a strong reason — the whole point of the Fabric removal (D-002) was a
  near-zero, install-free footprint. Tests use the **built-in** runner, not mocha.
- **The log is read-only, always.** Never write to or modify the SC install.
- **Parser honesty — `verified` flag:** every parser rule is tagged `verified:true`
  (confirmed against a real `Game.log`) or `verified:false` (built from
  documented/community format, not yet confirmed). **Do not flip a rule to
  `verified:true` without a real matching log line.** "Verified on real data" must
  be qualified by **game version** (a rule can be verified on 4.3.0 yet not fire on
  4.8.0). Don't invent log formats — feed real `Game.log` lines.
- **Tests alongside code.** Add/extend a `test/*.test.js` for parser rules and
  routes; keep the suite green (`npm test`).
- **The mission register is the source of truth, not the log.** The log relay is
  *supporting evidence* only — a human officer validates completion (D-005).

---

## 7. Secrets handling

No live webhook/token is committed. Provide secrets via **environment variables**
(or a gitignored `settings/local.js` / `.env`). `.gitignore` already covers
`settings/local.js`, `settings/auth.txt`, `.env`, `node_modules/`, `stores/`,
`reports/`, and `*.log` (so a personal `Game.log` dropped in the folder is never
committed; `test/fixtures/*.log` is the one allow-listed exception). **Never paste a
Discord webhook into a tracked file.**

---

## 8. Documentation map (where the rest of the context lives)

| Doc | What it is |
|-----|------------|
| `AGENTS.md` (this file) / `CLAUDE.md` | Canonical AI-assistant context (CLAUDE.md imports this). |
| `CONTINUE.md` | Quick-start: how to run/replay right now; common commands. |
| `PROGRESS.md` | Milestone + retrospective trail (newest first). The live status log. |
| `DECISIONS.md` | ADRs — the *why* (D-001…D-005: Fabric removal, VPS, federation, register). |
| `SOLUTION-BRIEF.md` | Plain-English product brief for org leadership. |
| `DESIGN-missions-mvp.md` | Technical design for the mission register (M5). |
| `DESIGN-distributed.md` | Design-only: optional federated/decentralized future (D-004). |
| `DESIGN-event-convergence.md` | How to merge many players' event streams into one org-wide view (transport-agnostic; for M4 + future Fabric). |
| `REFERENCES.md` | Catalog of reusable SC open-source projects + log-format findings. |
| `BACKLOG.md` | Idea backlog. |
| `SPIKE-LOG-tier0-boot.md` | The spike that proved Fabric was too heavy. |
| `MOBILE-SETUP.md` | Mobile/remote access notes. |
| `START-HERE-claude-code.md` | Beginner walkthrough for running this in Claude Code. |
| `README.md` | Public-facing readme (fabric-free). |
| `API.md` | ⚠️ Stale legacy-Fabric JSDoc — see the real API in §4. |
| `CHANGELOG.md` | Keep-a-changelog file; see `PROGRESS.md` for the real milestone trail. |

When picking up work, read **CONTINUE.md → PROGRESS.md → DECISIONS.md** first.

---

## 9. Working across Claude Code and OpenAI Codex (tool-agnostic)

This repo is set up so work can move freely between AI coding tools:
- **`AGENTS.md`** (this file) is the canonical context — Codex and other
  AGENTS-aware tools read it automatically.
- **`CLAUDE.md`** imports this file (`@AGENTS.md`), so Claude Code gets the exact
  same context with no duplication.
- **`PROJECT_CONTEXT.md`** is a thin pointer to this file for humans/tools that
  look for it.

**Rule for any tool:** put durable project context in **`AGENTS.md`** only. Do not
fork context into `CLAUDE.md`/`PROJECT_CONTEXT.md` — they intentionally just point
here, so the three can never disagree.

---

## 10. AI collaboration & the human-control model (READ FIRST if you are an AI agent)

This repo is worked by **multiple AI tools** (Claude Code, OpenAI Codex) under one
human product owner (**Neorion**). The rules below are binding for any AI agent.

**Control stays with the product owner. Always.**
- The owner decides **what gets developed**. AI agents are **advisors and
  reviewers** — they **propose**, they do not decide.
- **Do NOT merge to `main`.** Do not build features, refactor broadly, or change
  behaviour **without the owner's explicit go-ahead** in that thread.
- Surface work as **branches + pull requests + committed docs** for the owner to
  review and approve. Small, reversible, well-described changes.
- A review or suggestion is **advisory**, not authorisation to implement it.

**How Claude Code and Codex collaborate (async, via GitHub):**
- The shared channel is **`REVIEW.md`** (committed markdown) and **PR comments** —
  not a live connection. One agent writes findings; the other reads on next pull
  and responds in the same doc; the owner records decisions there.
- Keep the exchange factual and cite files/lines. Don't re-litigate settled
  decisions — check `DECISIONS.md` (D-001…D-006) and `PROGRESS.md` first.

**Ground truths — do not "rediscover" or contradict without new evidence:**
- Fabric was removed on purpose (D-002); the design is **centralised + officer-
  validated** (D-005), with federation only as an optional later path (D-004).
- **Kill logging:** present only in SC **≤ 4.3.0**; CIG removed it after 4.3.0 —
  **not in the current game (4.8.0)**. Verified across 3 players' logs. The kill
  rules parse *historical* logs only. (See `PROGRESS.md` / the combat memory.)
- **Honesty rule:** label **validated** (officer/real-log) vs **inferred**
  (telemetry/proxy); never overclaim. Qualify "verified on real data" by game
  version. Secrets via env only (bot token, never a user token); never commit them.
- Zero runtime deps; Node built-ins; tests run with `node --test test/*.test.js`.

**Working practice — sub-agents for big batches:** for heavy read/analysis work
(large `Game.log` corpora under `Gamelogs/`, broad multi-repo research), delegate
to a **sub-agent** (its own context window) that returns a **summary**, rather than
reading gigabytes into the main thread. Adopted as the default for big batches.

**Active request:** see `REVIEW.md` for the current project-review scope and the
collaboration log.
