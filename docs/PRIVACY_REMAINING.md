# Privacy remaining work (for future agents)
Living queue from the 2026-08 stack privacy eval. **Do not treat this as
authorization to change mesh defaults** without the product owner. Detail and
closed HTTP gates: [SECURITY.md](../SECURITY.md), [THREAT-MODEL.md](THREAT-MODEL.md),
[API-SURFACES.md](API-SURFACES.md). Canvas snapshot:
`fabric-stack-privacy-eval.canvas.tsx` (Cursor canvases).

**Last advanced:** 2026-08-15 — presence Fabric-first (desktop IPC, HTTP
fallback) + shared-LAN session gates on Game.log browse (`/loginfo`,
`/logslice`, `/reparse`), personal `/fleets`, and Discord `/coordination`.
Earlier 2026-08-15: shoutbox label/docs pass. 2026-08-14: HTTP privacy gates
+ Settings confirms; core `MESH_CHAT.md` + `fabricChatKind`; Hub ActivityStream
note; GroupChat seal recommended. Also: shared HTTP WS token fail-closed;
Bearer TTL 8h + revoke; Hub prefers `X-Fabric-Xpub` / body over `?xpub=`.
Bind warning + snapshots/offers/groups locks.

## Mesh chat direction (do not regress)

- **Gossip/peering first** — topology budgets stay separate from chat flood.
- **Shoutbox stays public** — cleartext `P2P_CHAT_MESSAGE`; rate-limited.
- **Encrypted wave 1** — sealed GroupChat (participant) + onion `SendOnion`;
  future contract messaging follows seals (core `docs/MESH_CHAT.md`).
- Classifier: `@fabric/core/functions/fabricChatKind` (via `fabricChatText`).

## Done this pass (do not regress)
- Hosted / shared-LAN `_requireSession` on `GET` gameplay collections
  (`/kills`, `/deaths`, `/players`, …), `/groupaudit`, `/chat/messages`,
  `/chat/channels`, `/identity/cluster` (viewer via `_requestViewer`).
- Earlier: settings / peers / guilds / notes / analytics / documents / Discord
  link (`tests/relay/privacy-http-auth.test.js`).
- Follow-up lock (same suite): unauth settings / snapshots / document offers
  401; unauth `GET /groups` does not dump private groups; bitcoin runtime omits
  `adminToken`; `isLoopbackRequest` ignores `X-Forwarded-For`. Overlay
  `/overlay/primary-group`, `/missiongroups`, presence roster/ship, Fabric
  message-log, Game.log browse (`/loginfo` `/logslice` `/reparse`), personal
  fleets, and Discord coordination HTTP require a session (or are unmounted
  on hosted). `/ships` catalog stays public.
- `shareDiscordCatalog` defaults **off**. `/lookup` omits local tag names.
- Non-loopback HTTP bind `console.warn`s (`functions/httpBindWarning.js`).
- Operator confirm when enabling high-impact privacy toggles in Settings
  (and when disabling `groupChatSeal`).
- Mesh chat model docs + Hub shoutbox label + seal recommendation copy.

## Still open (priority order)

### Product / mesh (heavy — needs owner go-ahead)
1. **DirectChat E2E or `P2P_FORWARD`** with participant seal (pair ARC).
2. **Default GroupChat seal** — currently opt-in (`groupChatSeal`); flipping
   default breaks cleartext meshes until all members upgrade. UI now
   **recommends** seal and confirms before turning it off.
3. **Drop GroupChat seal v1** tip-HKDF once the mesh no longer emits it.
4. **Mesh chat flood / anonymous inbound rate limits**.
5. **Registry-contract global chat** (Hub `PLAN.md`) — encrypted-by-default
   private path; keep shoutbox as public wave 0 (see core `docs/MESH_CHAT.md`).
6. ~~Treat Hub shoutbox as non-confidential forever~~ — **locked**: shoutbox
   is public; confidential = seals / onion. Do not encrypt shoutbox flood
   without suite migration.

### Hub / HTTP suite
7. **Admin token out of `localStorage`** — OS keychain / short-lived refresh
   (Hub browser).
8. **Hub durable `messages/*.json` + access.log retention policy** (TTL /
   rotation); Tombstone does not erase disk history.
9. **Peering HTTP claim fingerprinting** — optional strip of detailed
   `/services/peering` fields on hostile networks.
10. **Login / device-link redeem possession proof** — bind `sessionId` into
   attest messages (http + Passport + GC). Tracked in Hub/`@fabric/http`
   OUTSTANDING.
11. **Production shared Hub:** keep `FABRIC_WS_REQUIRE_TOKEN=1` +
    `webrtc.requireTransportAuth` in real env (example file now documents it).

### GoonCitizen residuals
11. ~~**Bearer session revoke + shorter TTL**~~ — Bearer TTL is **8h**; `DELETE …/auth` revokes the presented Bearer.
12. **IPC signing oracle** — `identity:sign-envelope` if dashboard XSS’d
    (Electron). Reveal still needs password.
13. ~~**Caddy → loopback without `SC_MODE=server`**~~ — production docs warn;
    LiveRelay also `console.warn`s a non-loopback bind. Still requires
    `SC_MODE=server` on the public origin (do not “fix” into silence).
14. **Discord** — bot host still stores inbound traffic locally; Discord Inc.
    sees content. Mesh DiscordRequest stays announce-channel coord-only —
    do not widen without seals.
15. ~~**Fabric message log / Game.log browse / fleets / Discord coordination**~~
    — shared-LAN `_requireSession` on `GET|DELETE …/fabric/messages` (and
    clear/pause/resume/decode/tree), `/loginfo`, `/logslice`, `/reparse`,
    `/fleets*`, `/discord/coordination`. Hosted `SC_MODE=server` does not
    mount the desktop viewer. Loopback tests stay 200. `/ships` stays open.
    Optional redact of Discord/content fields for **exported** auditor dumps
    remains open.

### Passport
16. **Master key in `chrome.storage.local`** — not a secure enclave; long-term
    WebCrypto / HW-backed wrap.
17. **Narrow `https://*/*` host / content-script match** over time without
    breaking site login.

## Operator footguns (keep documenting, do not “fix” into silence)
- Enabling `shareLogsGlobal` / `shareDiscordCatalog` / `fabricAdvertiseHost` /
  `broadcastPeering`.
- Assuming `sensitive: true` encrypts chat.
- Leaving Hub HTTP on `0.0.0.0` without WS token + reverse proxy.

## Pointers for agents
- Gates live in `services/LiveRelay.js` (`_requireSession`, `_requestViewer`,
  `_enforceRemoteAuth`).
- Tests: `tests/relay/privacy-http-auth.test.js`.
- Core model: `@fabric/core` `PRIVACY.md` / `docs/P2P_FORWARD.md`.
- Hub WS: `settings.websocket` / `FABRIC_WS_REQUIRE_TOKEN` /
  `deploy/env.relay.goon.vc.example`.
