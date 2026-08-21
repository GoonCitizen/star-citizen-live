# Design — Mission Register MVP (M5)

> **Status:** Design. Implements **D-005**. Plain-English summary lives in
> `SOLUTION-BRIEF.md`; this is the technical plan.
> **Builds on:** `services/MissionManager.js` (the live register — not the retired
> `app/server.js` path). Crypto/multisig types remain in `types/Mission.js`.
> **Principle:** centralized, **officer-validated**; the log relay is *evidence*,
> never proof (D-005). Zero new runtime deps where possible.
> **Contributors:** [`DEVELOPERS.md`](DEVELOPERS.md). What runs: [`AGENTS.md`](AGENTS.md) §3.

---

## 1. Scope

**In (M5):** create missions (incl. out-of-game / fleet actions) → apply → assign
→ claim completion (with optional evidence) → **officer validates** → reward
recorded. Persisted to disk. Usable from **Discord** and the **REST API**. Every
state change written to an **audit log**.

**Out (later):** cryptographic signing of validations + hash-chained tamper-
evidence (**M6**); multisig completion (`Mission.js`, M6+); federation (D-004).

---

## 2. Architecture

```
 Member PC (Flow A)            Cloud VPS (Flow B - this design)            Discord
┌───────────────┐   POST evidence   ┌──────────────────────────────┐
│ Live Relay    │ ────────────────► │ app/server.js (REST)         │ ◄── Bot (slash
│ (app/server)  │   (optional)      │  └─ MissionManager (real)    │     commands)
└───────────────┘                   │  └─ Store (node:sqlite)      │ ──► Webhook
                                     │  └─ Audit log                │     (embeds)
                                     └──────────────────────────────┘
```

- The **same `app/server.js`** process hosts the register (it already routes
  `/missions`). The relay and the register can run in one process for a single
  org, or be split (relay local, register on the VPS) — the REST boundary is the
  same either way.
- **MissionManager** graduates from in-memory stub to a persisted implementation
  with the new entities/methods below, keeping its current method names/events so
  nothing else breaks.

---

## 3. Data model

IDs are opaque strings. Timestamps ISO-8601 UTC. `actor` = a Discord user id
(string); officers identified by role (see §8).

### Mission
| field | type | notes |
|---|---|---|
| id | string | `mission-<ts>-<n>` (keep stub scheme) or content hash at M6 |
| title | string | |
| type | enum | `bounty` \| `cargo` \| `exploration` \| `fleet-action` \| `custom` |
| description | string | |
| reward | int | UEC (0 allowed for fleet actions) |
| requirements | string? | free text (ship, rank, etc.) |
| location | string? | |
| deadline | ts? | |
| outOfGame | bool | true → no log evidence expected; officer-validate only |
| createdBy | actor | must be an officer |
| createdAt | ts | |
| status | enum | `open` → `assigned` → `completed` \| `cancelled` |
| assigneeId | actor? | set when an application is accepted |
| contract | object | `{type:'single'}` now; `musig2` M-of-N at M6 |

### Application
`id, missionId, applicantId, message, status(pending|accepted|rejected),
createdAt, decidedBy?, decidedAt?, reason?`

### CompletionClaim
`id, missionId, claimantId, claimedAt, note?, evidence:[EvidenceRef],
status(pending|validated|rejected)`

### EvidenceRef (optional, links Flow A → B)
`{ kind:'session'|'mission'|'combat'|'note', refId?:string, text?:string }`
— `refId` points at a relay record (e.g. a `missionGroups` MissionId or `sessions`
entry). **Advisory only** — never auto-approves anything.

### Validation (the officer authority step)
`id, claimId, missionId, officerId, decision('approve'|'reject'), note?,
validatedAt, signature?(M6)`

### AuditEntry (append-only)
`{ seq, ts, actor, action, entity, entityId, summary, prevHash, hash }`
- `action` e.g. `mission.create`, `application.submit`, `application.accept`,
  `claim.submit`, `claim.validate`.
- `hash = sha256(prevHash + canonical(entry-without-hash))` → a simple hash chain
  (tamper-evident). `idFor()` in `app/server.js` already gives us sha256. M6 adds
  an officer **signature** over the entry.

### Mission lifecycle (state machine)
```
 open ──apply──► (applications) ──officer accept──► assigned
   │                                                   │
   └──officer cancel──► cancelled        claimant submits claim
                                                       │
                                          officer validate(approve) ──► completed
                                          officer validate(reject)  ──► assigned
```

---

## 4. Persistence

**Choice: `node:sqlite`** (built into Node 22+; user runs v24) → keeps the
project's **zero-external-dependency** stance (no `better-sqlite3` npm install).
A thin `app/store.js` wraps it and exposes a tiny repository API; an in-memory
fallback (current Map behaviour) is kept for tests so `npm test` needs no file.

Tables mirror §3: `missions`, `applications`, `claims`, `validations`, `audit`.
Single-file DB (e.g. `stores/register.sqlite`, gitignored). Writes wrapped per
action; each action also appends one `audit` row in the same transaction.

> If `node:sqlite` proves awkward, fallback is a single append-only JSON-lines
> file per table — still zero-dep. Decide at M5.1.

---

## 5. REST API (extends `app/server.js`)

Base: `/services/star-citizen`. New/expanded routes (all JSON):

| Method & path | Who | Action |
|---|---|---|
| `POST /missions` | officer | create (existing route; expand fields) |
| `GET /missions` `GET /missions/:id` | any | list / detail (existing) |
| `POST /missions/:id/cancel` | officer | cancel |
| `POST /missions/:id/apply` | member | submit application |
| `GET /missions/:id/applications` | officer | list applications |
| `POST /applications/:id/decision` | officer | `{decision:'accept'|'reject'}` → sets assignee |
| `POST /missions/:id/claim` | member(assignee) | submit completion claim + evidence |
| `POST /claims/:id/validate` | officer | `{decision:'approve'|'reject', note}` |
| `GET /audit` | any | append-only audit list |

Auth on each route via §8. Officer routes reject non-officers with `403`.
Responses keep the existing `{type, data}` envelope.

---

## 6. Discord integration

Two channels of integration; the **bot is the new required dependency** (a webhook
is outbound-only and can't accept commands).

- **Outbound (have it):** webhook embeds already post live events; add embeds for
  `mission.create`, `application.accept`, `claim.validate`.
- **Inbound (new): a Discord bot / application** exposing **slash commands**:
  - `/mission post <type> <title> <reward> [outofgame]` (officer)
  - `/mission list` · `/mission apply <id> [note]` · `/mission claim <id> [note]`
  - `/mission validate <claimId> approve|reject [note]` (officer)
  - `/mission mine` (a member's own missions)
- **Identity:** the Discord user id from the interaction *is* the actor — no
  separate login. **Officer** = holds the configured Discord **role** (the bot
  reads role membership), or, to start, an allowlist of officer ids in settings.
- **Transport:** Discord **Interactions over HTTPS** (the bot verifies a signed
  request and our existing HTTP server answers) avoids a always-connected gateway
  socket — lighter and fits the current architecture. Gateway is an option if we
  later want live presence.

Secrets (`DISCORD_BOT_TOKEN`, `DISCORD_PUBLIC_KEY`, `DISCORD_APP_ID`) via env /
gitignored config, same as the webhook today.

---

## 7. Evidence bridge (Flow A → Flow B)

When a member claims completion in-game, the UI/bot can offer to attach evidence
the relay already holds: a `sessions` entry (was online), a `missionGroups`
MissionId (took/progressed that mission), or `combat` progress. Stored as
`EvidenceRef`s on the claim and shown to the officer at validation time. **It
informs the officer; it never auto-validates.** Out-of-game missions simply carry
no evidence — identical flow, officer decides.

---

## 8. Roles & permissions

- **Member:** anyone on the org Discord. Can list/apply/claim/view own.
- **Officer:** holds the Discord "Officer" role (configurable role id), or is in
  `settings.officers` allowlist for bootstrap. Can create/cancel missions, decide
  applications, validate claims.
- Enforcement: a `requireOfficer(actor)` check on officer routes/commands.
- All officer actions are audited with the officer's id.

---

## 9. Audit & integrity

- Every mutating action appends one `AuditEntry` in the same DB transaction.
- **M5:** hash-chain (`prevHash`→`hash`) makes silent edits detectable.
- **M6:** each officer **signs** their validation (and optionally the audit entry)
  with a per-officer keypair (`types/Mission.js` secp256k1) → non-repudiation;
  multisig completion for high-value contracts (M-of-N officers).

---

## 10. Build plan (sub-milestones)

- **M5.1 — Store + model.** `app/store.js` (node:sqlite + in-memory test mode);
  real `MissionManager` with the §3 entities; audit hash-chain. *Tests:* lifecycle
  transitions, audit chain verifies, rejects bad transitions. *Demo:* create →
  apply → accept → claim → validate via direct calls.
- **M5.2 — REST.** Wire §5 routes into `app/server.js` with officer checks.
  *Tests:* each route happy-path + 403s. *Demo:* full flow over `curl`.
- **M5.3 — Discord bot.** Interactions endpoint + slash commands + role check +
  outbound embeds. *Demo:* run the whole flow from Discord. *Dep:* bot created.
- **M5.4 — Evidence bridge.** Attach relay records as `EvidenceRef`s; surface at
  validation. *Demo:* in-game claim shows session/mission evidence.
- **M5.5 — Web view.** Read-only missions board added to the existing dashboard
  (officers see a validate queue). *Demo:* board + validate queue.

Each ends with a `PROGRESS.md` retro. M4 (provision the VPS) can run in parallel;
it's ops, not code.

---

## 11. Decisions needed from the product owner (tracked in SOLUTION-BRIEF §7)

1. Hosting provider + monthly budget (M4).
2. Approve creating the Discord **bot**; choose the **Officer role**.
3. Live-feed channel: public vs private.
4. Whether rewards are tracked as informational only (assumed yes — settlement
   stays in-game/social; no real-money or on-chain handling, per D-004 §7).

## 12. Open technical questions

- `node:sqlite` vs JSON-lines fallback — confirm at M5.1 on the target Node.
- Interactions-over-HTTPS vs gateway bot — default to HTTPS; revisit if we need
  presence/live events in Discord.
- ID scheme: keep readable `mission-<ts>-<n>` for M5; switch missions to
  content-hash IDs when signing lands (M6) for stable, verifiable references.
