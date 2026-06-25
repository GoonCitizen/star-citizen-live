# Decisions Log (ADRs)

Plain-English record of the *why* behind key choices, so anyone joining later
understands the direction. Newest at the top.

---

## D-007 — Analytics dashboard + player log backload are adopted project goals
**Date:** 2026-06-19 · **Status:** Adopted

**Decision:** Two capabilities are now first-class project goals, alongside the
officer-validated mission register (D-005):
1. **Activity analytics** — an Analyze dashboard over real gameplay data (missions,
   outcomes, deaths, sessions, activity heatmap) with slicers for pilot, mission
   type, and **month/year**. Served by `GET …/analytics`.
2. **Player log backload** — players can ingest their own saved logs (the game's
   `logbackups`) via `npm run backfill` into a compact, gitignored
   `stores/history.json`, so the org sees real history rather than only the live
   session. Each log is attributed to its pilot by the login handle, so a
   multi-pilot corpus yields an org-wide view today (a preview of M4).

**Why:** the live relay alone only shows the current session on one machine. The
org's actual questions are comparative and historical ("who flew, when; how do our
missions end; how dangerous are our ops"). Analytics + backload answer those now,
at zero hosting cost, and the same shapes carry forward to the org-wide service (M4).

**Consequences / guardrails (protect these — do not regress):**
- Keep the analytics path **zero-runtime-dependency** (hand-rolled SVG charts,
  in-memory/file aggregation) — same rule as the rest of the service (D-002).
- Backfill stays **read-only on logs** and keeps only **compact aggregates**, never
  raw lines; `stores/` remains **gitignored** (it aggregates other members' logs —
  never commit/push it).
- Label **validated vs inferred** in the UI (officer-validated register vs
  log-derived analytics); the register stays the source of truth (D-005).
- These goals are recorded in `AGENTS.md` §1/§5 so both Claude Code and Codex treat
  them as binding context.

---

## D-006 — AI collaboration & human-control model; sub-agents for big batches
**Date:** 2026-06-14 · **Status:** Adopted

**Decision:** The product owner controls all development. AI agents (Claude Code,
OpenAI Codex) act as **advisors/reviewers** — they **propose** via branches, pull
requests, and committed docs, and **do not merge to `main` or build features
without the owner's explicit go-ahead**. Cross-agent collaboration is **async via
GitHub documentation** (`REVIEW.md`) and PR comments, not a live link. Adopt
**sub-agents** (separate context windows) as the default for big read/analysis
batches (large `Game.log` corpora, broad research) — they return summaries so heavy
reads stay out of the main context.

**Why:** multiple AI tools now work this repo; the owner must stay the decision-maker.
Async doc-based collaboration keeps an auditable trail and avoids any agent acting
unilaterally. Sub-agents address the practical context-window limit of long sessions.

**Consequences:** `AGENTS.md` §10 carries the binding rules (Codex reads it by
default; `CLAUDE.md` imports it). `REVIEW.md` is the shared review/collaboration log;
its *Owner decisions* section is the only thing that authorises work.

---

## D-005 — Build a centralized, officer-validated mission register next; defer federation
**Date:** 2026-06-13 · **Status:** Adopted (direction set; M5 design in `DESIGN-missions-mvp.md`)

**Decision:** Make the **Mission Register (Flow B)** the next build, as a
**centralized** service (the VPS from D-003) with **officer validation** as the
authority for completing missions. Treat the live log relay (Flow A) as *optional
supporting evidence*, never as proof. Adopt the **signed-validation / multisig
sliver** (the existing `types/Mission.js` crypto) when we reach the audit trail
(M6), but **do not** reintroduce a heavyweight p2p framework or build full
federation now — keep D-004 as a parallel, opt-in research track.

**Why:**
- **Testing proved the log can't be the source of truth.** SC 4.8.0 logs no kills
  / ship destruction; even available data is self-reported per-machine and not
  verifiable. (Repeatedly confirmed 2026-06-12/13.) A *human officer* must be the
  authority — which is also exactly the org's real structure (trusted leadership).
- **The valuable product (Flow B) is decoupled from log categorization.** It's a
  CRUD + workflow + auth system; ongoing parser work does not block it.
- **Out-of-game missions / fleet actions have no log signal at all**, so the same
  officer-validation model serves both in-game and out-of-game work uniformly.
- **Federation is a lot of work and unneeded for the requirement.** Per D-004's
  own "hard parts": signing proves *who said it*, not *that it's true*; NAT
  traversal and eventual-consistency are real costs. A trusted central authority
  (the org) doesn't have the trustless problem decentralization solves.

**Consequences:**
- Next milestones: **M4** (deploy central VPS + lightweight DB) → **M5**
  (mission register MVP: post → apply → validate, via Discord + REST) → **M6**
  (officer roles + tamper-evident, signed audit trail).
- A **Discord bot** (not just a webhook) becomes a required dependency for
  two-way commands. Identity = Discord users; officer permission = a Discord role.
- We keep the `MissionManager` seam and `Mission.js` crypto; the signed-validation
  piece is folded in at M6 **without** Fabric.
- Decentralization (D-004 MD-series) is revisited only if the org later wants to
  remove the VPS as a single point of failure or federate multiple orgs.

---

## D-004 — Revisit decentralization: federate first (amends D-002/D-003)
**Date:** 2026-06-12 · **Status:** Adopted (direction set; design only, no build yet)

**Decision:** Re-open the decentralization question we shelved in D-002. We will
**not** rip out the central VPS or Discord. Instead we grow a *federated* layer
**underneath** the current setup: multiple member-run nodes that gossip
**signed** events to each other for resilience, while **Discord stays the
primary UI** and the VPS remains a convenient (but no-longer-required) bridge.
Target rung now: **L1 — federated**. L2 (p2p, swappable relays) and L3 (fully
serverless) are explicit later options, not this step. Full design and the
M-series build plan live in `DESIGN-distributed.md`.

**Why:**
- D-002 was right that a *trustless* p2p framework is over-built for an org with
  a trusted leadership — but it conflated **transport** (Fabric, which was the
  fragile part) with **decentralized trust** (signed objects + multisig, which
  we still want). We keep the second and avoid the first.
- The crypto foundation already exists: `types/Mission.js` signs contracts with
  **secp256k1 / musig2 multisig**, and identity-as-keypair gives free spam/sybil
  resistance (ignore anything not signed by a key on the org roster).
- A single VPS (D-003) is one machine and one bill away from the org's data
  vanishing. Federation removes that single point of failure without paying the
  full cost of pure p2p (NAT traversal, serverless discovery) up front.

**Consequences:**
- D-003's VPS becomes **one node among several / a bridge**, not the sole source
  of truth. D-002's "single central service" framing is softened, not reversed.
- New honest limit we accept: decentralization **authenticates** who reported a
  game event; it cannot **verify** the event is true (only that player sees their
  own `Game.log`). Signing proves authorship, not gameplay.
- No blockchain. Signatures give non-repudiation + an audit trail; UEC settlement
  stays social/in-game.

---

## D-002 — Remove Fabric; build a lightweight central service
**Date:** 2026-06-08 · **Status:** Adopted (direction set; migration in progress)

**Decision:** Move off the Fabric framework and rebuild the core as a small,
standard Node service. Run it as a single central service the org hosts (see
D-003), with Discord for identity/interaction and the log relay running locally
on players' PCs.

**Why:**
- The Tier 0 spike (see `SPIKE-LOG-tier0-boot.md`) showed Fabric is heavy and
  fragile: its packages install over key-only SSH GitHub URLs (fail on a clean
  machine), pull ~400 MB including a headless browser, and one core package
  isn't even on the parts list. It never finished installing in a clean
  environment.
- The app's real job — watch a log file, post to Discord, share org contracts —
  does not need a decentralized peer-to-peer framework. An org has a trusted
  authority (its leadership/Discord), so a "trustless" design is over-built.
- Every actual feature survives removal; only generic plumbing needs replacing
  with standard parts (built-in HTTP, EventEmitter, crypto hashing).

**Consequences:**
- We forfeit (for now) decentralization and the cryptographic multisig contracts.
  These can be added later as *separate, optional modules* — the code keeps a
  `MissionManager` seam exactly for this.
- Install drops from ~400 MB + SSH setup to near-zero. M1 has **no** external
  dependencies at all.

---

## D-003 — Host on a small VPS
**Date:** 2026-06-08 · **Status:** Adopted

**Decision:** Host the shared contracts service on a small, low-cost cloud VPS
(always-on Linux box). Discord provides identity/interaction. The log relay runs
locally on each player's PC (it must, because `Game.log` only exists there).

**Why:** Simplest reliable way to have one shared source of truth the whole org
can reach. Avoiding a host was the only real argument for the decentralized
approach, and a few-dollars-a-month box is far simpler than operating a p2p
network. Discord is *identity/front-door*, not a host — the service still has to
run somewhere.

**Open items:** choose provider + monthly cost; decide database (SQLite to start
is fine); set up deploy. Tracked for milestone M4.

---

## D-001 — Stub the missing MissionManager to unblock boot
**Date:** 2026-06-08 · **Status:** Adopted

**Decision:** Added a minimal in-memory `services/MissionManager.js` (no crypto)
so the service can boot. The real mission/contract logic replaces it later.

**Why:** The original branch references `MissionManager.js` but never shipped it,
causing an instant crash. The stub satisfies the interface the service expects
and confirmed the crash is resolved. It is a placeholder, not the real system.
