# GoonCitizen as a Fabric application

Why fork **this** tree instead of Hub, `@fabric/core` examples, or a blank Peer.

GoonCitizen is the suite’s **reference application**: a local node that
**composes** `@fabric/core` `Store` + `Peer`, re-exports `@fabric/http` login and
link helpers, and optionally talks to Hub for Bitcoin / Beacon. It does **not**
subclass Hub. The retired `services/StarCitizen.js` (`extends Hub`) is history —
do not copy it.

Canonical layering: [`@fabric/core` `docs/TYPES_AND_SERVICES.md`](https://github.com/FabricLabs/fabric/blob/feature/rsi/docs/TYPES_AND_SERVICES.md)
(GoonCitizen section). Namespaces: [`docs/APPLICATION_NAMESPACES.md`](https://github.com/FabricLabs/fabric/blob/feature/rsi/docs/APPLICATION_NAMESPACES.md).
What actually runs: [`AGENTS.md`](../AGENTS.md) §3–§4. Call for developers:
[`DEVELOPERS.md`](../DEVELOPERS.md). Downstream intel desk (Groups as orgs,
`settings/local.js` whitelabel): [`INTELLIGENCE.md`](INTELLIGENCE.md).

---

## Why start here

| If you start from… | You get | You still have to build |
|---|---|---|
| **This repo (LiveRelay)** | Peer, Store collections, Passport sign-in, linked signers (delegation), Federation Groups, group federation vaults, publisher-profile pinned desktops, shoutbox + `CONTRACT_*` gossip, Electron + Android shells, optional Discord adapter, public-seed runbook | Your domain (parser, missions, chrome, brand) |
| **Hub (`hub.fabric.pub`)** | Rendezvous, Beacon, Bitcoin, WebRTC signaling, document market | A whole application node (Hub is not a player client) |
| **`@fabric/core` only** | AMP/`Message`, Peer, Key, Contract, Chain | HTTP dashboard, identity UX, Groups, packaging, Discord, deploy |
| **Blank HTTPS service** | Familiar REST | Mesh identity, signed gossip, `fabric:` shares, hostile-peer assumptions |

Hub is the **operator rendezvous**. GoonCitizen is the **player/org node**.
`goon.vc` is an HTML zipper, not an app. One mesh, many apps: unknown contract
ids must not crash the Peer (D-012).

You can rename the product, drop Star Citizen, drop Bitcoin, and ignore
GoonCitizen mission types. Keep the **wires** below and you are still on the
Fabric Network — including next to people you compete with.

---

## Artifacts to copy (the reusable basis)

These are the pieces a second application should treat as the template. Paths
are in this repo unless noted.

### 1. Application namespace (frozen genesis)

[`contracts/gooncitizen.js`](../contracts/gooncitizen.js) — canonical genesis
for `CONTRACT_PUBLISH`. `Actor(definition).id` **is** the network namespace.
Frozen `messageTypes` today: `MissionBroadcast`, `SCEventBatch`. **Do not bump
that list** to add features (it moves the id for everyone). Extra types ride
`CONTRACT_MESSAGE` under the same id.

Your app: freeze **your** genesis the same way. Publish it (`npm run
playnet:deploy-gooncitizen` is the GoonCitizen publisher —
[`scripts/playnet-deploy-gooncitizen.js`](../scripts/playnet-deploy-gooncitizen.js)).
Hub **Accept** is how Beacon tracks the namespace (D-016), not how players join.

### 2. Per-group Federation contracts

[`contracts/gooncitizenGroup.js`](../contracts/gooncitizenGroup.js) — each Group
is its own `CONTRACT_PUBLISH` (not a row in the GoonCitizen genesis). Journal:
`GroupChat`, `GroupChange`, `GroupShare`, Hub-shaped `FederationContractInvite`,
fleet/activity shares, catch-up. Sharing boundary is the Group, not “the org.”

Your app: keep Groups even if you are not an RSI org. Nested `parentId`, opaque
`fabric:` Share (D-019), membership-filtered ingest.

### 3. Application body catalog (extend without moving ids)

[`contracts/applicationMessageTypes.js`](../contracts/applicationMessageTypes.js)
— core generic ARC types plus product bodies (`MissionCreated`, `NoteShare`,
`GroupDataShare`, `DelegationShare`, `DeviceDataShare`, Discord/Lookup
Request→Claim→Response, …). Pattern: **new collections attach under a
namespace; genesis `messageTypes` stay frozen.**

### 4. The process that runs

[`services/LiveRelay.js`](../services/LiveRelay.js) — EventEmitter + loopback
HTTP dashboard + register. [`services/FabricNetwork.js`](../services/FabricNetwork.js)
constructs core `Peer` and maps app `CONTRACT_MESSAGE` types. Not a second Peer.

[`types/Store.js`](../types/Store.js) — **composes** core Store; collections at
`/collections/<name>` under `stores/gooncitizen/`.

Domain managers (`ChatManager`, `GroupManager`, `MissionManager`) stay
application-local. Share only wire helpers (chat normalize, federation invite
JSON).

### 5. Identity, login, cluster (http contracts, local keys)

| Artifact | Role |
|---|---|
| Hub-shaped `/sessions` (D-021) | Passport v2 sign-in: a challenge for a pinned origin, an assertion over a private port, an HttpOnly session |
| Hub-shaped `/delegations` + `/services/delegation/mailbox` (D-022) | Linked-signer pairing rendezvous and signing-request mailbox over HTTPS; grants then gossip on the mesh as `DelegationShare` |
| `DeviceDataShare` | Cluster-gated account replay (no seeds/tokens) |
| Electron IPC / Android Keys pages | Secrets never on HTTP |

Re-export `@fabric/http` verify helpers; do not fork them. Threat model:
[`THREAT-MODEL.md`](THREAT-MODEL.md).

### 6. Which wire (do not invent a fourth)

[`API-SURFACES.md`](API-SURFACES.md) — IPC for keys/OS, HTTP for this node’s UI,
Fabric AMP for gossip, Discord gateway for Discord. The SPA posts to **this
node**; LiveRelay **may** publish a Fabric frame. UI does not speak AMP except
delivery receipt.

### 7. Packaging and a public seed

| Artifact | Role |
|---|---|
| `npm run desktop` / [`ELECTRON_BUILD.md`](../ELECTRON_BUILD.md) | Player machine |
| [`ANDROID.md`](../ANDROID.md) | Local-first APK (Peer on device; HTTPS is pairing only) |
| [`PRODUCTION.md`](PRODUCTION.md) | `SC_MODE=server`, HTTP loopback, Peer `:7777` |
| Settings / env | Secrets never in git (`DEVELOPERS.md`) |

Discord (`@fabric/discord`) is an **adapter** with your bot token. Fabric
coordinates multi-operator replies (`DiscordRequest` / Claim / Response); it is
not a Discord transport.

### 8. Honesty constraints (copy these too)

- Game.log (or any game file) is **read-only**.
- Parser `verified:true` only against a real line, qualified by version.
- Gameplay share **opt-in** (D-017). Chat/missions may publish when the Peer is up.
- Officer (or your equivalent) validates high-stakes completion (D-005) if the
  source is self-reported.
- Alliance coins sit in the **group's federation vault** (k-of-n signers). Hub
  is not a custodian. Do not market mesh chat or Beacon as money.

### 9. Alliance treasury (the group's federation vault)

[`services/GroupWallets.js`](../services/GroupWallets.js) on core
`@fabric/core/types/federation`. Each Federation Group's signers (readers do
not count) and threshold make a named-federation descriptor; its hash is the
federation id and every member derives the same Taproot vault.
`GET …/groups/:id/wallet` returns `mode: 'federation'`, `federationId`, and
earlier vaults under `previous` (still spendable after a signer change).
Withdrawals are core `FederationWithdrawal*` messages under the federation id,
so a Hub or Passport holding a signer key can take part.

This is the alliance vault. **Hub does not hold these coins.** Mission escrow
(`PayoutManager`) is a separate ledger/RPC path on the same node. D-008:
keys never on a hosted server; mainnet refused unless `allowMainnet`. Playnet
and signet until Wave 3 of the core 0.1 review (empty-authority publish + live
Hub OOM pin).

Your app: keep the Group wallet even if you drop Star Citizen missions. Do not
proxy org spends through Hub `sendpayment`.

### 10. Publisher profile (pinned desktop builds)

[`functions/profileFiles.js`](../functions/profileFiles.js) — `profile.files`
GroupDataShare pack. Operators pin catalog rows (📌); compact metadata gossips
(name / size / price / merkle root — not bytes). Installer names
(`.dmg` / `.exe` / `.AppImage` / `.apk` / …) classify as `kind: 'application'`
so the profile page lists **Desktop applications**.

`npm run publish:builds -- --pin` posts installers into this node’s Files
catalog and pins them onto the local identity. Federation members see those
builds on `GET …/profiles/:id`. That is how other org leaders install **your**
desktop without cloning git.

Your app: ship your branded Electron/APK the same way. Pin on **your**
publisher identity. Do not treat Hub’s document market as the org app store.

---

## What to replace when it is not Star Citizen

Safe to rebrand or delete: dashboard chrome, `Game.log` parser, cumulative
history, SC mission types, Discord as the front door, personal Hub Bitcoin
proxy, G00N/PERMAFLEET copy.

Keep or reimplement in-kind: Peer on `:7777`, `CONTRACT_PUBLISH` genesis,
Group Federation contracts, group federation vaults (`GroupWallets`),
publisher-profile pinned desktops (`profile.files` + `--pin`), opaque
`fabric:` shares, Passport sign-in / linked signers, Store collections,
unknown-namespace ignore, opt-in private data.

---

## What not to copy

- **`StarCitizen extends Hub`** — wrong product shape.
- **Hub JSON-RPC / Beacon / bitcoind** as the app’s core loop.
- **Growing `goon.vc` into a relay** — zipper only ([`goon.vc` PLAN.md](https://github.com/GoonCitizen/goon.vc/blob/master/PLAN.md)).
- **Casual `@fabric/*` pin bumps** — coordinated with Hub/core RC.
- **HTTPS-only “peering”** — D-010 retired that.

---

## Minimum path (second application)

1. Clone this repo (or fork). Node **26.12.1**, `npm i`, `npm test`, `npm start`.
2. Keep [`contracts/gooncitizenGroup.js`](../contracts/gooncitizenGroup.js) until
   you have a reason to split Groups.
3. Add your genesis next to [`contracts/gooncitizen.js`](../contracts/gooncitizen.js)
   (new name/version → new id). Do not edit frozen GoonCitizen `messageTypes`
   unless you intend to abandon that namespace.
4. Ingest: ignore unknown `contract` ids; handle yours in a FabricNetwork-shaped
   adapter.
5. Publish with the same playnet pattern (`CONTRACT_PUBLISH`, optional Hub
   Accept). Default seeds may stay `hub.fabric.pub:7777` / `relay.goon.vc:7777`
   or you run [`PRODUCTION.md`](PRODUCTION.md) yourself.
6. Pin **your** Group as the org: `defaultGroupMessageId` in `settings/local.js`
   ([`INTELLIGENCE.md`](INTELLIGENCE.md)).

MIT: keep the copyright notice ([`LICENSE`](../LICENSE)). Change the rest.
