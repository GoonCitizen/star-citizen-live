# Design — A Distributed (Non-Central) Option

> **Status:** Design only. No code yet. See `DECISIONS.md` → **D-004**.
> **Target rung:** **L1 — federated** (grow toward L2/L3 later).
> **Constraint:** Discord stays the **primary UI**; the federated layer runs
> *underneath* for resilience. The VPS becomes one node/bridge, not the sole
> source of truth.

This doc explains *what* a non-central version of the project looks like and
*how* we'd get there in small, testable milestones — written so a non-developer
can follow the shape and the trade-offs.

---

## 1. The goal, split in two

The project bundles two flows with **opposite** distribution needs. A good
distributed design treats them separately.

| Flow | What it is | Volume | Stakes | Natural shape |
|------|-----------|--------|--------|---------------|
| **A — Live event feed** | `Game.log` → kills/logins/etc., shared to the org | High, constant | Low (ephemeral) | Broadcast; eventual consistency is fine |
| **B — Missions & contracts** | post → apply → assign → sign/complete (UEC rewards) | Low | **High** (signed agreements) | Shared state that must be **verifiable** |

Most "decentralization is hard" pain comes from forcing both through one
mechanism. We don't.

---

## 2. Why this isn't "undo D-002"

D-002 removed **Fabric** — and that was correct, because Fabric was a *fragile
transport/runtime* (400 MB installs over SSH GitHub URLs that failed on clean
machines). What D-002 also shelved, but we still want, is **decentralized
trust**: signed, content-addressed objects and multisig contracts.

> **Keep:** identity-as-keypair, signed objects, multisig (`secp256k1`/`musig2`).
> **Avoid:** a heavyweight p2p framework and any "trustless consensus" machinery.

The crypto half already exists in `types/Mission.js`. We are not starting over.

---

## 3. The foundation: identity = keys, not accounts

With no central server to "log in" to, **identity must be a keypair** each member
holds. The org becomes a **roster of public keys** (a membership allowlist).
This single idea unlocks everything else:

- Every event a node broadcasts is **signed** → peers know *which member*
  reported it, with no server involved.
- Missions, applications, and completions are signed objects; multisig contracts
  are M-of-N over those same keys (exactly what `Mission.js` models today).
- **Free spam/sybil resistance:** nodes ignore anything not signed by a key on
  the roster.

The roster itself starts simple (a signed list the org leadership publishes) and
can decentralize later.

---

## 4. The L1 picture (what we're actually building toward)

```
        ┌─────────────────────────────────────────────┐
        │                  Discord                     │  ← primary UI (humans)
        └───────────────▲───────────────▲──────────────┘
                        │ bridge        │ bridge
                 ┌──────┴─────┐   ┌──────┴─────┐
   Game.log →    │   Node A   │◄─►│   Node B   │   ← members run nodes; they
   (local)       │ (a member) │   │ (the VPS)  │     gossip SIGNED events to
                 └──────▲─────┘   └────────────┘     each other (federation)
                        │
   Game.log →    ┌──────┴─────┐
   (local)       │   Node C   │◄─► … more member nodes …
                 └────────────┘
```

- Each node watches **its own** `Game.log` locally (already true — the log only
  exists on the player's PC).
- Nodes **gossip** signed events to a few peers; every node ends up with the same
  feed without a single required hub.
- One or more nodes act as a **Discord bridge**, mirroring the feed into channels.
  If any one node (including the VPS) goes down, the others carry on.

This is **L1**: a handful of trusted, member-run nodes federating. No DHT, no NAT
hole-punching yet — peers connect over known addresses (the VPS plus any member
willing to expose a port, or a lightweight relay). That keeps the hard p2p
problems out of scope for now.

---

## 5. How each flow works

**Flow A — live feed (federated broadcast):**
1. Node reads a new log line → `parser.js` classifies it (already built).
2. Node wraps it as a **signed event** `{ event, author_pubkey, sig, ts }`.
3. Node gossips it to its peers; peers verify the signature against the roster
   and drop duplicates (by content hash).
4. Bridge node(s) post it to Discord.

**Flow B — missions/contracts (replicated, verifiable state):**
1. A mission is a **signed, content-addressed object** (its hash = its ID).
2. `apply` / `assign` / `complete` are further signed events that reference that
   hash.
3. Mission **state** = a deterministic fold over those events, with simple
   conflict rules (poster's signature is authoritative for assignment; a
   multisig completion needs its signature threshold).
4. **No node adjudicates** — every node computes the same state and verifies the
   signatures itself. A completed contract is provable offline by anyone.

---

## 6. Transport choice (deferred, but scoped)

For L1 we need the *least* machinery that lets a few known nodes exchange signed
events. Candidates, to decide at the M2 spike:

| Option | Why consider | Watch-out |
|--------|-------------|-----------|
| **Plain signed HTTP/WebSocket gossip** | Tiny, no new deps, nodes already run an HTTP server | We hand-roll peer list + retries |
| **Nostr-style (signed events + swappable relays)** | Reuses our exact secp256k1; relays are redundant & replaceable | Relays are *semi*-central (run several) |
| **Hyperswarm / Hypercore** | True serverless, NAT hole-punching, append-only signed logs | Newer; more glue; really an L3 tool |
| **js-libp2p** | Battle-tested gossipsub + DHT | Heaviest; over-scoped for L1 |

> **Lean:** start L1 on **plain signed gossip** (or Nostr if we want relays for
> free), because both reuse our crypto and keep the build small. Hyperswarm/libp2p
> are the **L3** upgrade path when/if we drop known-address federation for true
> serverless discovery.

A small **CRDT** library (Automerge/Yjs) may go *inside* whichever transport we
pick, to merge mission state without conflicts — evaluated at M4.

---

## 7. Honest hard parts (designed-for, not hand-waved)

1. **Source trust is unfixable by decentralization.** Only you see your own
   `Game.log`; a node could *lie* about kills. Signing proves **who said it**, not
   **that it's true**. Accept this; don't pretend otherwise.
2. **NAT traversal** (home routers) is the #1 practical hurdle for real p2p — and
   the main reason L1 sticks to known addresses + a relay/VPS instead of pure DHT.
3. **Eventual consistency:** two members may briefly see different mission states;
   the conflict rules in §5 settle it, and the UI must tolerate "settling."
4. **No blockchain needed.** UEC isn't on-chain money; signatures give
   non-repudiation + audit, settlement stays social/in-game. Heavy consensus would
   be over-engineering.
5. **Roster management** (adding/removing members, key rotation) is its own small
   problem; start with a leadership-signed list, decentralize later.

---

## 8. Spike plan (M-series) — design/spike only, no production build

Each milestone is small, demoable, and ends with a retro note in `PROGRESS.md`.
These slot **after** the existing roadmap's M3-combat and can run in parallel with
M4/M5 thinking.

- **MD0 — Identity primitives.** Generate/load a per-node secp256k1 keypair;
  sign + verify a sample event. Reuse `Mission.js` crypto. *Demo:* two keypairs,
  one signs, the other verifies. *Risk it kills:* "is the crypto reusable?"
- **MD1 — Signed event envelope.** Define the `{ event, author_pubkey, sig, ts,
  hash }` wrapper around the existing parser output; round-trip + verify; reject
  tampered/off-roster events. *Demo:* feed a real log line → signed envelope →
  verified.
- **MD2 — Two-node federation (the transport spike).** Stand up **two** local
  nodes; Node A gossips signed events to Node B over the chosen transport
  (decide: plain WS gossip vs Nostr); B dedupes by hash and shows the same feed.
  *Demo:* replay a log on A, watch events appear on B. *Risk it kills:* "does the
  transport choice hold up?"
- **MD3 — Discord bridge as a node.** Make one node mirror the federated feed into
  Discord, proving Discord is a *view*, not the backbone — kill the bridge node
  and the feed still flows between A and B. *Demo:* bridge down, federation up.
- **MD4 — Missions as signed, foldable state.** Represent post/apply/assign as
  signed events; compute mission state by folding them on every node; apply the
  conflict rules; (optional) evaluate a CRDT lib here. *Demo:* two nodes
  independently agree on the same mission's assignee.
- **MD5 — Multisig completion.** Wire `Mission.js` musig2 so an M-of-N contract
  completes only when the signature threshold is met, verifiable on any node with
  no server. *Demo:* 2-of-3 completion verified offline.
- **MD6 — Roster + membership.** Leadership-signed roster of pubkeys; nodes accept
  only roster-signed events; cover add/remove/rotate. *Demo:* an off-roster node's
  events are ignored org-wide.

**Stop/return points:** after **MD2** we'll know if the transport is sound (go/no-go
on plain-gossip vs Nostr vs escalating to Hyperswarm). After **MD5** we have a
genuinely decentralized contract layer. L2/L3 (serverless discovery, dropping
relays) only get scoped if the org wants to remove the VPS entirely.

---

## 9. What this does *not* change

- Discord stays the primary, human-facing UI.
- The local `Game.log` watcher / `parser.js` are unchanged — they just feed a
  signing+gossip layer instead of (or in addition to) a single central service.
- The VPS can keep running; it simply stops being a *single point of failure*.
