# API surfaces (IPC, HTTP, Fabric, …)
How GoonCitizen clients talk to a node — and how that node talks to the mesh.
**Last reviewed against source:** 2026-10-26 (`LiveRelay._handle`,
`functions/liveRelayPassport.js`, `functions/delegationRendezvous.js`,
`services/GoonDelegation.js`, `functions/liveRelayPeeringHttp.js`,
`functions/groupVoiceHttp.js`, `preload.js`, `services/FabricNetwork.js`).
HTTP path inventory below is complete against those handlers. Lock:
`tests/unit/httpPathInventory.test.js`.

`API.md` is stale JSDoc from the retired Hub subclass path. Trust this file,
`services/LiveRelay.js`, and tests over `API.md`.

Suite *types/services* layering (who owns a class) lives in `@fabric/core`
[`docs/TYPES_AND_SERVICES.md`](https://github.com/FabricLabs/fabric/blob/feature/rsi/docs/TYPES_AND_SERVICES.md).
This file is the *runtime* map: which wire a UI or peer should use.

Contributors changing a wire still start at [`DEVELOPERS.md`](../DEVELOPERS.md)
(PRs against `feature/rsi`, `npm test`). Product surface: [`AGENTS.md`](../AGENTS.md) §3–§4.
Second application / fork: [`APPLICATION.md`](APPLICATION.md).

---

## Rule of thumb

| Job | Surface | Do not |
|-----|---------|--------|
| Seed, unlock, sign, reveal, backup | **IPC** (`window.electronAPI.identity`) or Passport | Put keys on HTTP, in the SPA bundle, or on Fabric |
| Dashboard reads / register mutations | **HTTP** `GET\|POST /services/star-citizen/…` | Invent a parallel IPC “API” for chat/groups/missions |
| Gossip to other nodes | **Fabric Peer** AMP/`Message` on TCP/NOISE `:7777` | HTTPS batch uplink or `POST …/events` as peering |
| Passport sign-in / linked-signer *rendezvous* and mailbox | **HTTP** `/sessions` (Passport v2), `/delegations`, `/services/delegation/mailbox` (signed delegation frames only) | Mesh-flood pairing secrets |
| After linking, one actor on the mesh | **Fabric** mutual `identity` grants (`DELEGATION_GRANT`, gossiped as `DelegationShare`) then `DeviceDataShare` (`account.peers` LAN dial + Hub WebRTC *registry* for LAN hints + collection replay) | HTTPS account restore as the primary path; LiveRelay hosting ICE |
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
   │ PASSPORT_CHALLENGE       │                      │ identity / dialogs /
   ▼                          ▼                      │ fabric: / notify
Hub or LiveRelay HTTP     LiveRelay HTTP :3041  ◄────┘
 /sessions /delegations    /services/star-citizen/*
                          /sessions /delegations /services/peering
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
and does **not** host Hub JSON-RPC or WebRTC *signaling*. It **is** a JSON-RPC
*client* of public Hub `https://hub.fabric.pub` (`RegisterWebRTCPeer` /
`ListWebRTCPeers` / `SendWebRTCSignal`) so Node phone and desktop can advertise
Fabric `:7777` LAN candidates **and** Federation group-voice ICE (coordinator
only — no RTP on Hub or LiveRelay).

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
| `identity:open-protocol-url` | Handle opaque `fabric:<frame>` links: signer invitations (`DELEGATION_LINK_OFFER`) and shares |
| `identity:sign-in-relay` | Sign in to a relay origin with Passport v2 as the player key (main signs; returns a Bearer token) |
| `delegation-invitation` / `delegation-invitation:pull-pending` | Hand a scanned or opened signer invitation to the Linked signers page (pairing itself is HTTP below) |
| `fabric-group-share:*` | Prompt + ingest opaque GroupOffer / Federation invite |
| `fabric:delivery-receipt` | Sign+publish a Fabric `MessageReceipt` without HTTP |
| `fabric:identity-cluster` | Snapshot of the identity cluster built from mutual `identity` grants (no HTTP GET) |
| `fabric:presence-status` / `fabric:presence-roster` / `fabric:presence-set` / `fabric:presence-ship` | Local presence + roster in-process (SPA uses `functions/presenceClient.js`) |
| `dialog:*` | Native folder / log / fleet JSON pickers |
| `notify:show` + `notify:action` / `notify:click` | OS notifications |
| `voice:set-ptt-bind` / `voice:ptt` | Global PTT hold (default Shift+Tab); OS key-state poll while another app is focused |
| `get-service-status` / `restart-service` / `set-open-at-login` / group overlay | Shell, not the register |

The SPA still `fetch`es `/services/star-citizen/chat/messages`, `/groups`,
`/missions`, `/settings`, … even inside Electron. IPC is not a second REST API.
Mesh publishes that already have a Peer helper go through
`window.electronAPI.fabric` first (`functions/presenceClient.js`, `components/DeliverySync.js`); HTTP remains for
Passport and hosted browsers.

---

## Fabric-first clients (reduce HTTP)

Same job, portable order: **in-process Fabric (IPC) → Hub Bridge if signed wire
exists → HTTP**. Thin clients (Passport, goon.vc, hosted dashboard) have no
GoonCitizen Peer, so they stay on Hub-shaped HTTP.

| Done | Next (still HTTP from the SPA) | Stay HTTP |
|------|--------------------------------|-----------|
| Delivery `MessageReceipt` | Peers list / announce (`P2P_PEERING_OFFER` on the wire; do not IPC `AddPeer`) | `/sessions`, `/delegations` rendezvous, delegation mailbox |
| Identity cluster snapshot | Android `electronAPI.fabric.*` polyfill (today loopback HTTP) | Chat/groups/missions local command (then Fabric distribute) |
| Linked-signer account replay (`DeviceDataShare` + `account.peers` TCP dial + Hub `RegisterWebRTCPeer` LAN hints) | — | Bitcoin Hub proxy, Discord bot I/O |
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
- **Linked signers** go through the local node: the WebView calls
  `POST /services/star-citizen/delegation/…`, and the embedded Node talks to
  the rendezvous and mailbox on `relay.goon.vc` the same way desktop does.
  Scanned or opened invitations reach the page through
  `electronAPI.delegationInvitation`.

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
| Loopback (Electron / local browser / Android) | Unlocked identity is the viewer | Unlocked identity; optional Bearer. A browser write from another web origin (any `Origin` other than loopback on the port it arrived on, or `Sec-Fetch-Site: cross-site`) without a Bearer gets **403 `FOREIGN_ORIGIN`** (`isForeignBrowserWrite`) — that stops other sites and DNS rebinding from acting as the operator. `/delegations` and `/services/delegation/*` are answered before this check (signed frames only; the loopback delegate checks its own callers). Exempt: on Android, the WebView's own origins (`capacitor://`, loopback) |
| `httpSharedMode` from a non-loopback peer | Session required on the privacy-sensitive GETs that call `_requireSession` | Passport session: Bearer, or the `fabric.session` cookie from the session's own `Origin` |
| `SC_MODE=server` | Same; public Caddy→loopback **must** use server mode so the unlocked path is not inherited | Always a Passport session |

One login contract: **Passport v2** (`functions/liveRelayPassport.js` on
`@fabric/http` `passportRelyingParty` + `passportHttp`, spec in `@fabric/core`
`docs/PASSPORT.md`). `POST /sessions/challenges` issues a
`PASSPORT_CHALLENGE` for a pinned origin; the browser hands it to Passport
(which may ask the GoonCitizen desktop to sign), and `POST /sessions`
`{ assertion }` redeems the signed `PASSPORT_ASSERTION`. Browsers get an
HttpOnly `fabric.session` cookie, bound to the `fabric.passport` cookie set
with the challenge; native clients (`X-Fabric-Native: 1`, no `Origin`) get
`binding` in the challenge body and a Bearer `token` in the session body.
Pinned origins: loopback on the relay's port, `https://<FABRIC_PUBLIC_HOST>`,
and `settings.passport.origins`. A cookie counts for a write only from the
`Origin` the session was issued for. Sessions last 8 h and live in memory, so
a restart signs everyone out.

### How paths are mounted

Standalone `http.createServer` → `_handle` (desktop / Android / `SC_MODE=server`
behind Caddy). `apiHandler()` (embed) only claims `/sessions*`, `GET|OPTIONS /`,
`/services/peering*`, and `/services/star-citizen*` — root aliases such as
`/settings` and SPA `/groups/:id` are **standalone-only**.

**Prefix:** JSON APIs live at `/services/star-citizen/…`. Rows marked **also /**
are also mounted at HTTP root (`/peers` ≡ `/services/star-citizen/peers`) so
the SPA can `fetch('/settings')`. Prefer the prefix in new code.

**Desktop-only:** `settings.mode !== 'server'` — 404 on hosted `SC_MODE=server`.
**Android-only:** loopback Android node. **SPA:** `assets/index.html`, not JSON.
Unmatched paths: `404 { error, path }`. Android `OPTIONS *` → 204.

Not this process: Hub JSON-RPC / WebRTC / payjoin; Caddy `/probes/*` (agent
JSON, `SC_AGENT_STATIC_ROOT`); webpack `/assets/*` (inlined into the SPA
shell LiveRelay serves).

JSON shape is Fabric-ish (`{ type: 'Collection' | 'Group' | …, data }`), not
JSON-RPC.

### Hub-shaped (HTTP root)

Passport / Hub desktop treat `relay.goon.vc` like a Hub origin.

| Methods | Path | Notes |
|---------|------|-------|
| `POST` | `/sessions/challenges` | Passport v2 challenge for the request's pinned `Origin` (403 otherwise). Sets the `fabric.passport` binding cookie; native clients get `binding` in the body. |
| `POST` | `/sessions` | `{ assertion }` signed `PASSPORT_ASSERTION` → `{ session }` plus the `fabric.session` cookie, or `token` for native clients. 403 when a browser redeems from another origin. |
| `GET` | `/sessions` | `Accept: application/json` → 404; otherwise SPA. |
| `GET` | `/sessions/current` | `{ session }` (`identity { id, pubkey }`, `network`, `signer`, `origin`, times) or 401. |
| `DELETE` | `/sessions/current` | Ends the session and clears the cookie. |
| `POST` | `/delegations` | `{ frame }` a signed `DELEGATION_LINK_OFFER` naming this origin opens a pairing link (`@fabric/http` `fabricDelegationHttp`; keyless). |
| `GET` | `/delegations/:linkId` | The link's frames so far (offer, answer, reveal, grants). |
| `POST` | `/delegations/:linkId/frames` | `{ frame }` the next signed frame from one of the link's two keys. |
| `DELETE` | `/delegations/:linkId` | Cancel, proven by a signed fetch frame from the offerer. |
| `POST` | `/services/delegation/mailbox` | `{ frame, to }` queue a signed delegation frame (request, result, grant, revoke) for a key; frames for this app's own player go straight to it. |
| `GET` | `/services/delegation/mailbox` | A key collects its mail with a signed fetch frame in the mailbox header. |
| `OPTIONS` | `/` | Application resource contract (ARC). |
| `GET` `HEAD` `OPTIONS` | `/services/peering` | PeeringCapability + inline `OracleAttestation`. |
| `GET` `HEAD` `OPTIONS` | `/services/peering/attestation` | Attestation body only. |

### Loopback delegate (desktop)

Passport on the same computer links to GoonCitizen and asks it to sign
through `@fabric/http` `functions/fabricDelegate`, driven by the player's
own `Delegation` (`services/GoonDelegation.js`). Everything is a delegation
frame; nothing here is a session or a token. Electron main passes
`fabricSignApprover` (a native dialog, `functions/fabricSignApprovalDialog.js`,
Decline by default) for the pairing code; Android and `SC_MODE=server` link no
loopback signers.

| Methods | Path | Notes |
|---------|------|-------|
| `GET` | `/services/delegation` | Names the delegate (`?pubkey=` says whether that key holds a grant from the player). |
| `POST` | `/services/delegation/links` | `{ frame }` pairing: offer → answer, reveal → the six-digit code the native dialog asks the player to match, Passport's grant → the player's grants back. One prompt per 30 s. |
| `POST` | `/services/delegation/requests` | `{ frame }` a `DELEGATION_REQUEST` under a grant from the player. It waits in Notifications (`DelegationRequest`) until the player signs or declines. |
| `GET` | `/services/delegation/requests/:hash` | The signed result (or refusal) once answered. |

All four answer only a direct loopback socket with a loopback `Host` and a
Passport extension `Origin` (`chrome-extension://<id>` for the ids in
`settings.delegation.extensionIds` / `FABRIC_PASSPORT_EXTENSION_IDS`, or
`moz-extension://`, which the requester's grant must then name). An older
Passport gets 426. Nothing is disclosed beyond the identity key unless the
request asks and the player approves it.

### SPA HTML (standalone `GET`)

| Path | Notes |
|------|-------|
| `/` | Dashboard shell. |
| `/services/star-citizen/ui` | Same shell. |
| `/groups`, `/groups/:id` | |
| `/profiles`, `/profiles/:id` | |
| `/missions`, `/missions/:id` | |
| `/collections`, `/collections/:kind/:id` | |
| `/files`, `/files/:id` | |
| `/locations` | Catalog page. `/locations/map` and `/locations/reports` are **JSON**, not SPA. |
| `/locations/:slug` | Location page (not `map` / `reports`). |
| `/wallet/construct` | Advanced send constructor. |

Overlay HTML (not the SPA): `GET /overlay`, `GET /overlay.html`.

### Application REST (`/services/star-citizen`)

Below, paths are relative to that prefix unless **also /**. Parametric segments
use `:id` (pubkey, hash, slug, snowflake — as implemented).

#### Always mounted (hosted + desktop)

| Methods | Path | Notes |
|---------|------|-------|
| `GET` | `/` (prefix) | Compact `StarCitizen` status JSON. |
| `GET` | `/overlay/primary-group` | Session. |
| `GET` | `/rules` | Parser regex table (public). |
| `GET` | `/missiongroups` | Session. |
| `GET` | `/combat` | Session. |
| `GET` | `/analytics` | Session. |
| `GET` | `/corpus` | Session. |
| `POST` | `/corpus/sync` | Local-player; hosted 400. |
| `POST` | `/corpus/import` | Local-player; hosted 400. |
| `POST` | `/corpus/remove` | Local-player. |
| `GET` | `/fs` | Directory listing; hosted 400. Session. |
| `GET` | `/activity-tree` | Session. |
| `POST` | `/activity-tree/publish` | |
| `GET` | `/monitor` | Session. Includes `loginfo`. |
| `GET` | `/feed` | Session. |
| `GET` | `/identity/cluster` **also /** | Session. Snapshot + `pending`. |
| `GET` `POST` | `/identity/cluster/sync` **also /** | Collection export / ingest / `{ publish }`, `{ mesh: true }`, `{ dial }`. |
| `POST` | `/identity/session` **also /** | **Android-only**, loopback: restore xprv/mnemonic or `{ lock }`. |
| `GET` `POST` `DELETE` | `/discord/link` **also /** | Per-session Discord ↔ Fabric link. |
| `GET` | `/chat/channels` | Session. |
| `GET` `POST` | `/chat/messages` | Session; hosted POST needs Schnorr envelope. |
| `POST` | `/chat/messages/:id/pin` | |
| `POST` | `/chat/messages/:id/receipt` | Delivery ACK (HTTP fallback). |
| `GET` | `/delivery/:hash` | Delivery summary (no `_requireSession`). |
| `POST` | `/delivery/:hash/receipt` | Desktop prefers IPC `fabric.deliveryReceipt`. |
| `GET` `POST` | `/groups` | Hosted GET lists public (+ member) groups only. |
| `GET` `POST` | `/groups/:id/share` | Opaque `fabric:` GroupOffer. |
| `POST` | `/groups/share/ingest` | |
| `GET` | `/voice` | Local group-voice snapshot (Hub signaling via hub.fabric.pub). |
| `GET` | `/voice/signals` | Drain inbound Hub WebRTCSignal for the renderer mesh. |
| `POST` | `/voice/leave` | Leave the current Fabric voice room. |
| `POST` | `/voice/ptt` | Optional speaking presence while PTT is held. |
| `GET` `POST` | `/groups/:id/voice` | Room snapshot; POST join/leave/signal/speaking on subpaths. |
| `POST` | `/groups/:id/voice/join` | Members only. Publishes GroupVoiceJoin + Hub RegisterWebRTCPeer. |
| `POST` | `/groups/:id/voice/leave` | |
| `POST` | `/groups/:id/voice/signal` | Opaque SDP/ICE to Hub SendWebRTCSignal. |
| `POST` | `/groups/:id/voice/speaking` | Ephemeral GroupVoiceSpeaking. |
| `POST` | `/groups/:id/invites` | FederationContractInvite. Same signed AMP bytes as the `fabric:` clipboard clip; mesh relay does not re-sign. Direct invites set `inviteePubkey` (accept/ingest gated to that key). |
| `POST` | `/groups/:id/invites/:inviteId/accept` | |
| `POST` | `/groups/:id/invites/:inviteId/reject` | |
| `GET` `PUT` | `/groups/:id` | |
| `GET` | `/groups/:id/fleets` | |
| `GET` | `/groups/:id/statechain` | |
| `POST` | `/groups/:id/members` | Propose add/remove. |
| `GET` | `/groups/:id/proposals` | |
| `POST` | `/groups/:id/proposals/:id/votes` | |
| `GET` `POST` | `/groups/:id/applications` | |
| `POST` | `/group-applications/:id/decision` | |
| `GET` | `/groupaudit` | Session. |
| `GET` | `/groups/:id/wallet` | Named federation vault (core `Federation`): signers k-of-n, previous vaults. |
| `GET` `POST` | `/groups/:id/withdrawals` | Any signer requests `{ destinationAddress, amountSats, feeSats }`; signs it too. |
| `POST` | `/groups/:id/withdrawals/:id/signatures` | Signer approves; broadcast at threshold. |
| `GET` `POST` | `/notes` | Session. |
| `POST` | `/notes/:id/share` | |
| `POST` | `/notes/:id/pin` | |
| `GET` `PUT` | `/notes/:id` | |
| `GET` `POST` | `/local-groups` | Session. |
| `POST` | `/local-groups/:id/members` | |
| `DELETE` | `/local-groups/:id/members/:actor` | |
| `GET` `PUT` `DELETE` | `/local-groups/:id` | |
| `GET` `POST` | `/missions` | Hosted GET membership-filters `groupId`. |
| `GET` | `/missions/:id` | |
| `GET` | `/missions/:id/applications` | |
| `POST` | `/missions/:id/cancel` | |
| `POST` | `/missions/:id/apply` | |
| `POST` | `/missions/:id/broadcast` | |
| `GET`/`POST` | `/missions/:id/share` | Opaque `fabric:` MissionBroadcast clip (clipboard + optional mesh relay; creator-only) |
| `POST` | `/missions/:id/claim` | |
| `GET` `POST` | `/missions/:id/escrow` | |
| `POST` | `/missions/:id/payout` | |
| `GET` | `/missionbroadcasts` | |
| `POST` | `/missionbroadcasts/:id/accept` | |
| `POST` | `/missionbroadcasts/:id/ignore` | |
| `GET` | `/inbox` | |
| `POST` | `/inbox/:id/dismiss` | alias `ignore`; not for mission broadcasts. |
| `GET` | `/applications` | Hosted: Bearer. |
| `POST` | `/applications/:id/decision` | |
| `GET` | `/claims` | Hosted: Bearer. |
| `POST` | `/claims/:id/validate` | |
| `GET` | `/validations` | Hosted: Bearer. |
| `GET` | `/audit` | Hosted: Bearer. Mission register audit. |
| `GET` | `/wallet` | Escrow summary + bitcoin runtime (no adminToken). |
| `GET` | `/activities` `/players` `/logins` `/vehicles` `/kills` `/incaps` `/deaths` `/missionlog` `/notifications` `/messages` | Session. Gameplay collections (`/messages` ≠ chat). |
| `POST` | same collections except `messages`, `logins`, `notifications`, `incaps`, `deaths` | Unsigned local; hosted needs `ingest.httpEnable`. |
| `POST` | `/events` | Legacy signed batch; **403 unless** `ingest.httpEnable` / `SC_HTTP_INGEST=1`. Not peering. |
| `GET` `POST` | `/documents` | Gated `settings.documents.enable`. Session. |
| `POST` | `/documents/inventory` | `P2P_INVENTORY_REQUEST`. |
| `GET` | `/documents/offers` | Session. |
| `GET` | `/documents/:id` | Session; includes bytes when stored. |
| `POST` | `/documents/:id/publish` | |
| `POST` | `/documents/:id/cluster-sync` | |
| `POST` | `/documents/:id/purchase` | **501** Hub-only. |
| `POST` | `/documents/:id/claim` | **501** Hub-only. |
| `GET` | `/bitcoin/status` `/bitcoin/wallet` `/bitcoin/receive` `/bitcoin/transactions` `/bitcoin/utxos` `/bitcoin/faucet` | Hub HTTP **proxy**; `settings.bitcoin.enable`. |
| `POST` | `/bitcoin/send` `/bitcoin/faucet` | Session. Token injected server-side. |

Linked signers (`services/GoonDelegation.js`; session; 503 `{ locked }` while the identity is locked, and on `SC_MODE=server`, which hosts the rendezvous and mailbox but links no signers):

| Methods | Path | Notes |
|---------|------|-------|
| `GET` | `/delegation` | `LinkedSigners`: each signer with the grants given and received, whether it is the same player, the pairing in progress, and requests waiting for an answer. |
| `POST` | `/delegation/invitations` | `{ hub }` open a pairing on that rendezvous and return the `fabric:` invitation to show or scan. |
| `POST` | `/delegation/invitations/accept` | `{ invitation }` answer someone else's invitation. |
| `POST` | `/delegation/pairing/confirm` | `{ scopes }` after both screens show the same six-digit code: grant those scopes and wait for the other side's grant. |
| `POST` | `/delegation/pairing/cancel` | |
| `POST` | `/delegation/requests/:hash/sign` | Answer a `DELEGATION_REQUEST` (also from Notifications). |
| `POST` | `/delegation/requests/:hash/decline` | |
| `POST` | `/delegation/grants/:hash/revoke` | Signs a `DELEGATION_REVOKE` and mails it to the grantee. |
| `POST` | `/delegation/signers/:pubkey/unlink` | Revokes every grant to that signer. |

#### Desktop-only (`mode !== 'server'`)

First block: settings / peers / presence / Fabric AMP log. Second block:
Discord catalog, search, files, Game.log browse, locations, fleets, snapshots.

| Methods | Path | Notes |
|---------|------|-------|
| `GET` | `/settings` **root only** | Session. Runtime omits `adminToken`. |
| `PUT` | `/settings/:name` **root only** | Allowlisted keys in `functions/settingsStore.js`. |
| `PUT` | `/settings/discord/secrets` **root only** | |
| `POST` | `/settings/primaryGroup/from-message` **root only** | |
| `GET` `POST` | `/peers` **also /** | Roster / AddPeer. Session. |
| `POST` | `/peers/announce` **also /** | `P2P_PEERING_OFFER`. |
| `POST` | `/peers/restore-seeds` **also /** | |
| `GET` `POST` `DELETE` | `/peers/:id` **also /** | POST patches enabled/label/shareLogs. |
| `GET` | `/profile` **also /** | Local PeerProfile. Session. Desktop SPA presence is Fabric-first; this is still HTTP. |
| `GET` | `/profiles/:id` **also /** | Session. |
| `GET` `PUT` | `/presence` **also /** | Desktop SPA: `presenceClient` IPC first. |
| `PUT` | `/presence/ship` **also /** | |
| `GET` | `/presence/roster` **also /** | |
| `GET` `DELETE` | `/fabric/messages` **also /** | `?format=collection` → `FabricMessageCollection`. |
| `POST` `DELETE` | `/fabric/messages/clear` **also /** | |
| `POST` | `/fabric/messages/pause` **also /** | |
| `POST` | `/fabric/messages/resume` **also /** | |
| `POST` | `/fabric/messages/decode` **also /** | |
| `GET` | `/fabric/messages/tree` **also /** | Discord Request→Claim→Response. |
| `GET` | `/fabric/messages/:hash` **also /** | |
| `GET` | `/discord/links` **also /** | All Discord↔Fabric links. |
| `GET` | `/discord/guilds` **also /** | |
| `GET` | `/discord/guilds/:id/channels` **also /** | |
| `GET` | `/discord/guilds/:id/members` **also /** | |
| `GET` | `/discord/channels/:id` **also /** | |
| `GET` | `/discord/coordination` **also /** | |
| `GET` | `/discord/coordination/:requestId` **also /** | |
| `GET` | `/world-view` **also /** | Aliases `/discord/world-view`. |
| `GET` | `/search` **also /** | App search. Session. |
| `GET` | `/network/observe` **also /** | Hub HTTP observe. Session. |
| `GET` | `/collections/:kind/:id` | Prefix only. Session. |
| `GET` | `/files/:id` | Prefix only. |
| `POST` | `/files/:id/pin` | |
| `POST` | `/files/:id/cluster-sync` | |
| `GET` | `/loginfo` `/logslice` | Session. Game.log path + byte window. |
| `GET` `POST` | `/reparse` | Session. |
| `GET` | `/locations` **also /** | Public location catalog. |
| `GET` | `/rsi/orgs/:sid` | Session. Public RSI org page snapshot. |
| `GET` | `/rsi/claim` | Session. Biography token for the unlocked Fabric key. |
| `GET` | `/rsi/citizens/:handle` | Session. Public RSI citizen page snapshot. |
| `GET` | `/rsi/citizens/:handle/verify` | Session. `?pubkey=` checks the biography token. |
| `GET` | `/locations/map` **also /** | Public starmap JSON (`?system=`, `?view=galaxy`, `?view=body&body=`). |
| `GET` | `/assets/map/manifest.json` · `/assets/map/tiles/*.png` | Allowlisted map tiles (CC0 / procedural). |
| `GET` | `/assets/scripts/universe-explorer.js` | Lazy Three.js explorer bundle. |
| `GET` | `/locations/reports` | Prefix only. Session. |
| `GET` | `/locations/:slug` | Prefix only. Session. |
| `GET` | `/ships` **also /** | Public ship catalog. |
| `GET` `POST` | `/fleets` **also /** | Session. Personal fleets. |
| `GET` | `/fleets/samples` **also /** | |
| `POST` `PUT` | `/fleets/:id/ships` **also /** | |
| `DELETE` | `/fleets/:id/ships/:slug` **also /** | |
| `GET` `PUT` `PATCH` `DELETE` | `/fleets/:id` **also /** | |
| `POST` | `/fleets/:id/share` **also /** | |
| `GET` `DELETE` | `/snapshots` | Session. |
| `GET` | `/snapshots/:id/image` | JPEG. Session. |

---

## 4. Fabric Peer (mesh)

**Files:** `services/FabricNetwork.js`, `contracts/applicationMessageTypes.js`,
`contracts/gooncitizen.js`, `contracts/gooncitizenGroup.js`.
**Transport:** AMP `Message` over TCP/NOISE. Default seeds
`hub.fabric.pub:7777`, `hub.goon.vc:7777`, `relay.goon.vc:7777`. Opt-in log share (D-017).

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
`DelegationShare` (a signed `identity` grant or revoke), `DeviceDataShare`, Discord/Lookup
Request→Claim→Response, `PeerProfile`, `Presence`, …

**Per-Group Federation genesis** (`GROUP_MESSAGE_TYPES`): `GroupChat`,
`GroupChange` (+ proposal/vote), `GroupShare`, `GroupActivityTree`,
`FleetShare`, `FederationContractInvite` / Response, journal catch-up,
capability / withdrawal types. The `ContractWithdrawal*` names stay only
because they are part of the group contract id; nothing sends them.

**Group wallets** are core named federations (`@fabric/core/types/federation`,
`services/GroupWallets.js`): bare `{ contract: federationId, type, … }`
bodies — `FederationWithdrawalRequest` / `Signature` / `Broadcast`,
`FederationSync` — the same frames Hub and Passport members exchange, trusted
only by the verified frame author.

Chat storage stays `{ channel, body, handle }` in the Store regardless of wire
type (`global` vs `group:<id>` vs `discord:`).

---

## 5. `fabric:` URLs and clipboard shares

| Form | Meaning | Completes via |
|------|---------|----------------|
| `fabric:<frame>` `DELEGATION_LINK_OFFER` | Invitation to link a signer (D-022) | IPC `delegationInvitation` → Linked signers → `POST …/delegation/invitations/accept` |
| `fabric:<frame>` (base64url) | Opaque AMP `Message` (GroupOffer / invite / MissionBroadcast) (D-019). Read with core `decodeFabricUri`: a bad body hash or author signature is refused | IPC `groupShare` or `POST …/groups/share/ingest` `{ protocolUrl }` |
| `fabric:<frame>` `PASSPORT_CHALLENGE` / `PASSPORT_ASSERTION` | Passport v2 sign-in to any HTTPS or loopback page | Passport ↔ page (`postMessage` over a `MessagePort`) |
| `fabric:<frame>` `DELEGATION_REQUEST` / `DELEGATION_RESULT` | A linked signer asks this player to sign (a Passport challenge or a Fabric message) | loopback `POST /services/delegation/requests` or the mailbox → Notifications |

These are **not** a third REST. They are envelopes that land on HTTP rendezvous
or Fabric ingest.

---

## 6. Passport / Hub browser (`postMessage`)

Fabric Passport does not use GoonCitizen IPC. A page gets a challenge from
its own origin (`POST /sessions/challenges`), hands it to Passport
(`@fabric/http` `functions/passportPage`), and posts the signed assertion back
to `POST /sessions`. Passport signs only for the origin the browser reports,
as its own identity key or — once GoonCitizen is a linked signer with a
`passport` grant (paired over `POST /services/delegation/links`) — as the
player key, by sending a `DELEGATION_REQUEST` to the loopback delegate above.

The hosted dashboard then rides the `fabric.session` cookie
(`components/PassportSignIn.js`). The dashboard origin never holds the player
seed.

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
| Share mission | HTTP GET/POST `…/missions/:id/share` | sign opaque MissionBroadcast | optional relay; clipboard `fabric:`; Import… → offer |
| Apply to mission | HTTP POST `…/apply` (IPC only if HTTP needs a signed envelope) | MissionManager + audit | `MissionCreated` / claim types as implemented |
| Broadcast mission | HTTP POST `…/broadcast` | inbox on receivers | `MissionBroadcast` or group `GroupShare` |
| Sign in on relay.goon.vc | Passport, or IPC `identity.signInToRelay` | `POST /sessions/challenges` + `POST /sessions` | none (cookie / Bearer stay HTTP) |
| Link a signer | HTTP `…/delegation/invitations[/accept]`, `…/pairing/confirm` | rendezvous `/delegations` on the hub | mutual `identity` grants as `DelegationShare` + Hub `RegisterWebRTCPeer` LAN hints + `DeviceDataShare` |
| Pin a file to profile | HTTP POST `…/files/:id/pin` | Store | `GroupDataShare` pack `profile.files` |
| Sync a file to linked signers | HTTP POST `…/files/:id/cluster-sync` | Store `clusterSync` | `DeviceDataShare` `account.files` metadata + `P2P_FILE_SEND` bytes |
| Query peer files | HTTP POST `…/documents/inventory` | FabricNetwork | `P2P_INVENTORY_REQUEST` |
| Revoke a grant / unlink a signer | HTTP `…/delegation/grants/:hash/revoke`, `…/signers/:pubkey/unlink` | `DELEGATION_REVOKE` | mailbox to the grantee; `DelegationShare` gossip for `identity` |
| Answer a signing request | Notifications or HTTP `…/delegation/requests/:hash/sign` | `DELEGATION_RESULT` | loopback reply or mailbox |
| Read identity cluster (desktop) | IPC `fabric.identityCluster` | in-memory snapshot | none (already ingested) |
| Delivery ACK from desktop | IPC `fabric.deliveryReceipt` **or** HTTP `…/delivery/:hash/receipt` | sign | `MessageReceipt` `CONTRACT_MESSAGE` |

---

## Dual paths — keep both, do not invent a third

| Pair | Why both exist |
|------|----------------|
| IPC identity vs HTTP register | Keys vs data |
| `/delegations` vs `/services/star-citizen/delegation` | Keyless public rendezvous vs this player's own participant |
| HTTP chat POST vs Fabric publish | Local command vs distribution |
| IPC delivery receipt vs HTTP `…/receipt` | Desktop can skip an extra round-trip; hosted/browser cannot |
| IPC `fabric.identityCluster` vs HTTP GET `/identity/cluster` | Local snapshot of the grant-built cluster; thin clients still HTTP |
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
| HTTP | Sessions last **8h**; `DELETE /sessions/current` ends one (hosted/shared). Sessions are in memory: a restart signs everyone out. |
| HTTP | The loopback delegate takes only Passport extension origins; `moz-extension://` ids are random per install, so on Firefox another extension can raise pairing prompts (one per 30 s). Signing still needs a request signed by a key holding a grant from the player. |
| IPC | `identity:sign-envelope` / `sign-message` are a signing oracle if the dashboard is XSS’d. Reveal still requires the password. |
| Fabric | Public shoutbox (`global` / `P2P_CHAT_MESSAGE`) is **intentionally cleartext** at relays. DirectChat and `DeviceDataShare` packs are also signed plaintext. Confidential path: sealed GroupChat (opt-in `groupChatSeal`) / onion. Cluster-gate is apply-only. A stolen linked signer's key **is** the actor until the player revokes its grant. GroupChat v2 is hub-blind; v1 is not. No mesh flood limit. |
| Discord | Webhook / bot traffic leaves Fabric. `shareDiscordCatalog` defaults **off** (Settings confirm on enable). |

Gating an HTTP GET does not encrypt the same bytes on Fabric. See
[`docs/THREAT-MODEL.md`](THREAT-MODEL.md).

---

## Pointers

- Handlers: `services/LiveRelay.js` (`apiHandler`, `_handle`, `_requireSession`)
- HTTP inventory lock: `tests/unit/httpPathInventory.test.js`
- IPC: `preload.js`, `main.js`
- Mesh: `services/FabricNetwork.js`, `contracts/applicationMessageTypes.js`
- Auth bind: `functions/httpRemoteAuth.js`
- Login / link: `functions/liveRelayPassport.js`, `functions/delegationRendezvous.js`,
  `services/GoonDelegation.js`
- Decisions: `DECISIONS.md` D-010, D-012, D-019, D-021, D-022
- Hosted bind: `docs/PRODUCTION.md`
- Privacy: `docs/THREAT-MODEL.md`
