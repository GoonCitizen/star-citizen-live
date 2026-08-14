# Decisions Log (ADRs)
Plain-English record of the *why* behind key choices, so anyone joining later
understands the direction. Newest at the top.

---

## D-019 — Group shares as opaque Fabric Messages
**Date:** 2026-07-24 · **Status:** Adopted

**Decision:** GoonCitizen Group **Share** copies an opaque `fabric:<hex>` AMP
Message (signed `CONTRACT_MESSAGE` / `GroupShare` / `kind: GroupOffer` embedding
the group genesis), not a legacy HTTP page URL as the primary artifact.
`FederationContractInvite` gains the same `protocolUrl` / `messageHex` fields.
Desktop `fabric:` opens opaque hex into an Accept/Ignore modal; ingest uses
existing `ingestContractPublish` / invite handlers. HTTP `/groups/…` remains a
secondary browser affordance.

**Why:** Mesh-native, offline-capable join offers without depending on the same
HTTP origin; clipboard/QR portability across installs.

**Consequences:**
- Prefer `POST …/groups/:id/share` and invite responses’ `protocolUrl`.
- Do not invent `fabric://group?…` query schemes — opaque Message is enough.

---

## D-018 — Chain of Blocks (PoW, Federation signatures, arbitrary data)
**Date:** 2026-07-24 · **Status:** Adopted

**Decision:** Use `@fabric/core` **`Chain`** + **`Block`** (Bitcoin-shaped
header; optional PoW; optional Elements-style block signatures; optional
arbitrary `data`) — not a separate OrderedChain or parallel “entry” type:

1. **`consensus: 'federation'`** — Hub Beacon `beacon/CHAIN` / `BEACON_EPOCH`
   Blocks (linear tip; k-of-n Schnorr on the block).
2. **`consensus: 'gossip'`** — GoonCitizen event firehose / `SCEventBatch` as
   data Blocks (union by content-id; optional author signatures).
3. **`consensus: 'pow'`** (default) — Bitcoin/playnet Block + mempool ledger.

**Sidechain document helpers** (`@fabric/core/functions/sidechainState`) hold the
sealed JSON document. Tip digests feed that document /
`GameStateSnapshot` (D-015). Do **not** put raw gossip into `beacon/CHAIN`.

App wrapper: `functions/eventChain.js` (thin gossip Block helper + history fold).

**Why:** One Block unit and one Chain ledger; consensus policy keeps authority
separate (DESIGN-event-convergence: firehose ≠ officer truth; Beacon = L1-tied
seal clock). Aligns with Bitcoin + Blockstream Elements signed blocks.

**Consequences / guardrails:**
- Prefer `Chain.create({ consensus })` + `Block` over ad-hoc arrays.
- Log publish remains opt-in (D-017); chain ops are local.
- Mission register hash-chained audit stays separate.
- Do not reintroduce OrderedChain or a dual entry-seal API.

---

## D-017 — Opt-in log sharing (per-peer authorize + improved Peers list)
**Date:** 2026-07-24 · **Status:** Adopted

**Decision:** Parsed gameplay events (`SCEventBatch`, `GameStateSnapshot`) leave
the local node only after **explicit authorize**. Chat and mission broadcasts
remain ungated when the Fabric peer is up (D-010).

1. **Default off** — `shareLogsGlobal` is false unless the operator sets it
   true in Settings (was previously default-on).
2. **Per-peer grant** — each roster peer has `shareLogs` (opt-in). When global
   is off, the uplink targets only peers with `shareLogs: true` via directed
   Fabric send (`opts.to`); when global is on, batches broadcast to all
   connected sockets.
3. **Peers UI** — Hub PeerList-inspired status: connected / offline / disabled,
   network-hub badge for `hub.fabric.pub` / `relay.goon.vc`, live socket list,
   and a Share-logs checkbox per peer. Transport remains Fabric TCP/NOISE on
   the desktop relay; browser WebRTC mesh stays on Hub.

**Why:** Story #2 (authorize share before org aggregation) requires consent ≠
silent uplink. Most players have one LIVE install and one org hub; authorizing
that peer is clearer than a default-on global flood.

**Consequences / guardrails:**
- Do not queue or publish log events without `_canShareLogs()`.
- Prefer per-peer grants for network hubs (`hub.fabric.pub`, `relay.goon.vc`);
  global is the “share with everyone I’m connected to” escape hatch.
- Connection badges are roster+socket correlation, not WebRTC (Hub-only).

---

## D-016 — Contract-namespace sidechains under Hub Beacon
**Date:** 2026-07-20 · **Status:** Adopted

**Decision:** Follow Hub **ADR-001**
(`hub.fabric.pub/docs/ADR-001-CONTRACT_NAMESPACE_SIDECHAINS.md`): Bitcoin L1 tips
clock the Beacon Federation; each accepted `CONTRACT_PUBLISH` namespace gets the
**same sidechain document helpers** (`@fabric/core` `functions/sidechainState` +
`Chain` / `Block` family) as
a further namespace under its parent. GoonCitizen is an application namespace
under the Hub sidechain; Group Federation contracts are further namespaces under
GoonCitizen the same way.

1. **Publish** the frozen GoonCitizen genesis (`CONTRACT_PUBLISH`) so Hub
   operators can Accept it into Beacon-tracked contracts.
2. **Seal** compact game state at Hub `/services/rsi` **and**
   `/namespaces/<gooncitizenContractId>` (parent namespace head).
3. **Groups** provision a per-contract Statechain document in the Fabric
   **Store** collection `groupsidechains` (not raw `fs` under
   `sidechains/<id>/`) and publish Group genesis so further namespaces reuse
   the same Contract protocol. Each group document keeps an **append-only
   JOURNAL** of accepted membership events (applications, decisions,
   `GroupChange`, invite responses); `STATE` content is the deterministic
   **fold** of genesis + journal (`functions/groupStatechain.js`).

**Why:** One verify path from L1 → Hub Beacon → GoonCitizen → Groups; rendezvous
Hubs bootstrap many apps without each inventing a chain.

**Consequences / guardrails:**
- Do not bump frozen GoonCitizen genesis `messageTypes` for namespace plumbing.
- Namespace digests are public commitments — never raw `Game.log` lines.
- Hub federation threshold Schnorr on epochs is authoritative for the seal clock.

---

## D-015 — GoonCitizen game state sealed on Hub Beacon / sidechain
**Date:** 2026-07-20 · **Status:** Adopted

**Decision:** Cumulative GoonCitizen aggregation (D-014) is published into the
Hub **logical sidechain** (`sidechain/STATE` content at `/services/rsi`) so each
**Beacon epoch** on `relay.goon.vc` seals a public **stateDigest** and full
snapshot (`sidechain/SNAPSHOTS`), following Fabric **sidechain document**
semantics
(`@fabric/core` `docs/DISTRIBUTED_EXECUTION.md`, Hub `docs/BEACON_SIDECHAIN_DESIGN_AND_ROADMAP.md`).

1. **Clients** publish `GameStateSnapshot` CONTRACT_MESSAGE (and continue
   `SCEventBatch`) when log sharing is authorized (D-017: `shareLogsGlobal`
   or per-peer `shareLogs`).
2. **relay.goon.vc** (`goon.vc` Hub) folds ingest into durable cumulative
   history, then applies a trusted sidechain patch via
   `Hub._applySidechainPatchesTrusted` (path policy allows `/services/rsi`).
3. **Beacon** already embeds `payload.sidechain { clock, stateDigest }` and
   writes per-epoch snapshots — no parallel “game chain”; GoonCitizen rides the
   Hub sidechain.

**Why:** Org-wide verified play must be publicly tip-tied and reorg-safe, not
only local `history.json`. The Beacon is the L1 step clock; the sidechain
document is the shared game-state head.

**Consequences / guardrails:**
- Compact snapshot only (counts, capped missions/deaths, heat, pilots) — never
  raw Game.log lines.
- Do not bump the frozen GoonCitizen contract Actor `messageTypes` list for
  `GameStateSnapshot` (same pattern as `MissionCreated`).
- Patch no-ops when `digest` is unchanged (avoid clock spam).

---

## D-014 — Cumulative durable Game.log history (desktop default)
**Date:** 2026-07-20 · **Status:** Adopted

**Decision:** Parsed gameplay for analytics is **cumulative and durable** on the
desktop/local relay. Every startup runs a **cursor-based sync** over the live
`Game.log` plus locatable `logbackups` / corpus dirs, folding new bytes into
`stores/gooncitizen/history.json` (under Electron `userData` on desktop). Live
tail lines continue to update that same store. The Analyze tab and the header
stat strip show **all-time cumulative** counts by default; session-scoped
counts remain on the monitor payload under `counts.session` for the Live feed.

1. **Compact records only** — ended missions, deaths, sessions, heat, pilots
   (never raw lines). Content-addressed ids make re-sync idempotent.
2. **Byte cursors** — `log-cursors.json` tracks `{ size, mtimeMs }` per file so
   restarts only read new bytes; file shrink/rotate rescans from 0.
3. **Two planes unchanged** — mission register stays LevelDB source of truth
   (D-005); the firehose history is attributable analytics, not officer truth.

**Why:** GoonCitizen’s product shape is many installs aggregating verified play
over time. In-memory session collections alone reset every launch and could not
meet that bar.

**Consequences / guardrails:**
- Do not double-count: analytics reads cumulative history; live active missions
  (no outcome yet) are the only session merge-in.
- `npm run backfill` writes the same history path (incremental sync), not a
  divergent repo-root file.
- Hub/server mode does not auto-scan local Game.logs (no file on the host).
- **Corpus discovery (story #1):** `functions/logCorpus.js` + `locate.js` find
  all channel `Game.log`s and `logbackups` on Windows drives **and** Linux/macOS
  Wine/Proton prefixes. `GET …/corpus` + Analyze “My logs” list tracked files /
  cursors; `POST …/corpus/sync` re-runs the cursor sync. History meta may stamp
  `ownerPubkey` when identity is unlocked.

---

## D-013 — Mutual device-link attestations (separate seeds)
**Date:** 2026-07-20 · **Amended:** 2026-08-13 · **Status:** Adopted

**Decision:** Passport, Hub browser identity, GoonCitizen desktop, and GoonCitizen Android each keep **their own seed**. Cross-app trust is a **mutual Schnorr attestation** over a Hub / LiveRelay rendezvous (`/device-links`), not a shared mnemonic.

**Pairing ceremony (unchanged):**

1. **Offer** — initiator signs
   `fabric:device-link:1:offer:<nonce>:<initiatorId>:<label>:<origin>` and
   `POST /device-links` → `protocolUrl` `fabric://link?sessionId&hub`.
2. **Responder** — GoonCitizen opens `fabric://link` (or Passport via
   `FABRIC_DEVICE_LINK_REQUEST` postMessage), BIP340-signs the mutual message
   `fabric:device-link:1:<nonce>:<initiatorId>:<responderId>:<label>`,
   `POST …/signatures` `{ role: 'responder', … }`.
3. **Countersign** — initiator signs the same mutual message
   `{ role: 'initiator' }` → `status: linked`. Both sides store peer
   Fabric id / xpub locally (non-secret).

**Network artifact (2026-08-13):** pairing only proved intent on the two
machines. Other peers still saw two unrelated actors. After `status: linked`,
each device publishes **`IdentityCrossSign`** (not frozen into GoonCitizen
genesis `messageTypes`) over
`fabric:identity-cross-sign:1:<nonce>:<localPubkey>:<peerPubkey>`. A cluster
is valid only when **both** directions verify and neither is revoked.
`IdentityCrossSignRevoke` (signed by either side) splits that edge. Settings
“Revoke” **publishes** revoke, not only deletes local `linkedDevices`.

Canonical display id = lexicographically smallest x-only pubkey (no elected
master). Wire messages stay signed by the **sending device**; authorization
and display (chat, profile, groups, officers, missions) **resolve through the
cluster**. A device cannot produce AMP signatures as a sibling key.

**Why:** One shared seed across apps is brittle and unsafe for operators.
Dual attestation preserves independent backups while proving both keys agreed.
Gossiped cross-sign makes that agreement **network-visible**.

**Consequences / guardrails:**
- **Peer-equivalent initiator:** Passport, GoonCitizen Android, GoonCitizen
  desktop, and Hub browser can each create or accept a `/device-links` offer.
  Android **Security → Add a device** is the convenient mobile QR path;
  Passport Settings → Security & privacy can start the same ceremony.
- Same crypto rules as client-signed login (Identity.id from xpub, BIP340).
- Cannot link a key to itself (initiator id === responder id rejected).
- Session TTL 30 minutes. Origin: same-origin as site login, plus thin clients
  (Capacitor / loopback WebViews, `chrome-extension:` / `moz-extension:`)
  creating/polling an **allowlisted** hub. Possession of the session id + Schnorr
  remain the capability.
- Thin clients (Passport, Hub browser) submit a device-signed envelope; verifiers
  check the **device Schnorr**, not a relay’s AMP author. Hubs may re-wrap the
  proof as a Fabric `CONTRACT_MESSAGE` for later-relay. **Android is a local
  GoonCitizen node** (own LiveRelay + Fabric Peer, loopback HTTP) — not a thin
  WebView of `relay.goon.vc`.
- A stolen device key **is** the person until another cluster member publishes
  revoke from Identity / Security or Settings / privacy (`docs/THREAT-MODEL.md`).
- Mnemonic restore remains an escape hatch (Passport import), not the link path.

---

## D-012 — Fabric application namespaces (shoutbox + contract gossip)
**Date:** 2026-07-20 · **Status:** Adopted

**Decision:** GoonCitizen follows Fabric’s **application namespace** contract
flow (see `@fabric/core` `docs/APPLICATION_NAMESPACES.md` and `MESSAGES.md` §3):

1. **Global shoutbox** — `P2P_CHAT_MESSAGE` for network-wide `global` chat.
2. **Gossip** — Peers relay `P2P_CHAT_MESSAGE`, `CONTRACT_PUBLISH`, and
   `CONTRACT_MESSAGE` (`P2P_CONTRACT_*` aliases). Apps ignore irrelevant
   contract namespaces; unknown ids must not crash the Peer.
3. **App contracts** — the frozen **GoonCitizen** genesis namespaces
   network-wide mission/event types; each **Group** is its own Federation
   contract (`CONTRACT_PUBLISH` + `GroupChat` / `GroupChange` / `GroupShare` /
   Hub-shaped `FederationContractInvite`) with a convergent validator timeline.
4. **Extensibility** — new collections attach under a contract namespace without
   moving the GoonCitizen genesis `Actor` id (do not casually edit frozen
   `messageTypes` on that genesis).

**Why:** One mesh, many apps. A single relay path plus per-contract ignore
rules scales better than per-app wire opcodes; Federation validators give each
Group a Hub-compatible convergent policy.

**Consequences / guardrails:**
- Keep `global` chat on `P2P_CHAT_MESSAGE`; do not stuff group chat into the
  shoutbox.
- Group-scoped shares use the Group contract, not only local `groupId` filters.
- Align invite JSON with Hub `FederationContractInvite` v2 when possible.

---

## D-011 — Client-signed Fabric site login (Passport ↔ desktop)
**Date:** 2026-07-20 · **Status:** Adopted

**Decision:** Websites (e.g. `relay.goon.vc`) authenticate players with a
**client-signed** Fabric login session. GoonCitizen desktop and Fabric Passport
are interchangeable signers for the same challenge.

When **LiveRelay** is the public HTTP origin (`SC_MODE=server` on
`relay.goon.vc`), it hosts this contract itself
(`functions/fabricSiteLogin.js`) — not only when embedded under a Fabric Hub.

1. **Site** — `POST /sessions` `{ origin }` creates a pending challenge and
   returns `protocolUrl` (`fabric://login?sessionId=…&hub=…`) plus
   `acceptsClientSignature: true`.
2. **Desktop** — GoonCitizen registers as a `fabric:` handler, fetches the
   pending session, shows an in-app approval modal, BIP340-signs with the
   unlocked player identity, and `POST`s
   `{ signature, pubkeyHex, identity: { id, xpub } }` to
   `/sessions/:id/signatures`.
3. **Passport** — pages `postMessage` `FABRIC_SITE_LOGIN_REQUEST`; the
   extension popup approves and POSTs the same body.
4. **Hub self-sign** (empty body on `POST …/signatures`) remains a **Hub-only**
   path for linking a browser to a Hub node identity. LiveRelay rejects empty
   bodies and accepts **client-signed** completions only; a successful sign-in
   also issues a Bearer token (`delegationToken`) usable as
   `Authorization: Bearer …` for hosted API auth.

**Why:** Hub’s original desktop login used the Hub root key (node link). Orgs
need players to prove *their* key on web surfaces; desktop and extension must
share one REST contract so either can complete sign-in.

**Consequences / guardrails:**
- Always verify against the **server-stored** challenge (never trust a client
  `message` field).
- Crypto verification authenticates client-signed completion; poll still
  enforces Origin/Referer off-loopback.
- OS `fabric:` ownership may be contested with Fabric Hub desktop — last
  registered / default-app wins; document for operators.
- Secrets stay in Electron main / Passport session memory; renderer only
  approves or rejects.

---

## D-010 — Fabric Peer is the peering transport (HTTPS uplink retired)
**Date:** 2026-07-20 · **Status:** Adopted

**Privacy / threat model:** conversational Fabric traffic is signed plaintext
at relays — see [`docs/THREAT-MODEL.md`](docs/THREAT-MODEL.md).

**Decision:** All GoonCitizen ↔ org-hub peer traffic uses the Fabric
AMP/`Message` protocol over TCP/NOISE — not HTTP(S) batch uplink or chat pull.

1. **Local Fabric Peer** — each GoonCitizen node starts `@fabric/core` Peer
   listening on **port 7777** (`settings/local.js` → `fabric.port`, optional
   Fabric Store `fabricPort`). Identity unlock supplies the Peer key material.
2. **Default seeds** — `hub.fabric.pub:7777` and `relay.goon.vc:7777`
   (replaces the single HTTPS uplink). Both are Fabric Network hubs that
   selectively relay relevant messages; Peers UI / REST accept `host:port` only.
3. **Wire types** — network-wide `global` chat uses `P2P_CHAT_MESSAGE`;
   GoonCitizen app events use `CONTRACT_MESSAGE` under the frozen GoonCitizen
   contract id (`MissionCreated` / `MissionBroadcast` / `SCEventBatch`).
   Each **Group** is a Hub-aligned **Federation contract**
   (`CONTRACT_PUBLISH` + `contracts/gooncitizenGroup.js`) carrying
   `GroupChat`, `GroupChange`, `GroupShare`, and Hub-shaped
   `FederationContractInvite` / Response. Local dashboard HTTP (`:3041`)
   stays for UI/API only.
4. **Group-scoped broadcasts** — published as `GroupShare` on the Group
   Federation contract; receivers **filter on membership in the group tree**
   (`isInGroupTree`). Non-members do not get a pending offer. Hosted register
   may retain offers and filter list-by-viewer. **Groups** (not a single
   "org") are the multi-install sharing boundary; optional `parentId` nests
   subgroups.
5. **Star relay (goon.vc)** — `@fabric/core` Peer relays
   `CONTRACT_MESSAGE` / `CONTRACT_PUBLISH` / `P2P_CHAT_MESSAGE` natively
   (hop re-sign); goon.vc attaches GoonCitizen ingest handlers to the Hub
   agent Peer.

**Why:** D-009 brought Fabric conventions back; HTTPS uplink was a temporary
bridge. Real Peer transport matches hub.fabric.pub, enables signed wire frames
end-to-end, and removes pull-sync race/auth complexity for chat.

**Consequences / guardrails:**
- Log event publish is opt-in (D-017): `shareLogsGlobal` and/or per-peer
  `shareLogs`. Chat + mission broadcasts always publish when the Fabric peer
  is up.
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
   `types/Store.js` is the GoonCitizen persistence façade: it **composes**
   `@fabric/core/types/store` and persists named collections at Fabric paths
   `/collections/<name>` via `fabric.set` / `fabric.get` (exposes
   `store.fabric`). The named Fabric store root is
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
1. **First-run identity** — desktop and Android onboard each player with a BIP39
   keypair (`functions/identity.js`, `components/Onboarding.js`), or restore from
   a seed / xprv / encrypted backup. The encrypted key lives in Electron
   `userData` (desktop) or Capacitor Preferences (Android); the compressed
   secp256k1 pubkey is the player's actor id. Keys never leave the client.
   Android then uses dedicated **Keys / Security / Privacy** pages instead of
   overlay modals (`components/Account.js`).
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
- Optional first-run **master seed wizard** (`components/MasterSeedWizard.js`,
  `functions/masterSeedVault.js`) derives BIP39 passphrase-protected child
  xprvs (Bitcoin `m/44'/0'/0'`, devices `m/44'/{7777|7778}'/N'`). Create /
  restore / import are unchanged; the wizard only installs the first-device
  xprv if the operator chooses.

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
