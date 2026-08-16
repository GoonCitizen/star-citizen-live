# API surfaces (IPC, HTTP, Fabric, …)
How GoonCitizen clients talk to a node — and how that node talks to the mesh.
**Last reviewed against source:** 2026-08-15 (`LiveRelay._handle`, `preload.js`,
`services/FabricNetwork.js`, D-010 / D-011 / D-013, `functions/clusterSync.js`).

`API.md` is stale JSDoc from the retired Hub subclass path. Trust this file,
`services/LiveRelay.js`, and tests over `API.md`.

Suite *types/services* layering (who owns a class) lives in `@fabric/core`
[`docs/TYPES_AND_SERVICES.md`](https://github.com/FabricLabs/fabric/blob/feature/rsi/docs/TYPES_AND_SERVICES.md).
This file is the *runtime* map: which wire a UI or peer should use.

Contributors changing a wire still start at [`DEVELOPERS.md`](../DEVELOPERS.md)
(PRs against `feature/rsi`, `npm test`). Product surface: [`AGENTS.md`](../AGENTS.md) §3–§4.

---

## Rule of thumb

| Job | Surface | Do not |
|-----|---------|--------|
| Seed, unlock, sign, reveal, backup | **IPC** (`window.electronAPI.identity`) or Passport | Put keys on HTTP, in the SPA bundle, or on Fabric |
| Dashboard reads / register mutations | **HTTP** `GET\|POST /services/star-citizen/…` | Invent a parallel IPC “API” for chat/groups/missions |
| Gossip to other nodes | **Fabric Peer** AMP/`Message` on TCP/NOISE `:7777` | HTTPS batch uplink or `POST …/events` as peering |
| Site login / device-link *rendezvous* | **HTTP** Hub-shaped `/sessions`, `/device-links` | Mesh-flood pairing secrets |
| After device-link, one actor on the mesh | **Fabric** `IdentityCrossSign` then `DeviceDataShare` (`account.peers` LAN dial + Hub WebRTC *registry* for LAN hints + collection replay) | HTTPS account restore as the primary path; LiveRelay hosting ICE |
| Native OS (dialogs, tray, `fabric:` URLs) | **IPC** | HTTP file pickers on desktop |
| Discord channel I/O | **Discord gateway + REST** (local bot) | Fabric as a Discord transport |
| Personal Bitcoin send | **HTTP proxy** to Hub `/services/bitcoin` | Fabric P2P money; LiveRelay JSON-RPC |
| Hub operator methods (`ListPeers`, Beacon, …) | **Hub** JSON-RPC (WS / `POST /services/rpc`) | Expect these on LiveRelay |

**Command vs distribution:** the SPA posts to **this node’s HTTP**. LiveRelay
then **may** publish a Fabric frame. The UI does not speak AMP except for a few
preload helpers (delivery receipt). That split is intentional (D-010).

---

## Who talks to whom

```text
Passport popup          Electron renderer / Android WebView
   │ postMessage              │ fetch()              │ electronAPI (IPC)
   │ FABRIC_SITE_LOGIN_*      │                      │ identity / dialogs /
   ▼                          ▼                      │ fabric: / notify
Hub or LiveRelay HTTP     LiveRelay HTTP :3041  ◄────┘
 /sessions /device-links   /services/star-citizen/*
                          /sessions /device-links /services/peering
                                    │
                    ┌───────────────┼────────────────┐
                    ▼               ▼                ▼
             Fabric Peer      Discord bot      Hub HTTP (Bitcoin)
             :7777 AMP        gateway+REST     /services/bitcoin/*
                    │
                    ▼
         hubs (hub.fabric.pub, relay.goon.vc) + other Peers
```

LiveRelay **composes** `@fabric/core` Store + Peer. It does **not** subclass Hub
and does **not** expose Hub JSON-RPC or Hub WebRTC *signaling*. It **is** a
JSON-RPC *client* of Hub `RegisterWebRTCPeer` / `ListWebRTCPeers` so Node
phone and desktop can advertise Fabric `:7777` LAN candidates (coordinator
only — no ICE).

---

## 1. Electron IPC

**Files:** `preload.js` (renderer bridge), `main.js` (`ipcMain.handle`).

**When:** desktop `npm run desktop` only. The renderer is a Chromium SPA that
already has loopback HTTP to LiveRelay. IPC exists so **secrets and OS
capabilities never cross HTTP**.

Exposed as `window.electronAPI`:

| Channel | Role |
|---------|------|
| `identity:*` | Create / restore / unlock / lock / sign envelope or message / reveal / backup / forget / autolock |
| `identity:device-link-*` | Start / tick / cancel a `/device-links` offer (Node holds the key) |
| `identity:open-protocol-url` | Handle `fabric://login`, `fabric://link`, opaque `fabric:<hex>` |
| `fabric-login:*` | Prompt + approve/reject client-signed site login (D-011) |
| `fabric-group-share:*` | Prompt + ingest opaque GroupOffer / Federation invite |
| `fabric:delivery-receipt` | Sign+publish a Fabric `MessageReceipt` without HTTP |
| `fabric:publish-cross-sign` | Sign+gossip `IdentityCrossSign` / Revoke via the local Peer |
| `fabric:identity-cluster` | Snapshot of Fabric-ingested cluster edges (no HTTP GET) |
| `fabric:presence-status` / `fabric:presence-roster` / `fabric:presence-set` / `fabric:presence-ship` | Local presence + roster in-process (SPA uses `functions/presenceClient.js`) |
| `dialog:*` | Native folder / log / fleet JSON pickers |
| `notify:show` + `notify:action` / `notify:click` | OS notifications |
| `get-service-status` / `restart-service` / `set-open-at-login` / group overlay | Shell, not the register |

The SPA still `fetch`es `/services/star-citizen/chat/messages`, `/groups`,
`/missions`, `/settings`, … even inside Electron. IPC is not a second REST API.
Mesh publishes that already have a Peer helper go through
`window.electronAPI.fabric` first (`functions/identityCrossSignClient.js`,
`functions/presenceClient.js`, `components/DeliverySync.js`); HTTP remains for
Passport and hosted browsers.

---

## Fabric-first clients (reduce HTTP)

Same job, portable order: **in-process Fabric (IPC) → Hub Bridge if signed wire
exists → HTTP**. Thin clients (Passport, goon.vc, hosted dashboard) have no
GoonCitizen Peer, so they stay on Hub-shaped HTTP.

| Done | Next (still HTTP from the SPA) | Stay HTTP |
|------|--------------------------------|-----------|
| Delivery `MessageReceipt` | Peers list / announce (`P2P_PEERING_OFFER` on the wire; do not IPC `AddPeer`) | `/sessions`, `/device-links` rendezvous |
| IdentityCrossSign publish + cluster snapshot | Android `electronAPI.fabric.*` polyfill (today loopback HTTP) | Chat/groups/missions local command (then Fabric distribute) |
| Device-link account replay (`DeviceDataShare` + `account.peers` TCP dial + Hub `RegisterWebRTCPeer` LAN hints) | — | Bitcoin Hub proxy, Discord bot I/O |
| Presence GET/PUT + roster (`presenceClient.js`) | — | Public `/ships` catalog; `/rules` parser table |

Do not add Hub JSON-RPC on LiveRelay to “replace” REST. Prefer existing Fabric
message types + the `electronAPI.fabric` helper list.

---

## 2. Android identity bridge (IPC polyfill)

**Files:** `functions/androidIdentityBridge.js`, `functions/androidLocalNode.js`.

Capacitor WebView installs `window.electronAPI` with `platform: 'android'` so
Identity / Onboarding / `fabric:` prompts reuse the desktop components.

- **Keys** stay in the WebView + Capacitor Preferences (polyfill), not Electron
  main.
- **App data** is still loopback HTTP to the embedded LiveRelay
  (`http://127.0.0.1:3041`). Capacitor `https://localhost` is rewritten onto
  that origin.
- **Device-link to a public hub** must not POST from CapacitorHttp (no Origin →
  403). The WebView calls **local**
  `POST /services/star-citizen/device-links…`; embedded Node talks to
  `relay.goon.vc` the same way desktop main does.

Android is a **local node** (own Peer + Store), not a thin client of
`relay.goon.vc`.

---

## 3. HTTP (LiveRelay)

**Handler:** `LiveRelay._handle` / `apiHandler()` (standalone public seed on
`relay.goon.vc`; historical Hub-embed path is retired).
**Listen:** desktop/android loopback `:3041`; `SC_MODE=server` also loopback
behind Caddy (`docs/PRODUCTION.md`).

### Auth

| Bind | Reads | Writes |
|------|-------|--------|
| Loopback (Electron / local browser / Android) | Unlocked identity is the viewer | Unlocked identity; optional Bearer |
| `httpSharedMode` from a non-loopback peer | Session required on the privacy-sensitive GETs that call `_requireSession` | Schnorr/Bearer (`functions/httpRemoteAuth.js`) |
| `SC_MODE=server` | Same; public Caddy→loopback **must** use server mode so the unlocked path is not inherited | Always Bearer / signed envelope |

Two login contracts (do not collapse without owner go-ahead):

1. **D-011 site login** — Hub-compatible `POST /sessions` → `fabric://login` →
   `POST /sessions/:id/signatures` → Bearer `delegationToken`.
2. **Legacy dashboard login** — `POST /services/star-citizen/auth` with a
   Schnorr envelope `{ intent: 'login', ts }`. `_requireSession` still cites
   this path.

### Hub-shaped routes on this process (not `/services/star-citizen`)

So Passport / Hub desktop can treat `relay.goon.vc` like a Hub origin:

| Path | Role |
|------|------|
| `POST /sessions`, `GET /sessions/:id`, `POST /sessions/:id/signatures` | Client-signed site login (D-011). LiveRelay **rejects** Hub empty-body self-sign. |
| `POST /device-links`, poll, `POST …/signatures` | Device-link rendezvous (D-013). Public hub allowlist. |
| `GET /services/peering`, `OPTIONS /` | Hub-compatible peering discovery + `OracleAttestation` |
| `GET /` and SPA paths (`/groups/:id`, `/profiles/:id`, …) | Dashboard HTML |

### Local device-link (Android / loopback)

`POST|GET /services/star-citizen/device-links…` — Node-side client to the
allowlisted hub. Not the public rendezvous.

### Application REST (`/services/star-citizen`)

Authoritative list is the `pathname` branches in `_handle`. Product groups:

| Area | Examples |
|------|----------|
| Status / live | `GET /`, `GET /monitor`, `GET /feed`, `GET /rules`, overlay |
| Analytics | `GET /analytics`, `/corpus`, `/activity-tree` (+ `POST …/publish`) |
| Settings / peers | `/settings`, `/peers`, `/peers/announce`, `/profile`; `/presence` (desktop SPA is Fabric-first) |
| Identity cluster | `/identity/cluster` (members, edges, one-way `pending`), `/identity/cluster/sync` (collection + `mesh` Hub registry snapshot + `inventory` per-device counts; POST `{ publish }`, `{ mesh: true }`, `{ dial: [...] }`, or a `FabricMessageCollection`), `/identity/session`, `/identity/cross-sign` |
| Chat | `/chat/channels`, `/chat/messages`, pin, `/delivery/:hash/receipt` |
| Groups | CRUD, `/share`, `/share/ingest`, invites, fleets, statechain, wallet |
| Missions | CRUD + apply/accept/claim/validate/broadcast; `/inbox` |
| Notes / local tags | `/notes`, `/local-groups` |
| Discord | `/discord/link`, `/guilds`, `/world-view` (session on hosted) |
| Files | `/documents`, `/documents/inventory`, `/files/:id/pin`, `/files/:id/cluster-sync` |
| Fabric AMP log | `GET /fabric/messages` (session); `?format=collection` exports `FabricMessageCollection` hex for replay. Cluster catch-up: `GET|POST /identity/cluster/sync` (same AMP hex, `DeviceDataShare` only). |
| Bitcoin | `/bitcoin/*` **proxies Hub HTTP** (desktop) |
| Legacy ingest | `POST /events` — leftover HTTP push; **not** the peering transport (D-010) |

Many routes are also aliased at HTTP root (`/peers`, `/settings`, `/search`) so
the SPA can `fetch('/settings')` without the prefix. Prefer
`/services/star-citizen/…` in new code.

JSON shape is Fabric-ish (`{ type: 'Collection' \| 'Group' \| …, data }`), not
JSON-RPC.

---

## 4. Fabric Peer (mesh)

**Files:** `services/FabricNetwork.js`, `contracts/applicationMessageTypes.js`,
`contracts/gooncitizen.js`, `contracts/gooncitizenGroup.js`.
**Transport:** AMP `Message` over TCP/NOISE. Default seeds
`hub.fabric.pub:7777`, `relay.goon.vc:7777`. Opt-in log share (D-017).

### Outer types (wire)

| Outer | Body | Use |
|-------|------|-----|
| `P2P_CHAT_MESSAGE` | raw UTF-8 | Network `global` shoutbox |
| `P2P_PEER_ALIAS` | UTF-8 nickname | Handle gossip |
| `P2P_PEERING_OFFER` / gossip | JSON | Slot fill / advertise |
| `P2P_INVENTORY_REQUEST` / `RESPONSE` | catalog rows | Files “Query peers” |
| `P2P_FILE_SEND` | blob chunks | Document bytes |
| `CONTRACT_PUBLISH` | genesis | GoonCitizen app + per-Group Federation |
| `CONTRACT_MESSAGE` | `{ contract, type, object }` | Almost all app events |
| `CONTRACT_PROPOSAL` | batched messages + patch | Group/wallet proposals |

### `CONTRACT_MESSAGE` body types (ingest catalog)

**Frozen on GoonCitizen genesis** (do not casually edit — moves the contract
id): `MissionBroadcast`, `SCEventBatch`.

**Also gossiped, not frozen into genesis** (add here, not on genesis
`messageTypes`): `MissionCreated`, `MissionClaim` / `MissionClaimDecision`,
`GameStateSnapshot`, `DirectChat`, `NoteShare` / `NoteUpdate`, `GroupDataShare`,
`IdentityCrossSign` / `Revoke`, `DeviceDataShare`, Discord/Lookup
Request→Claim→Response, `PeerProfile`, `Presence`, …

**Per-Group Federation genesis** (`GROUP_MESSAGE_TYPES`): `GroupChat`,
`GroupChange` (+ proposal/vote), `GroupShare`, `GroupActivityTree`,
`FleetShare`, `FederationContractInvite` / Response, journal catch-up,
capability / withdrawal types.

Chat storage stays `{ channel, body, handle }` in the Store regardless of wire
type (`global` vs `group:<id>` vs `discord:`).

---

## 5. `fabric:` URLs and clipboard shares

| Form | Meaning | Completes via |
|------|---------|----------------|
| `fabric://login?sessionId&hub` | D-011 site login | IPC / Passport → `POST /sessions/:id/signatures` |
| `fabric://link?sessionId&hub` | D-013 device-link | same, `/device-links` |
| `fabric:<hex>` or `fabric:base64,…` | Opaque AMP `Message` (GroupOffer / invite) (D-019) | IPC `groupShare` or `POST …/groups/share/ingest` |

These are **not** a third REST. They are envelopes that land on HTTP rendezvous
or Fabric ingest.

---

## 6. Passport / Hub browser (`postMessage`)

Fabric Passport does not use GoonCitizen IPC. Pages send
`FABRIC_SITE_LOGIN_REQUEST` / `FABRIC_DEVICE_LINK_REQUEST`; the extension
signs and POSTs to the **same** `/sessions` and `/device-links` contracts.
Hub browser identity is the same pairing model (own seed).

LiveRelay hosted GETs then use the issued Bearer token. The dashboard origin
never holds the player seed.

---

## 7. Discord

Local `@fabric/discord` bot (gateway + REST). Channel keys stay `discord:` /
`discord:dm:` until another platform is wired.

Inbound announce-channel **commands** are coordinated on Fabric
(`DiscordRequest` → first-wins `DiscordClaim` → `DiscordResponse`) so multiple
operators of the same Discord application do not double-reply. That Fabric
sequence is **not** how messages appear in Discord; the bot still talks to
Discord’s API.

Webhook embeds (`DISCORD_WEBHOOK_URL`) are a fallback mirror of the log relay,
not the bot bridge.

---

## 8. Surfaces that are *not* LiveRelay

| Surface | Owner | GoonCitizen relation |
|---------|-------|----------------------|
| Hub JSON-RPC (WS binary `JSONCall`, `POST /services/rpc`) | `@fabric/hub` + `@fabric/http` | Wallet proxy only; no LiveRelay RPC server |
| Hub WebRTC signaling | Hub `RegisterWebRTCPeer` / `SendWebRTCSignal` | LiveRelay Node does not host ICE; it *does* register LAN candidates on Hub `RegisterWebRTCPeer` and TCP-dials siblings |
| Hub `/services/payjoin`, Beacon, sidechain HTTP | Hub | Playnet publisher / `GameStateSnapshot` aggregation on the *hub*, not this HTTP tree |
| Chrome extension `runtime.sendMessage` | Passport | Identity chrome; not the dashboard API |

---

## Typical product actions (which wires fire)

| User action | 1. Client | 2. This node | 3. Mesh / others |
|-------------|-----------|--------------|------------------|
| Open Chat, list messages | `fetch` HTTP GET | Store read | none |
| Send global chat | HTTP POST `/chat/messages` | ChatManager persist | `P2P_CHAT_MESSAGE` |
| Send group chat | same HTTP | persist | `GroupChat` `CONTRACT_MESSAGE` on the group contract |
| Create group | HTTP POST `/groups` | GroupManager | `CONTRACT_PUBLISH` genesis |
| Share public group | HTTP GET/POST `…/share` | sign opaque Message | optional relay; clipboard `fabric:` |
| Apply to mission | HTTP POST `…/apply` (IPC only if HTTP needs a signed envelope) | MissionManager + audit | `MissionCreated` / claim types as implemented |
| Broadcast mission | HTTP POST `…/broadcast` | inbox on receivers | `MissionBroadcast` or group `GroupShare` |
| Site login on relay.goon.vc | IPC or Passport | `POST /sessions…` | none (Bearer stays HTTP) |
| Add a device | IPC / Android local HTTP | hub `/device-links` | then `IdentityCrossSign` + Hub `RegisterWebRTCPeer` LAN hints + `DeviceDataShare` |
| Pin a file to profile | HTTP POST `…/files/:id/pin` | Store | `GroupDataShare` pack `profile.files` |
| Sync a file to linked devices | HTTP POST `…/files/:id/cluster-sync` | Store `clusterSync` | `DeviceDataShare` `account.files` metadata + `P2P_FILE_SEND` bytes |
| Query peer files | HTTP POST `…/documents/inventory` | FabricNetwork | `P2P_INVENTORY_REQUEST` |
| Revoke / publish IdentityCrossSign (desktop) | IPC `fabric.publishCrossSign` | Peer `CONTRACT_MESSAGE` | mesh gossip |
| Read identity cluster (desktop) | IPC `fabric.identityCluster` | in-memory snapshot | none (already ingested) |
| Delivery ACK from desktop | IPC `fabric.deliveryReceipt` **or** HTTP `…/delivery/:hash/receipt` | sign | `MessageReceipt` `CONTRACT_MESSAGE` |

---

## Dual paths — keep both, do not invent a third

| Pair | Why both exist |
|------|----------------|
| IPC identity vs HTTP register | Keys vs data |
| `/sessions` vs `POST …/auth` | Passport/Hub contract vs older dashboard envelope |
| `/device-links` vs `/services/star-citizen/device-links` | Public rendezvous vs Android/loopback client |
| HTTP chat POST vs Fabric publish | Local command vs distribution |
| IPC delivery receipt vs HTTP `…/receipt` | Desktop can skip an extra round-trip; hosted/browser cannot |
| IPC `fabric.publishCrossSign` vs HTTP `/identity/cross-sign` | Node with a Peer gossips; Passport posts a pre-signed body |
| IPC `fabric.identityCluster` vs HTTP GET `/identity/cluster` | Local snapshot of Fabric-ingested edges; thin clients still HTTP |
| `/peers` vs `/services/star-citizen/peers` | SPA convenience alias |
| `POST …/events` vs `SCEventBatch` | Legacy HTTP ingest vs D-010 mesh |

New features should pick **one** cell in the rule-of-thumb table and follow an
existing pair. Adding “also over IPC” or “also over HTTPS uplink” for mesh data
is a regression of D-010.

---

## Obvious security / privacy residuals (2026-08-14)

Already gated on hosted / shared-LAN (do not regress): notes, local-groups,
Discord link, analytics/corpus/combat/activity-tree, document bytes, file pin,
world-view / guilds, settings, peers, gameplay collections (`/kills` …),
groupaudit, chat channels/messages, identity cluster (`_requestViewer` — no
operator fallback when remote auth is on). Tests:
`tests/relay/privacy-http-auth.test.js`. Living queue:
[`docs/PRIVACY_REMAINING.md`](PRIVACY_REMAINING.md).

Still open:

| Surface | Residual |
|---------|----------|
| HTTP | Loopback socket = unlocked operator. Caddy→loopback **without** `SC_MODE=server` inherits that. Android `POST /identity/session` accepts xprv on loopback. |
| HTTP | Bearer TTL is **8h**; `DELETE …/auth` revokes the presented Bearer (hosted/shared). |
| IPC | `identity:sign-envelope` / `sign-message` are a signing oracle if the dashboard is XSS’d. Reveal still requires the password. |
| Fabric | Public shoutbox (`global` / `P2P_CHAT_MESSAGE`) is **intentionally cleartext** at relays. DirectChat and `DeviceDataShare` packs are also signed plaintext. Confidential path: sealed GroupChat (opt-in `groupChatSeal`) / onion. Cluster-gate is apply-only. Stolen device key **is** the actor until `IdentityCrossSignRevoke`. GroupChat v2 is hub-blind; v1 is not. No mesh flood limit. |
| Discord | Webhook / bot traffic leaves Fabric. `shareDiscordCatalog` defaults **off** (Settings confirm on enable). |

Gating an HTTP GET does not encrypt the same bytes on Fabric. See
[`docs/THREAT-MODEL.md`](THREAT-MODEL.md).

---

## Pointers

- Handlers: `services/LiveRelay.js` (`apiHandler`, `_handle`, `_requireSession`)
- IPC: `preload.js`, `main.js`
- Mesh: `services/FabricNetwork.js`, `contracts/applicationMessageTypes.js`
- Auth bind: `functions/httpRemoteAuth.js`
- Login / link: `functions/fabricSiteLogin.js`, `functions/fabricDeviceLinkRelay.js`,
  `functions/fabricDeviceLinkLocalHttp.js`
- Decisions: `DECISIONS.md` D-010, D-011, D-012, D-013, D-019
- Hosted bind: `docs/PRODUCTION.md`
- Privacy: `docs/THREAT-MODEL.md`
