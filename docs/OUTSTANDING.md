# Outstanding (security-first)
Living queue for this repo. Detail: [SECURITY.md](../SECURITY.md), [THREAT-MODEL.md](THREAT-MODEL.md). Suite march: [@fabric/core `docs/PRODUCTION_MARCH.md`](https://github.com/FabricLabs/fabric/blob/feature/rsi/docs/PRODUCTION_MARCH.md).

**Last reviewed:** 2026-09-07 — **Trusted mesh weeks:** ready for a small set of
known operators using live Fabric seeds for chat / Groups / mission gossip
(log share off, `groupChatSeal` on, HTTP loopback). Checklist:
[THREAT-MODEL.md](THREAT-MODEL.md) + [DEVELOPERS.md](../DEVELOPERS.md). Quick wins:
`settings/example.js` `bitcoin.enable` default **false**; hosted `GET …/missions`
requires a session. **Not** closed: Hub live RSS/NOISE pin redeploy, `--accept`
key alignment, mesh flood limits, DirectChat confidentiality.

**Prior:** 2026-08-25 — suite quick-win pass on top of `00bb238` (Voice
activity + invitation expiry). Full `npm test` was **green: 1244 pass / 0 fail**
at the 2026-08-24 audit; this cut adds invite epoch-0 guards, Discord activity
`created` positive-ms, and crypto claim jitter (see Closed). Prior scan notes
below stand unchanged.

Beware measuring this gate by one layer: `npm test` prints **five** separate
summaries and a non-zero `fail` in any of them is a red gate. The unit+fabric
block alone reports 489, which is easy to mistake for the whole suite.

**Prior review:** 2026-08-20 ([downstream scan](https://relay.goon.vc/downstream.agents.md) **10:39Z**). Live Hub **`6bf825d`** (~61 m, restarts **542**, FATAL **317 +0**): heap **~82 MiB**, RSS **~1.7 GiB** via **`external`/`arrayBuffers`**. RSI **`0e07721`**: restarts **2 +0**, **0** FATAL, heap **~1.77 GiB @ ~94%**, RSS **~12.3 GiB**. This tree lockfile (Wave 2 pin): core **`88f766c28`** ([#186](https://github.com/FabricLabs/fabric/pull/186)), http **`ca27d14`**, hub **`c184907`**, discord **`98a86b8`**. Passport lockfile same core/http tips. Device-link `cancelDeviceLinkSession` fetch rejection is `ok: false` (aligned with http [#69](https://github.com/FabricLabs/fabric-http/pull/69) CodeRabbit). `tests/fabric/peer-host.test.js` compares shoutbox `chatTextOf` by behavior across nested `@fabric/core` copies (npm git-dep), not function identity.

## Blockers before LAN / hosted dashboard claims
1. ~~**`httpSharedMode` mutating APIs**~~ — non-loopback writes need Schnorr/Bearer (`functions/httpRemoteAuth.js`). Hosted/shared-LAN **GETs** for notes, local tags, analytics/corpus/combat/activity-tree, documents, Discord link/guilds, settings, peers, gameplay collections (`/kills` …), groupaudit, chat list/channels, and identity cluster require a session (`_requireSession` / `_requestViewer`). Tests: `tests/relay/privacy-http-auth.test.js`. Residual HTTP notes: [PRIVACY_REMAINING.md](PRIVACY_REMAINING.md).
2. **Chat confidentiality** — public shoutbox + DirectChat are signed plaintext vs relays (shoutbox by design; [THREAT-MODEL.md](THREAT-MODEL.md), core `MESH_CHAT.md`). GroupChat v2 participant seal is hub-blind; v1 tip-HKDF is not.
3. **Identity cluster** — a stolen device key **is** the actor until `IdentityCrossSignRevoke`. Union-find is `@fabric/hub/functions/identityCluster` via the local re-export.

## Next slices
- [x] Mesh `GroupChange` ingest uses the AMP signer (not `change.actor`); strangers cannot add themselves or spoof the creator. Same actor gates as `proposeChange`. Residual: a **member** can still gossip `member.add` without a threshold vote (proposal path).
- [ ] DirectChat E2E or `P2P_FORWARD` (pair ARC + participant seal).
- [ ] Message `parent` — originate chain is on (`FabricNetwork._signMessage`, D-020).
  Residual: per-journal / per-channel tips; Hub/http originate; do not drop
  inbound genesis zeros until the mesh emits parents.
- [ ] Drop GroupChat seal v1 once the mesh no longer emits it.
- [ ] Bearer revoke + shorter TTL for hosted sessions.
- [ ] Bind device-link `sessionId` into attest messages with http/Passport (suite redeem possession proof).
- [ ] Mesh chat flood / anonymous inbound rate limits.
- [x] Shared-bind GET privacy (settings / Discord catalog / peers / gameplay collections / chat list / snapshots / document offers / private groups / overlay / missiongroups / presence roster / Fabric message log / Game.log browse / personal fleets / Discord coordination) — advanced 2026-08-15; see [PRIVACY_REMAINING.md](PRIVACY_REMAINING.md) for mesh/Hub leftovers. Tests: `tests/relay/privacy-http-auth.test.js`. `X-Forwarded-For` is not loopback (`tests/unit/androidLocalNode.test.js`). Non-loopback HTTP bind warns (`functions/httpBindWarning.js`). Desktop SPA presence is Fabric-first (`functions/presenceClient.js`); HTTP remains for thin clients.
- [x] Core pin refresh after [#185](https://github.com/FabricLabs/fabric/pull/185) review follow-ups (`fabricIdentityAccountPath`; inventory JSON `type: 98` cannot smuggle a peering offer). `masterSeedVault.deviceAccountPath` uses that helper.
- [x] Pin `@fabric/core` to [#186](https://github.com/FabricLabs/fabric/pull/186) tip **`88f766c28`** (handshake-bus + gossip catalog + entropy harden). Live Hub still **`f63a33f`** until operator redeploy.
- [ ] Playnet Hub **RSS / NOISE (P0)** ([scan 2026-08-20T10:39Z](https://relay.goon.vc/downstream.agents.md): crash loop still broken — restarts **542**, FATAL **317 +0**, Hub **`6bf825d` ~61 m**; heap **~82 MiB**, RSS **~1.7 GiB** from **`external`/`arrayBuffers`**, named retainers flat). Live core **`f63a33f`** still lacks handshake-bus cleanup (`noiseHandshakeListeners` **null**; MaxListeners 65>64 on this PID). Local pin **`88f766c28`** has the wrapper — Hub redeploy closes #1. RSI **0** FATAL, RSS **~12.3 GiB**, heap **~1.77 GiB @ ~94%** (closed-stream / oversized-frame spam `140736 > 4096`). Hub↔RSI hairpin still missing. Do not raise `--max-old-space-size`. `--accept` still fails (`adminToken invalid`) until Hub `_rootKey` is this operator key.

## Closed / already in tree (do not regress)
- **Map backgrounds + galaxy / 3D explorer scaffold (2026-08-31).** Procedural
  + CC0 tiles under `assets/map/` (not RSI art); `GET /assets/map/*` allowlist;
  continuous `UniverseMap` browser (universe → system → body, 2D/3D) with
  `layoutGalaxy` / `layoutBody` and catalog POIs on surfaces.
- **starmap.space surface coords (2026-09-01).** Cached Meridian/Eureka OC + POI
  JSON under `data/starmap/` (`npm run refresh:starmap-space`); `layoutBody`
  prefers real lat/lon; BodyMap drag-rotates longitude. Credit: starmap.space.
- **Per-body terrain tiles (2026-09-01).** Equirectangular `tiles/bodies/<slug>.png`
  for each known orbital body (`functions/bodyTerrain.js`); BodyMap default is
  flat terrain map for POI/fleet browsing. Procedural stand-ins — not RSI art.
- **Invite / Discord / claim entropy quick wins (2026-08-25).**
  `resolveShareExpiresAtMs` and the federation invite shim ignore non-positive
  `invitedAt` / `offeredAt` (same `positiveEpochMs` rule as http). Discord
  `requestFromDiscordActivity` rejects epoch-0 `object.created`. LiveRelay
  Discord/lookup claim jitter uses `@fabric/core` `randomUnit`; loopback DM
  synthetic ids use `crypto.randomBytes`. Tests: `tests/unit/inviteExpiry.test.js`,
  `tests/unit/discordContract.edges.test.js`.
- **Stale tests that asserted pre-hardening behaviour** (gate was red on four).
  All four encoded an older contract, so the fix was the assertion, not the
  service:
  - `tests/relay/ingest.test.js` (×2) read back an ingested batch with
    unauthenticated `GET …/kills` / `…/players`. Hosted gameplay GETs are
    session-gated per blocker 1 and correctly answer **401**, so `body.data` was
    `undefined`. Both now `POST …/auth` with a signed login envelope and read
    with `Authorization: Bearer`, matching `tests/relay/privacy-http-auth.test.js`.
  - `tests/relay/chat.test.js` asserted "anyone can read global" with no
    session. Rewritten to assert the property that actually holds — anon is
    **401**, any *authenticated* viewer reads `global` — which widens coverage
    instead of relaxing it.
  - `tests/ui/map-page.test.js` matched `/Browse the Stanton/` after the Map
    copy became "Browse Stanton / Pyro / Nyx".
  Do not "fix" these by loosening the hosted session gate.
- **IdentityCrossSign lockstep is now enforced, not just documented.** The
  browser-safe local copy exists so the dashboard webpack bundle never pulls
  `@fabric/core`, but "keep lockstep" was a comment guarded by a single
  happy-path assertion. `tests/fabric/expectations.test.js` now diffs the whole
  shared surface against core: all four canonical prefixes/types, the **revoke**
  build/parse pair (silent drift there means device revocations stop verifying
  mesh-wide), `isCrossSignType`, and a core-exports ⊆ local-exports check so
  core adding an export fails here. `coerceCrossSignObject` stays local-only
  (core has no equivalent) and is a candidate to push upstream.
- **Invite expiry is upstream** (`@fabric/http` `resolveFederationInviteExpiresAt`
  / `normalizeInviteExpiresAtMs` / `federationInviteIsExpired` /
  `DEFAULT_FEDERATION_INVITE_TTL_MS`; that builder already stamps `expiresAt`).
  `functions/federationContractInvite.js` now returns the http module
  **unchanged** when the pin exports `resolveFederationInviteExpiresAt`, and
  only falls back to the local stamping wrapper on older pins — so the shim
  deletes itself at the next lockfile bump. `functions/inviteExpiry.js` prefers
  the upstream `normalizeInviteExpiresAtMs` (`MODULE_NOT_FOUND`-only catch);
  the GroupOffer/`refs` nesting walk stays local because upstream does not
  model it. `tests/fabric/expectations.test.js` compares **behaviour**
  (`expiresAt` stamping, explicit `ttlMs`) rather than reference identity —
  same convention as `tests/fabric/peer-host.test.js` for nested npm git-dep
  copies — and still asserts reference identity once the pin has the helper.
- Loopback HTTP default; D-017 log share off; allowlisted Hub login/link; IdentityCrossSign gossip after device-link; Android local-first node. Dashboard keeps a browser-safe local IdentityCrossSign copy (do not webpack `@fabric/core`); `signCrossSign` binds `localPubkey` to `fabricKey.pubkey` and rejects unknown `kind` (same as [@fabric/core #185](https://github.com/FabricLabs/fabric/pull/185)). Master-seed device paths use core `fabricIdentityAccountPath` when the pin exports it (`functions/masterSeedVault.js`).
- Stale Fabric `:7778` hub dials rewritten to `:7777` (DNS **and** dedicated NICs `65.21.231.166` / `65.21.231.149`); self IPs dropped; peer-dial `ECONNREFUSED` logs rate-limited. A unicast `FABRIC_INTERFACE` does not treat sibling NICs as self (Hub `.166` vs RSI `.149` on meta.fabric.pub). `FabricNetwork` also wraps core `Peer._connect` so `Peer.start` / `_fillPeerSlots` cannot TCP-dial `.149:7778` from peersDb. Do not stash-pop the old GoonCitizen `fabric 7777` stash onto `fabricRelayBoot`. This core pin (`9938917`) includes Filesystem publish retain cut plus `fabricHomeEnv` / `fabricKeyMaterial`, numeric `P2P_PEERING_OFFER` dispatch, UTF-8 shoutbox `fabricChatText`, IPv6 `_connect` bracket strip, first-tier RC1 contract, undersize AMP drop, candidate cooldown / NOISE-after-connect / in-flight `_outboundDialTargets`, canonical `host:port` dial keys, and AMP wire name winning over inventory JSON `type: 98`. Local IdentityCrossSign copy matches core `_normPubkey` (no `:` field smash). APK `fabricPeerHostLocal` strips `pubkey@` userinfo; http pin `7d7f1c7` does the same in `@fabric/http/functions/fabricPeerHost` and filters sibling NICs (GoonCitizen prefers that module, local fallback for the APK).
- Fabric pins refreshed to GitHub `feature/rsi` tips above (Hub `250a178` includes `./functions/bulkSecurityAdvisory` + `operatorAdminToken` exports, Peer debug gate, Bitcoin RPC debug no longer forced, UTF-8 WebRTC shoutbox unpack, BIP-69 unsigned PSBT sort, Codacy Semgrep exclude on the advisory detector). `identityCluster` re-exports Hub; `normalizeDiscordSettings` re-exports `@fabric/discord`. Discord `e29c1bd` fails the OAuth authorize stub closed (501) and debounces voice flag `commit()`; GoonCitizen does not mount `/services/discord/authorize`. Device-link fetch uses http `deviceLinkHeaders` (browser omits client-set Origin/Referer). Http `fabricChatNormalize` re-exports core `fabricChatText`. Local Files catalog drops GHSA / OpenSSF bulk-advisory payloads via Hub `looksLikeBulkSecurityAdvisory`.
- `FABRIC_SEED` raw hex restore + `~/.fabric/hub-admin-token` / `~/.fabric/env` via core `fabricHomeEnv` / `fabricKeyMaterial` / `fabricWalletIdentity` on pin `9938917` (local wrappers catch `MODULE_NOT_FOUND` only).
- Shared shoutbox ingest via `@fabric/http/functions/fabricChatNormalize` (`functions/fabricChatNormalize.js` re-export). Global mesh remains UTF-8 `P2P_CHAT_MESSAGE`; Store still `{ channel, body, handle }`.
- Shared-mode LAN **writes** require a session (`shouldEnforceRemoteAuth`). Hosted Home does not treat a 401 JSON body as cumulative analytics (`buildAnalyzeModel` / `fetchAnalytics`).
- **Client capability chrome (2026-09-06):** Dashboard probes LiveRelay via peering/ships (`goonCitizenClientEnvironment`); static + unauthenticated hosted visitors soft-gate operator chrome; SiteLogin Bearer attaches to Dashboard/monitor and major tabs.
- Public group JSON exposes publisher / contract / validators / `signerCount` without the member roster (`Group.toPublicJSON`). GroupPage hero uses `GroupContractSummary`; the members rail is Chat `peopleOnly` (signer vs reader tags, hover Message / Profile / Invite). Missions outcomes + top pilots sit side by side (`.mi-outcomes`).
- Fabric Message collections — AMP hex collect/store/replay for journals, Discord packs, DeviceDataShare cluster catch-up, peer ring (`functions/fabricMessageCollection.js`, `functions/clusterSync.js`; `GET …/fabric/messages?format=collection`; `GET|POST …/identity/cluster/sync`). Core helper in `@fabric/core`. Durable outbound frames set AMP `parent` to the previous `Message.id` (D-020); session/peering/ping stay genesis zeros. Log rows expose `frameId` / `parent` / `genesis`. Inbound zeros still accepted.

## PRs
[#7](https://github.com/GoonCitizen/star-citizen-live/pull/7) — open **WIP: Android** (`feature/rsi` → `master`). Do not merge to `master`. Lockfile this wave: core **`88f766c28`** ([#186](https://github.com/FabricLabs/fabric/pull/186)) / http **`ca27d14`** / hub **`c184907`** / discord **`98a86b8`**. Discord pin still 501s every OAuth callback; CSRF `state` is on [#2](https://github.com/FabricLabs/fabric-discord/pull/2). Keep `report:install` lockfile wipe (suite RSI convention; script now `rm -f` instead of writing a blank line).
