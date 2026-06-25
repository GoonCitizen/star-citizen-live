# HANDOFF — Lead dev, start here

> **Status:** Core feature set is complete and green; handed to the lead dev to
> integrate the **communication/transport layer**. The codebase is deliberately
> shaped so that layer is a **transport swap, not a rewrite** (see §3).
> **Direction for this phase (owner, 2026-06-24):** lean **Fabric / federated**
> (D-004) as the target transport; the central VPS (D-005/M4) is an optional
> bridge, not a requirement.
> **Read order:** this file → `DESIGN-event-convergence.md` → `DESIGN-distributed.md`
> → `DECISIONS.md` (D-002, D-004, D-005). Canonical project context: `AGENTS.md`.

---

## 1. What's done (the core that's being handed over)

A zero-runtime-dependency Node service (Node built-ins only) that turns the SC
`Game.log` into a live feed + analytics + an officer-validated mission register.

- **Read-only live log relay** with auto-detect of install/channel and offline
  replay; survives the game rotating/recreating `Game.log`.
- **Rule-based parser** (`app/parser.js`): logins, sessions/build/hardware,
  missions + objectives, notifications, player-down (incap), a combat-progress
  proxy, and current-build (4.8.0) `player:death` + `mission:start`/`mission:end`.
- **Activity-analytics dashboard** (Analyze tab) + **player log backload**
  (`npm run backfill` → compact, gitignored `stores/history.json`).
- **Mission register (M5)** — full lifecycle (open → apply → accept → claim →
  officer-validate → completed/reject), officer allowlist, and a **hash-chained,
  tamper-evident audit log** (`services/MissionManager.js`, `verifyAudit()`).
- **Live dashboard + REST API + optional Discord webhook.**

**Quality gate:** `npm test` → **57 tests pass**, zero runtime deps. All prior
feature branches (`death-and-mission-lifecycle`, `faction-dimension`,
`analyze-multiselect`) are folded into this trunk.

**Honesty note (do not regress — `AGENTS.md` §10):** kill / vehicle-destruction
parsing is **format-verified on real ≤4.3.0 logs only**; CIG removed that logging
after 4.3.0, so the 💀 panel is **dormant on the current build**. Label
**validated** (officer/real-log) vs **inferred** (proxy) everywhere.

---

## 2. Run it

```bash
npm start                          # http://localhost:3041/  (dashboard)
npm test                           # node --test test/*.test.js  (57 pass)
npm run replay /path/to/Game.log   # offline parser tally — fastest dev loop
npm run backfill                   # ingest saved logs → stores/history.json
npm run start:fabric               # DEPRECATED legacy Fabric entry (reference only)
```

---

## 3. The integration seam — Fabric is a transport swap, not a rewrite

The current service was built with the **same event interface the original Fabric
`Hub` exposed**, so re-attaching a transport is mechanical.

| | Current (runs) | Legacy Fabric (reference, not run) |
|---|---|---|
| Base class | `class StarCitizenService extends EventEmitter` — `app/server.js:39` | `class StarCitizen extends Hub` — `services/StarCitizen.js:32` |
| Events emitted | `activity`, `event`, `kill`, `player:death`, `player:incap`, `vehicle:destroy`, `mission:event` (`mission:start`/`mission:end`), `notification`, `player:join`, `player:login`, `session:start`, `combat:progress`, `ready`, `stopped` | **the same names** (`activity`, `kill`, `player:join`, `mission:created`…) — `services/StarCitizen.js:168-206, 440-548` |
| Event envelope | `{ type:'StarCitizenLogEntry', id, kind, timestamp, object:{id,content}, target }` — `app/server.js:326` (already ActivityStreams / Fabric Actor-Entity shaped) | Fabric `Actor` / `Entity` |
| Identity | content-address `idFor(content) = sha256(content).slice(0,32)` — `app/server.js:35` | content-addressed Actor ids |
| Remote intake | `POST …/{activities,players,vehicles,kills}` → re-emits events — `app/server.js:~245-254` | `Hub` gossip |
| Signing groundwork | `types/Mission.js` (secp256k1 / musig2) — reserved for M6 | same crypto |

**To attach Fabric (the L1-federated target, D-004):**

1. Swap the base: `extends EventEmitter` → `extends Hub` (or compose a `Hub`
   alongside the service and forward events to it).
2. For each emitted event, wrap it as a **signed Fabric `Entity`** and **gossip**
   it via the Hub instead of (or in addition to) POSTing. The envelope is already
   Entity-shaped — `app/server.js:326`.
3. Per `DESIGN-event-convergence.md` §7: add **`source`** (relay node id — a
   pubkey) and **`actor`** (player handle) to the envelope, and extend `idFor()`
   so the canonical id includes `source` → re-delivery is an **idempotent upsert**
   (automatic dedup across N relays).
4. Inbound gossip feeds the **same upsert path** the `POST` seam already uses, so
   the existing analytics fold (`stores/history.json`, `GET …/analytics`) works
   **unchanged**.

> Everything downstream of the merge point — dedup, group-by-`mission_id`,
> analytics fold, dashboard — is **identical regardless of transport**. Transport
> only changes the left edge of the flow (`DESIGN-event-convergence.md` §6).

---

## 4. Stripping the VPS (Fabric-first)

The two data planes are **separable** (`DESIGN-event-convergence.md` §2):

- **Event firehose** (deaths/missions/sessions → analytics): append-only,
  eventually consistent, **union-merged**. Transport-agnostic — replace VPS-POST
  with Fabric gossip and the fold is untouched. **This can go Fabric-first today.**
- **Mission register** (officer-validated, audited): strongly consistent, single
  source of truth (D-005). Today it lives in one process. **This is the one piece
  that blocks full VPS removal.**

**The decision Fabric-first forces:** give the register a federated home. Two
options, both already scaffolded —
1. **Elected/primary node** holds the authoritative register; others replicate its
   signed audit chain (smallest change).
2. **Fold in `types/Mission.js` multisig signing (M6)** so officer validations are
   signed Entities that any node can verify — the register becomes a signed,
   replicable log with no privileged host. This is the D-004 end-state.

Until one of those lands, keep a single node (it need not be a paid VPS — any
always-on org machine) as the register's home while the firehose federates.

---

## 5. Open seams (ordered — what's NOT done)

1. **Source identity + idempotent upsert** — the §3 first step. Small, high-leverage,
   de-risks everything else (`DESIGN-event-convergence.md` §7). **Do this first.**
2. **Fabric transport re-attach** — swap `EventEmitter` → `Hub`, gossip signed
   Entities (§3). Legacy `services/StarCitizen.js` is the reference for the Hub wiring.
3. **Signed audit / multisig (M6)** — fold `types/Mission.js` into `MissionManager`
   so the register can federate (§4).
4. **Persistence** — `app/store.js` is swappable for `node:sqlite` at deploy.
5. **Discord bot (M5.3)** — two-way slash commands + identity (officer = Discord
   role); `scripts/discord-role-check.js` is groundwork. Today it's webhook-only.
6. **Packaging** — Node SEA `.exe` (Windows) + Linux relay (Proton/Wine log
   detection — `app/locate.js` is Windows-only today) + systemd.

---

## 6. Guardrails (binding — `AGENTS.md` §6/§10)

- **Zero runtime dependencies.** Node built-ins only; tests use the built-in runner.
  The whole point of the Fabric removal (D-002) was a near-zero footprint — Fabric
  re-attach should stay an **optional module**, not a hard dep of the core relay.
- **The log is read-only, always.** Never write to the SC install.
- **Parser honesty** — `verified:true` only with a real matching `Game.log` line,
  qualified by game version. Don't invent log formats.
- **The register is the source of truth, not the log** (D-005). The firehose is
  *attributable*, not *trusted* — signing proves authorship, not gameplay truth
  (the honest D-004 limit).
- **Secrets via env only.** Never commit a webhook/token.
- **Owner controls development** (D-006) — propose via branches/PRs/docs.

---

## 7. Doc map

| Doc | What |
|---|---|
| `AGENTS.md` / `CLAUDE.md` | Canonical project context (start here for the full picture). |
| `DESIGN-event-convergence.md` | **The transport-agnostic merge model — read this next.** |
| `DESIGN-distributed.md` | Federation / decentralization design (the Fabric-first target). |
| `DECISIONS.md` | ADRs — D-002 (Fabric out), D-004 (federate first), D-005 (central + officer-validated). |
| `DESIGN-missions-mvp.md` | Mission register (M5) technical design. |
| `PROGRESS.md` | Milestone + retro trail (newest first). |
| `REVIEW.md` | Async AI-collaboration / review log. |
