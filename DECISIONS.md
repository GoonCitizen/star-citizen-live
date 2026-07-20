# Decisions Log (ADRs)
Plain-English record of the *why* behind key choices, so anyone joining later
understands the direction. Newest at the top.

---

## D-010 — Fabric Peer is the peering transport (HTTPS uplink retired)
**Date:** 2026-07-20 · **Status:** Adopted

**Decision:** All GoonCitizen ↔ org-hub peer traffic uses the Fabric
AMP/`Message` protocol over TCP/NOISE — not HTTP(S) batch uplink or chat pull.

1. **Local Fabric Peer** — each GoonCitizen node starts `@fabric/core` Peer
   listening on **port 7777** (`settings/local.js` → `fabric.port`, optional
   Fabric Store `fabricPort`). Identity unlock supplies the Peer key material.
2. **Default seed** — `relay.goon.vc:7777` (replaces `https://relay.goon.vc`).
   Peers UI / REST accept `host:port` only.
3. **Wire types** — chat uses `P2P_CHAT_MESSAGE` (Peer auto-relays);
   mission offers use GenericMessage `@type: MissionBroadcast` (optional
   `scope: 'global'|'group'` + `groupId`); log/event batches use
   GenericMessage `SCEventBatch`. Local dashboard HTTP (`:3041`) stays for UI/API only.
4. **Group-scoped broadcasts** — hub still relays; receivers **filter on
   membership in the group tree** (`isInGroupTree`: direct member or member
   of a nested subgroup). Same idea as `group:<id>` chat. Non-members do not
   get a pending offer. Hosted register may retain offers and filter
   list-by-viewer. **Groups** (not a single "org") are the multi-install
   sharing boundary; optional `parentId` nests subgroups.
5. **Star relay (goon.vc)** — Peer does not auto-relay arbitrary GenericMessage
   app types; goon.vc attaches handlers that `relayFrom` MissionBroadcast /
   SCEventBatch and ingest into the mounted LiveRelay.

**Why:** D-009 brought Fabric conventions back; HTTPS uplink was a temporary
bridge. Real Peer transport matches hub.fabric.pub, enables signed wire frames
end-to-end, and removes pull-sync race/auth complexity for chat.

**Consequences / guardrails:**
- `shareLogsGlobal` still gates **log** event publish only; chat + mission
  broadcasts always publish when the Fabric peer is up.
- HTTP `POST …/events` may remain on hosted mode for tests/legacy; production
  peering path is Fabric.
- Do not reintroduce https peer URLs in the Peers UI.

---

## D-009 — Align with Fabric conventions; integrate with the Fabric Network
**Date:** 2026-07-19 · **Status:** Adopted

**Decision:** GoonCitizen follows the Fabric project conventions and integrates
with the **Fabric Network** using the **Fabric Protocol** (amends the "no Fabric"
framing of D-002 — the heavyweight transport stays out, but conventions, types,
and network integration come in):
1. **Types in `types/`, data in `stores/`** — code never lives in `stores/`.
   `types/Store.js` is the persistence type (backed by
   `@fabric/core/types/store`, LevelDB). The named Fabric store root is
   `stores/gooncitizen/` (CLI) / `<userData>/stores/gooncitizen/` (desktop) —
   the counterpart of the Hub's `stores/hub`. **All internal storage goes
   through the Fabric Store** (`register/` LevelDB): missions, groups, AND
   operator settings (a `settings` collection —
   `functions/settingsStore.js`). The application never writes a settings
   JSON file; a legacy `settings.json` is imported once on Store start and
   retired as `.migrated`.
2. **Hub features come forward** — capabilities proven in `hub.fabric.pub` are
   progressively adopted: peer management is a top-level dashboard feature
   (`components/Peers.js`, Hub-compatible `GET|POST /peers` +
   `POST|DELETE /peers/:id`); settings mirror the Hub's `GET /settings` /
   `PUT /settings/:name` shapes; **identity safety follows the Hub's
   IdentityManager model** (`components/Identity.js`): idle auto-lock
   (default 30 min, signing re-arms), password re-verification before seed
   reveal or backup export, hidden-by-default secrets with copy gated on
   reveal, password-sealed backup export/import, and typed confirmation
   before forget. The plaintext key lives only in Electron main-process
   memory; the renderer sees signatures, never secrets. More (documents,
   activity stream) can follow.
3. **Dashboard = home page** — the UI opens on a Home tab listing the feature
   set (Live feed, Analyze, Groups, Peers) along the top, Hub-style, with
   hash-synced navigation (`/#live`, `/#groups`, …).
4. **Scripts follow Fabric naming** — `npm run desktop`, `build:desktop`,
   `build:desktop:dir` match `@fabric/hub`; installers target **Windows x64 +
   Debian x64** (primary — most players run Windows) plus a macOS build.

**Why:** the org's hub (goon.vc) *is* a Fabric Hub; matching its conventions
means shared muscle memory, shared code paths (identity, Schnorr envelopes,
Store), and a clean path to full Fabric Network participation instead of a
parallel bespoke stack.

**Consequences / guardrails:**
- D-002's core lesson stands: the local relay must keep working standalone —
  Fabric crypto/persistence load lazily and memory-only mode remains for tests.
- `stores/` stays gitignored (data only, no code).
- New top-level features should land as Hub-style components + REST surfaces so
  they can later be driven over the Fabric Protocol (wire `Message`s) without
  redesign.

---

## D-008 — Player identities, goon.vc hub, multisig groups, Bitcoin-unlocked payouts
**Date:** 2026-07-19 · **Status:** Adopted (implemented; deploy pending)

**Decision:** Four connected capabilities land together:
1. **First-run identity** — the desktop app onboards each player with a BIP39
   keypair (`functions/identity.js`, `components/Onboarding.js`). The encrypted
   key lives in Electron `userData`; the compressed secp256k1 pubkey is the
   player's actor id. Keys never leave the client.
2. **goon.vc hub** — the separate `goon.vc` repo (a Fabric Hub) mounts this
   project's API at `/services/star-citizen` via `LiveRelay.apiHandler()` in
   `mode: 'server'` (no log tailing, no dashboard). Installed clients push
   **Schnorr-signed event batches** (`POST …/events`); unsigned writes are
   rejected in hosted mode, and every stored event carries its `source` pubkey.
   Ingest is idempotent by content id (DESIGN-event-convergence.md).
3. **Groups** — any member may create a group (`types/Group.js`,
   `services/GroupManager.js`): a pubkey roster + k-of-n threshold, verified
   with the standard Fabric `Federation` BIP340 Schnorr multisignature.
   Missions carrying a `groupId` are served **only to that group's members**
   (Schnorr login → Bearer session, `POST …/auth`).
4. **Bitcoin-unlocked completion** — missions may carry an `authorities` set
   (pubkeys + threshold; defaults to the creator). Approving a completion claim
   requires k-of-n Schnorr signatures over a canonical acceptance message; the
   signed authorization is embedded in the audit chain (this delivers M6's
   signed audit). With an escrow attached, acceptance flips it to `payable`:
   `services/PayoutManager.js` derives a k-of-n multisig address from the
   authority keys (bitcoind `createmultisig`), verifies funding
   (`scantxoutset`), builds the payout PSBT for the authorities to sign
   client-side, and broadcasts the signed tx. **Mainnet is refused** unless
   explicitly overridden — regtest/signet until the flow is proven. Missions
   without funding use a ledger-only obligation.

**Why:** the org needs multi-player visibility (one machine's log is not the
org), authenticated contribution (signing proves authorship — D-004's honest
limit stands), member-run groups without granting server-side roles, and a
reward mechanism whose settlement does not depend on trusting the server.

**Consequences / guardrails:**
- Amends D-002/D-004: signed identity + multisig return **as optional modules**
  — the local relay still runs standalone with zero external deps and no
  identity (crypto loads lazily). D-005 holds: humans (creator/authorities)
  validate completion; the log remains supporting evidence only.
- The server stores only pubkeys, signatures, and events — never private keys.
- The legacy officer allowlist still governs missions without an authorities
  set (backward compatible with M5).
- Deploy artifacts live in `goon.vc/deploy/` + `goon.vc/DEPLOY.md` (systemd,
  Caddy TLS, env template). Actual VPS deployment is the remaining step.

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
