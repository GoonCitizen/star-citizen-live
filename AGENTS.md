# AGENTS.md — Project context for AI coding assistants
> **This is the canonical, tool-agnostic context file for this repo.** It is the
> single source of truth for AI coding tools. OpenAI's tooling (Codex) reads
> `AGENTS.md`; Claude Code reads `CLAUDE.md`, which simply imports this file. Keep
> project context **here** so the two never drift. (`PROJECT_CONTEXT.md` is a
> legacy pointer to this file as well.)
>
> **Last reviewed against source:** branch `feature/rsi` · 2026-08-14
> (LiveRelay + Fabric Peer uplink is what runs — not the retired `app/` skeleton.
> D-018 Chain of Blocks / consensus modes; D-017 opt-in log share / Peers UI;
> D-019 GroupOffer opaque `fabric:<hex>` shares + group Statechain journal;
> D-016 contract-namespace sidechains / Hub ADR-001; D-015 sidechain/Beacon seal;
> D-014 cumulative history; D-013 device-link; D-012 application namespaces;
> D-011 site login; D-010 Fabric P2P; D-009 Fabric conventions + Network.)
> If you change architecture, commands, or state, update **this file** and the
> reality it describes — not a copy.

### Release posture (owner cut TBD)
- **Gate before PR:** `npm test` (unit + fabric + relay + integration + ui).
- **What runs:** `npm start` / `npm run desktop` → `scripts/node.js` →
  `services/LiveRelay.js` (package `main` is Electron `main.js`).
- **Do not** reopen work against a deleted `app/` tree, invent a ship checklist,
  or treat June-2026 `REVIEW.md` branches as current. Owner names the release cut.
- Coordinated Fabric pins (`@fabric/core`, `@fabric/http`, `@fabric/hub`,
  `@fabric/discord`) move with Hub/core RC work — do not bump casually.
- **Fabric types/services:** LiveRelay composes core `Store`/`Peer`; it does **not**
  subclass Hub. Shared login/link/peering helpers re-export `@fabric/http`.
  Suite map: `@fabric/core` `docs/TYPES_AND_SERVICES.md` (local `~/fabric-clean`).
- **Playnet (hub.fabric.pub + relay.goon.vc):** after Hub is up, Beacon registers
  native `fabric-beacon`. From this tree, with `FABRIC_XPRV` and
  `FABRIC_HUB_ADMIN_TOKEN`: `npm run playnet:deploy-gooncitizen -- --production --accept`
  publishes the GoonCitizen application contract to both peers and Accepts it on Hub.
- **Public relays:** operators of `relay.goon.vc` (nvm 24.15 + pm2, Caddy or
  Nginx → loopback HTTP, Peer on the dedicated NIC) read **`docs/PRODUCTION.md`**.

---

## 1. What this project is

A **Node.js service that watches the Star Citizen `Game.log` file (read-only) and
relays gameplay** — logins, missions/objectives, combat-progress, and (on older
game builds) kills — to a **live web dashboard**, an optional **Discord webhook**,
and a small **REST API**. On top of the relay sits an **officer-validated mission
register**: officers post missions/fleet actions (in-game *or* out-of-game),
members apply and do the work, and an officer validates completion. Every register
mutation is recorded in a **hash-chained, tamper-evident audit log**.

The relay also powers an **activity-analytics dashboard** (missions, outcomes,
deaths, sessions and an activity heatmap, sliced by pilot / mission type / month &
year). On every desktop/local start it **cursor-syncs** the live `Game.log` plus
locatable channel `logbackups` (including sibling `LIVE/logbackups` next to the
resolved Game.log, even for custom `SC_LOGFILE` installs) into durable cumulative
history (`stores/gooncitizen/history.json` — under Electron `userData` on
desktop). The header stats and Analyze tab default to **all-time cumulative**
counts (D-014); `npm run backfill` is an optional CLI into the same store.

**One-line summary:** turn the live game log into a Discord/dashboard/API feed,
accumulate verified play history across restarts, and run an officer-validated
mission register with an auditable trail on top.

**Core goals (do not regress — see `DECISIONS.md` D-005, D-007, D-014):** (1) the
officer-validated mission register with an auditable trail; (2) the
activity-analytics dashboard; (3) cumulative durable log history (startup sync +
live tail). New work must protect these.

**Product context for non-technical readers:** `SOLUTION-BRIEF.md`.

### Important reality check (read before touching the parser)
- **Kills are NOT logged in the current game (SC 4.8.0).** CIG removed
  `<Actor Death> CActor::Kill` / `<Vehicle Destruction>` logging after **4.3.0**.
  The kill parser + 💀 dashboard panel + Discord wiring all exist and are
  **format-verified against real ≤4.3.0 logs** (417 real kills), but they only
  fire on historical logs — **not live on 4.8.0**. See `PROGRESS.md` (top entry)
  and the `sc-log-combat-vs-missions` memory.
- What the current log *does* give richly: **missions, objectives, notifications,
  player logins, sessions/builds, and an "Incapacitated:" (player-down) signal.**
  Combat is surfaced indirectly as a **combat-progress proxy** inferred from
  mission objective text (clearly labelled as a proxy, not exact kills).

---

## 2. Origin, attribution & license

- **Forked from:** `martindale/star-citizen-live`, branch `feature/fabric-0.1.0`
  (upstream `GoonCitizen/star-citizen-live`). Package: `@rsi/star-citizen`.
- **License:** **MIT** — keep the original copyright/license notice in files.
- **This fork's direction:** D-002 removed the heavyweight Fabric *transport* from
  the local relay; D-009 brings **Fabric conventions + Network integration** back
  in: `types/` for code, `stores/gooncitizen/` for data (like Hub `stores/hub`),
  peer management, and Schnorr-signed Fabric Peer uplink to network hubs
  (hub.fabric.pub:7777, relay.goon.vc:7777) over the Fabric Protocol (D-010).

---

## 3. Build / run / test commands

Requires **Node.js 24.15.0** (see `.nvmrc` / `package.json` `engines`). Desktop /
Fabric mesh paths need **`npm i`** (pins `@fabric/core`, `@fabric/http`,
`@fabric/hub` from Git). **`.npmrc` sets `allow-git=all`** — npm 12+
`allow-git=root` still fails during nested git-dep preparation of commit SHAs.

```bash
npm i                     # Fabric git deps + Electron (dev); needs allow-git=all
npm start                 # LiveRelay → http://localhost:3041/  (dashboard home)
npm run desktop           # Electron shell (Fabric-style; alias: start:desktop)
npm run android:sync         # build dashboard, stage local Node tree, cap sync (see ANDROID.md)
npm run android:run          # install/run on a connected emulator (needs JDK 17 + ANDROID_HOME)
npm run start:android        # SC_MODE=android LiveRelay on loopback (desktop check)
npm test                  # mocha (legacy) + unit + relay + integration + UI
npm run test:unit         # node --test tests/unit + tests/fabric
npm run test:relay        # node --test tests/relay
npm run test:integration  # LiveRelay HTTP / Discord full-flow
npm run test:ui           # dashboard component trees (no browser)
npm run test:browser      # rebuild SPA + Fabric HTTP Sandbox click suite (Chromium)
npm run replay /path/to/Game.log
npm run build:desktop     # installers for the current OS
npm run build:installers  # Windows x64 + Debian x64 + macOS
npm run publish:builds    # SPA + dist/ installers + APKs → local Files catalog
```

- `npm test` layers: **unit** (`tests/unit`, `tests/fabric`) for leaf functions;
  **relay** (`tests/relay`) for LiveRelay + parser + register; **integration**
  (`tests/integration`) for HTTP / Discord / lookup flows; **UI** (`tests/ui`)
  for dashboard component trees without a browser (React stub). **Browser**
  (`npm run test:browser` → `tests/browser`) is opt-in Chromium, same
  `@fabric/http/types/sandbox` harness as Hub `tests/browser.interface.test.js`:
  it starts LiveRelay, clicks header tabs and in-page controls (Groups, Missions,
  Chat, Files 📌 pin, profile, search). Not part of default `npm test`.
- `npm start` → `scripts/node.js` → `services/LiveRelay.js`. Auto-detects the SC
  install across drives/channels and tails the freshest `Game.log` (read-only).
- Store root: **`stores/gooncitizen/`** — same shape as Hub `stores/hub`. Missions,
  groups, and operator settings live in the **`register/` Fabric Store** (LevelDB).
  GoonCitizen `types/Store.js` **composes** `@fabric/core` Store and persists
  collections at `/collections/<name>` (`store.fabric`). Cumulative gameplay
  history is **`history.json`** + **`log-cursors.json`** beside
  it (D-014). Type code: `types/Store.js`, `functions/cumulativeHistory.js`,
  `functions/logCorpus.js` (discover all own logs; `GET …/corpus`). Auto-detect
  covers Windows install drives and Linux/macOS Wine/Proton `drive_c` prefixes
  (`functions/locate.js`).   Feed **Import logs** browses folders and/or hand-picks individual `*.log`
  files (`GET …/fs`, `POST …/corpus/import`) persisted as settings
  `corpusDirs` + `corpusFiles` (`functions/fsBrowser.js`); desktop uses
  native folder/file pickers. Cumulative history also folds QT hops, incap,
  and CrimeStat. Analyze builds a Fabric Merkle **Activity Tree**
  (`GET …/activity-tree`) and can publish `GroupActivityTree` into a Group
  Contract Statechain (`POST …/activity-tree/publish`).
- Dashboard home lists features along the top: Live (Feed), Missions,
  Wallet, Files (advanced / opt-in), Library, Chat, Groups, Peers. **Feed** is a chat-style stream
  (`GET …/monitor` → `feed` / `GET …/feed`) merging parsed Game.log events,
  peer `SCEventBatch` collections, global/group/Discord chat, mission broadcasts,
  identity notes, local-tag membership, and other register inbox events
  (mission shares/updates, note shares/updates);
  type/from chips default to All with optional keyword filter. Chat uses Hub message types
  (`ChatMessage` records): **`global`** is Fabric `P2P_CHAT_MESSAGE` with a
  raw UTF-8 text body (no JSON / handle on the wire); each **`group:<id>`**
  channel is `GroupChat` under that Group's Federation `CONTRACT_MESSAGE`
  (`contracts/gooncitizenGroup.js`). Nicknames broadcast separately as
  **`P2P_PEER_ALIAS`** (UTF-8). Local posts publish over the Fabric Peer;
  remotes arrive via Peer ingest (`services/ChatManager.js` +
  `services/FabricNetwork.js`). The dedicated Chat tab remains; **global chat
  is also always available** via a floating dock on other tabs
  (`components/GlobalChatDock.js`). The header tabs row (under the identity chip)
  has **Search local data…** (`components/AppSearch.js`, `GET …/search`) over
  local packs (`chat.catalog` / `chat.messages` / `profile.playtimes` / `profile.files`) plus
  notes, groups, missions, fleets, peers, chat, inbox, and library. Ctrl/Cmd+K
  focuses it. Every hit opens a dedicated collection page (`/profiles/:id`,
  `/groups/:id`, `/missions/:id`, `/files/:id`, or `/collections/:kind/:id`). Discord people
  get `/profiles/discord:<id>` (same chrome as Fabric, with an identity rollup
  of linked keys). Hash jumps (Chat channel, people query) remain as actions
  on that page. The members rail has **Search people…**
  (`functions/chatPeopleSearch.js`) across the current channel plus the
  Discord world-view catalog and Federation groups (extras under **Also in
  world view**). Hover cards list **common Discord servers** and **common
  Fabric groups**, and **identity notes** can be shared to a Federation group
  or a peer (`Share with this person` on Fabric identities — `NoteShare` /
  `NoteUpdate`, not frozen into genesis). Channel search stays on the left
  rail. Operators set an optional **local profile**
  (Identity; Store keys `nickname` + `profile` `{ bio, scHandle }`) — nickname
  is `P2P_PEER_ALIAS`, richer fields publish as GoonCitizen `PeerProfile`;
  Peers → **Inspect** shows `GET /peers/:id` (alias/profile/pubkey). On Android
  the identity chip and header ⚙ open **Keys / Security / Privacy** pages
  (`components/Account.js`) instead of the Identity and Settings overlay modals.
  Hub Bitcoin (Wallet tab / associated funds) is desktop-only. **Profiles** (`GET …/profiles/:id`) accept a
  Fabric pubkey, `discord:<snowflake>`, or future `platform:id`
  (`functions/identityActor.js`); linked Discord ↔ Fabric identities and
  IdentityCluster devices roll up on one actor page.   **When I
  play** is a separate opt-in on the operator’s own profile (`sharePlaytimes`,
  default off): a compact weekday×hour grid (`profile.playtimes`) gossips on
  Federation `GroupDataShare` — not this machine’s heatmap painted onto someone
  else’s handle. **Published files** pin to a profile with 📌 (`POST …/files/:id/pin`,
  dedicated page `/files/:id`): a compact `profile.files` listing (name / size / price /
  merkle root — not blob bytes) gossips on the same pack envelope so group members see it
  on `GET …/profiles/:id`. A local developer install is the **application publisher**:
  `npm run publish:builds -- --pin` posts installers/APKs into this node’s Files catalog
  and pins them so Federation members see builds on that profile. Profiles expose only
  **shared** social data — advertised connection strings (`pubkey@host:port` via
  `fabricAdvertiseHost`) and opted-in statistics (playtimes / pinned files), never this
  machine’s unshared heatmap or catalog. Canonical actor id is the Fabric pubkey when linked, otherwise
  `discord:<id>` (or another `platform:id`). Mission creators can **Broadcast** an open mission
  (`POST …/missions/:id/broadcast` with `{ scope, groupId }` — network-wide
  GoonCitizen `MissionBroadcast`, or group-scoped `GroupShare` on the Group
  Federation contract); receivers get a pending offer with desktop + in-app
  **Accept** (apply) / **Ignore**, gated by `notifyMissionBroadcasts` (group
  scope is membership-filtered on receive via `isInGroupTree`). Many orgs
  install the app; **Groups** are Hub-aligned **Federation contracts**
  (optional `parentId` subgroups) with `contractId`, `GroupChange`, and
  Hub-shaped `FederationContractInvite` — the sharing boundary across the
  mesh, not a single hard-coded org. The **Groups** page is Chat-like: selecting
  a group opens its thread. The ⚙ on the group header opens settings
  (primary color, nested channel, share, primary group, visibility). Pin a
  message with the 📌 on that row; Chat’s header control left of ⚙ opens a
  drawer of pinned messages in the current channel
  (`POST …/chat/messages/:id/pin`; group channels also overlay ids on
  `GroupChange` `update` `pinnedMessages` so members converge — members may
  patch that field only). Channel shortcuts (`pinnedChannels`:
  `discord:<id>` / `group:<id>` via `GroupChange` `update`) still surface
  first in the Chat rail and are edited on the group page. Pin groups in
  the local sidebar, share fleets into
  the group Statechain log (`FleetShare`), and **+ Channel** (creates a
  Federation group — optional `parentId` subgroup — then that `group:<id>`
  chat). The group **Log** tab lists synchronized journal events; each row has
  **Data** (journal payload) and **Fabric** (opens `/collections/fabric-message/:hash`
  when `fabricMessage.hash` is present). Group
  **creators** set channel shortcuts; members pin messages and share fleets. The
  Groups tab also has **Local tags**:
  operator-only lists of Discord members and Fabric identities (`GET|POST
  …/local-groups`) plus private **identity notes** (`GET|POST …/notes`) that
  can be shared to a Federation group or a peer as GoonCitizen `NoteShare` /
  `NoteUpdate` (not frozen into genesis `messageTypes`). **Share** copies an opaque
  `fabric:` `GroupShare`/`GroupOffer` Message (D-019) for **public** groups
  (recipients Import…; a pending row lands in **Notifications** to Apply / Join).
  Default body is base64; hex is still sniffed on paste. Settings → Fabric Network
  can prefer a hex body. Tagged `fabric:base64,…` clips are still accepted.
  **Private** Share copies a clipboard-only Federation join invite (not mesh-flooded);
  a targeted **Invite** from Members still relays to that pubkey. Join requests,
  shares, and invite responses are actionable on `#notifications`. Each group’s
  local Statechain journals applications / decisions / `GroupChange` and
  folds deterministic `GoonCitizenGroupState` (D-016). A header **notification bell** opens the
  dedicated Notifications history page (`#notifications`). Desktop
  notifications for chat are controlled in Settings (`notifyDesktop`,
  `notifyChatGlobal`, `notifyChatGroups`, `notifyWhenFocused`) and shown via
  Electron IPC or the browser Notification API. The Electron window menu bar
  is hidden (tray + in-app chrome only).
- **Wallet / missions:** group k-of-n P2WSH multisig (`GET …/groups/:id/wallet`,
  deterministic via sorted member keys), mission rewards escrowed to the
  authorities' multisig, submit-completion (claim) → approve-completion
  (BIP340 Schnorr over the acceptance message) → escrow `payable` → payout
  PSBT. Ledger mode by default; `settings.payouts.rpc` connects bitcoind
  (regtest/signet; mainnet refused per D-008). Personal Hub Bitcoin
  (`settings.bitcoin.enable`) proxies `/services/star-citizen/bitcoin/*` to
  Hub HTTP — the app’s Hub-shaped API. Personal **Send** on the Wallet panel
  stays behind a button (receive / faucet / history stay visible); **Advanced
  constructor** opens `/wallet/construct` for multiple outputs, fee preview,
  change address, and watch UTXOs (Hub still spends one destination per POST).
  Operator admin token for Hub-wallet send is resolved server-side only
  (`FABRIC_HUB_ADMIN_TOKEN`, `bitcoin.adminToken`, `bitcoin.adminTokenFile`,
  or playnet mesh discover); the UI never holds it.
- **Files (this node’s catalog):** gated by **`settings.documents.enable`**
  in `settings/local.js` (off by default in `settings/example.js`). The dashboard
  **Files** tab is **Advanced mode only**. Every node keeps its own catalog in the
  Fabric Store `documents` collection (blobs under `stores/gooncitizen/documents/`)
  — **not** hub.fabric.pub / Hub JSON-RPC. The Files page **New file** button
  opens create; **Query peers** sends Fabric `P2P_INVENTORY_REQUEST` to connected
  peers (`POST …/documents/inventory`) and lists published remote files with peer
  attribution and sats prices (`documentoffers`). File detail shows **Offers** for
  the same id/sha256, cheapest first (`GET …/documents/:id` `offers`,
  `GET …/documents/offers?documentId=`). Chat (and the global dock) **📎 attach**
  always writes that local catalog at `documents.defaultPriceSats` (default **25**)
  then posts a ChatMessage with a `fabric-doc:` wire line
  (`functions/chatAttachment.js`, `functions/localDocuments.js`). Discord / bridged
  channels get the caption only (the bot relays as itself); the Fabric record keeps
  the file. LiveRelay `/services/star-citizen/documents/*` lists / creates / publishes
  locally (`POST` may use loopback `filePath` for repo build artifacts).
  `npm run publish:builds` posts `assets/index.html`, `dist/` installers, and
  Android APKs into that catalog as Fabric `DocumentBlobIndex` packs (AMP-sized
  `P2P_FILE_SEND` blobs). `--pin` / `--pin-to-profile` also 📌 pins each row onto
  this node’s profile so Federation members see the publisher’s builds. List price is **size-based** (`documents.satsPerKiB`,
  default 1 sat/KiB, floored at `defaultPriceSats`) so storage and transfer
  scale with bytes; `--price` is a flat override. Chat POST may include `{ file: { contentBase64, name, mime }, purchasePriceSats }`.
  Slash-command pop-out (`/file`, `/price`, `/lookup`, `/help`) is extensible via
  `SLASH_COMMANDS`. `/lookup` starts a GoonCitizen LookupRequest→Claim→Response
  race: peers build a master local report (players, public groups/fleets, peer
  aliases, Discord guild/user catalog, local tag names) and race to post the chat reply.
- **Discord bot (`@fabric/discord`):** Settings / env configure app id, token,
  channel. On bot ready (and on `GET …/discord/guilds?refresh=1`) LiveRelay
  fetches guilds, channels, and a **bounded** member list from Discord (the API
  will not return a full roster for large guilds), persists ids via `syncGuilds`,
  and **accumulates** guild/channel/member snapshots **and channel messages** in
  the Fabric Store (`discordcatalog`) across refreshes, inbound Discord traffic,
  and group gossip — so a bot operator can still **browse collected data if
  Discord is down**. Operators share compact **packs** with Federation groups they
  belong to (`GroupDataShare` on the group contract — not frozen into genesis
  `messageTypes`; Settings → Discord → “Share group data…”; default on). Canonical
  packs are `chat.catalog` / `chat.messages` with a **`platform`** field (Discord
  first) plus opt-in `profile.playtimes` and `profile.files`. Aliases `discord.catalog` /
  `discord.messages` and legacy `DiscordCatalogShare` still ingest. Unknown packs
  are dropped so later chat platforms, bots, and apps join the same world view.
  Chat **storage keys stay** `discord:` / `discord:dm:` until another platform is
  wired. Peers **without Discord application credentials** merge shares from group
  members and still see guilds + stored messages on Chat ⚙
  (`GET …/world-view`, `GET …/discord/guilds`). Chat lists **one flattened
  channel rail** (`functions/chatChannelList.js`): Fabric, Discord, and **bridged**
  rows. A Federation group that pins a Discord channel is both a Fabric channel
  and a Discord channel — even when the local bot relays as itself. Storage keys
  stay `discord:` / `discord:dm:`. The rail and Bot settings show **you** vs
  **bot** permission chips (`functions/discordChannelAccess.js`): listen-only or
  a locked identity (you cannot chat) separately from missing View/Send
  (the bot cannot chat), plus a history warning when the bot cannot read.
  Catalog rows carry a compact `bot: { view, send, readHistory, attach }`
  snapshot from discord.js `permissionsFor`. Unlocked identities post through the local bot
  (`POST …/chat/messages` with `channel=discord:<id>` or the Fabric `group:<id>`
  key for a bridged row). Operators
  **link Discord ↔ Fabric** by generating a one-time code (`POST …/discord/link`)
  then posting `!link <code>` from their Discord account; `!unlink` clears it.
  Linked authors resolve to the Fabric pubkey in Chat (profile / DM). The
  dedicated Discord page (left rail **Bot settings** + top-right ⚙) enumerates
  guilds/channels/users, sets the announce channel, hosts the link-code UI, and
  a **Network** tab for co-membership exploration (who shares which servers the
  bot can see — Discord Friends are not available to bots; Fabric `!link`
  overlays show on people). Chat hover cards show the same overlap for the
  person under the cursor (common Discord servers + common Fabric groups)
  (`GET …/discord/guilds`, `GET …/world-view`, `GET …/discord/guilds/:id/channels`,
  `GET …/discord/guilds/:id/members`, `GET …/discord/channels/:id`,
  `GET|POST|DELETE …/discord/link`). Chat also supports **in-app Discord DMs**
  (`discord:dm:<userId>`): Message on a Discord member (including the local bot)
  opens a DM thread; DMing the local bot uses a loopback path so it works even
  when you run the bot. Inbound Discord DMs land on the same keys. Inbound Discord
  **commands** on the
  announce channel still publish GoonCitizen `CONTRACT_MESSAGE` bodies
  **DiscordRequest → DiscordClaim (first-wins) → DiscordResponse** so
  multiple operators of the same Discord application do not double-reply.
  Auditors seed the sequence from the Fabric message log (**View tree** on any
  Discord frame, or `GET …/fabric/messages/tree?requestId=`). Helpers:
  `functions/discordContract.js`, `functions/discordGuildCatalog.js`,
  `functions/discordCatalogAccumulate.js`, `functions/groupDataSync.js`,
  `functions/chatPlatform.js`,   `functions/profilePlaytimes.js`,
  `functions/profileFiles.js`,
  `functions/discordIdentityLink.js`, `functions/chatPeopleSearch.js`,
  `functions/identityNotes.js`, `functions/appSearch.js`,
  `functions/localDocuments.js`, `functions/chatChannelList.js`. Store collection `datasync` holds
  `profile.playtimes` / `profile.files` folds (`GET …/profiles/:pubkey` `playtimes` / `files`;
  pin with 📌 on `/files/:id`).
- **Peers (D-010 / D-017):** each node runs a Fabric Peer on **port 7777**
  (`fabric.port`); default seeds are `hub.fabric.pub:7777` and
  `relay.goon.vc:7777` (removable; a saved empty list is respected). Peering is
  AMP/`Message` over TCP/NOISE — not HTTPS uplink. Both hubs selectively relay
  relevant Fabric messages. Desktop listens for `P2P_PEERING_OFFER` /
  `P2P_PEER_GOSSIP`, fills open slots (`Peer._fillPeerSlots`), and may
  auto-roster discovered non-hub peers (`discovered: true`, logs off). Optional
  `fabricAdvertiseHost` publishes offers so others can dial you. Peers UI also
  **observes** Hub HTTP `GET /services/peering` on both hubs (TCP + WebRTC
  registration counts — browser mesh is not dialed from desktop). Parsed log
  events (`SCEventBatch` / `GameStateSnapshot`) are **opt-in**: default
  `shareLogsGlobal` off, or per-peer `shareLogs` on the Peers tab. Chat and
  mission broadcasts always publish when the peer is up.
- **Site login (D-011):** LiveRelay hosts Hub-compatible **`/sessions`**
  (`functions/fabricSiteLogin.js`) so `relay.goon.vc` (or any
  `SC_MODE=server` deploy) can sign players in without a separate Hub HTTP
  front. Desktop registers **`fabric:`** and completes client-signed sessions
  (`fabric://login?sessionId&hub`) with the unlocked player key —
  interchangeable with Fabric Passport (`components/FabricLoginModal.js`).
  Browser monitor (non-Electron) uses `components/SiteLogin.js`. Successful
  completion issues a Bearer `delegationToken` for hosted API auth.
- **Device link (D-013):** mutual Schnorr attestation with separate seeds.
  **Peer-equivalent:** Passport, Android, desktop, and Hub browser can each
  **create or accept** a `fabric://link` (Identity → **Add a device**, or
  Android **Security → Add a device**, or Passport Settings → Security & privacy). Offers post to an allowlisted hub
  (`https://relay.goon.vc` by default) and show QR (`fabric://link`) plus an
  HTTPS landing (`https://<hub>/#device-link=`) for Passport. After `linked`,
  both devices gossip BIP340 `IdentityCrossSign` as Fabric `CONTRACT_MESSAGE`
  so the mesh treats them as one actor; the signed object is stored locally and
  re-shared with later peers. **Revoke** (Identity / Security, or Settings / privacy) publishes
  `IdentityCrossSignRevoke`. See `DECISIONS.md` D-013 and `ANDROID.md`.
- **Android:** Capacitor shell (`vc.goon.android`) around a **local LiveRelay +
  Fabric Peer** (`SC_MODE=android`). Capacitor-NodeJS loads `nodejs/index.js`,
  which always calls `main()` so loopback HTTP, the JSON register store, and Peer
  actually start. Native LevelDB is skipped (Capacitor Node 18 cannot load
  `classic-level`); chat/groups/missions persist as JSON and the Peer uses a JS
  Level shim. The APK loads the bundled dashboard and trusts
  `http://127.0.0.1:3041` first; remote application traffic is Fabric
  (D-010), not HTTPS to `relay.goon.vc`. Own seed; first-run is a full-screen
  create / restore (BIP39 or xprv) / backup-import flow (optional master-seed
  wizard for one seed → Bitcoin xprv + per-device xprvs), then dedicated
  **Keys / Security / Privacy** pages (`#keys`, `#security`, `#privacy`) instead
  of the Identity and Settings overlay modals. The identity chip and header ⚙
  open those pages. D-011/D-013 HTTPS is pairing rendezvous only. See `ANDROID.md`.

### Environment variables (config; secrets via env only)
| Var | Purpose |
|-----|---------|
| `SC_LOGFILE` | Force an exact `Game.log` path (highest priority). |
| `SC_CHANNEL` | Force a channel, e.g. `HOTFIX` (when auto-detect ties). |
| `SC_SEED` | Pre-fill the monitor from a different log on start. |
| `DISCORD_WEBHOOK_URL` | Optional webhook mirror (fallback if no bot). |
| `DISCORD_BOT_TOKEN` | Local `@fabric/discord` bot token. |
| `DISCORD_APP_ID` / `DISCORD_APP_SECRET` | Discord application id / OAuth client secret. |
| `DISCORD_CHANNEL_ID` | Default announce channel snowflake for bot embeds. When set, inbound Fabric DiscordRequest coordination is limited to that channel. |
| `SC_OFFICERS` | Comma-separated officer allowlist for the mission register. |
| `SC_REGISTER_DIR` | Fabric Store (LevelDB) for ALL internal storage — missions, groups, operator settings. Default: `stores/gooncitizen/register` (CLI) / `<userData>/stores/gooncitizen/register` (desktop). |
| `SC_SETTINGS_DIR` | Named Fabric store root. Default: `stores/gooncitizen`. |
| `SC_MODE` | `server` = public/hosted API (signed writes, no Game.log). Fabric Peer is **on** unless `SC_FABRIC=0` (seeds such as `relay.goon.vc`). HTTP via `scripts/node.js` defaults to loopback behind Caddy. `android` = mobile node (loopback HTTP, Fabric Peer, no Game.log). Unset = desktop/local relay. |
| `SC_FABRIC` | `0` disables the Fabric Peer. Unset/`1` = listen (required for a public seed). |
| `FABRIC_PORT` | Fabric Peer listen port (default 7777). Wins over `settings/local.js` `fabric.port`. On the shared production host, 7777 is Hub + this relay; other apps use 7778+. |
| `FABRIC_INTERFACE` / `FABRIC_PEER_INTERFACE` | Fabric Peer bind address (default `0.0.0.0`). Dedicated `relay.goon.vc` NIC: `65.21.231.149`. |
| `FABRIC_PUBLIC_HOST` / `FABRIC_ADVERTISE_HOST` | Hostname for peering offers / self-dial filter (`relay.goon.vc` on that host). Legacy alias: `SC_FABRIC_PUBLIC_HOST` (mapped at boot). |
| `FABRIC_HUB_INTERFACE` / `INTERFACE` / `FABRIC_HTTP_INTERFACE` | HTTP dashboard bind. Desktop default loopback unless shared mode. `SC_MODE=server` via `scripts/node.js` also defaults loopback (`127.0.0.1`) for Caddy; set this to the public NIC only for bare HTTP. Legacy aliases: `SC_HTTP_HOST` / `SC_HTTP_INTERFACE` (mapped at boot via `functions/goonCitizenEnvAliases.js`). |

Snapshot settings (Settings ⚙ → Snapshots; stored in the Fabric Store, applied
live): `snapshotsEnabled` (opt-in, default off), `snapshotIntervalSeconds`
(default 10, min 2), `snapshotAutoPurge` (default on), `snapshotMaxMB` (default
256). Reduced-size JPEGs live under `stores/gooncitizen/snapshots/`; metadata in
the Store `snapshots` collection; browse them on the dashboard **Library** tab.
Capture requires the desktop app (screenshot-desktop + nativeImage downscale).

Settings can also come from `settings/local.js` (copy `settings/example.js`).
**Never commit secrets** — `settings/local.js`, `settings/auth.txt`, and `.env`
are gitignored. See §7.

---

## 4. Project structure

### Active code (this is what runs)
| Path | Role |
|------|------|
| `scripts/node.js` | CLI/server entry → constructs `LiveRelay`. |
| `main.js` | Electron desktop entry (`package.json` `main`). |
| `services/LiveRelay.js` | The service: log tail, REST + dashboard, register, Chat, Groups, Discord, Peers, Fabric uplink. |
| `functions/parser.js` | Rule-based SC 4.x `Game.log` parser (`verified` flags — see §6). |
| `functions/locate.js` | `resolveLogFile()` — install/channel auto-detect (Windows + Wine/Proton prefixes). |
| `types/Store.js` | Fabric Store composition; register collections under `stores/gooncitizen/`. |
| `services/MissionManager.js` | Officer-validated mission register + hash-chained audit. |
| `services/GroupManager.js` | Federation groups, invites, `GroupChange`, pinned channels, statechain. |
| `services/ChatManager.js` | Global / group / Discord / DM chat records. |
| `services/FabricNetwork.js` | Fabric Peer ingest/publish (chat, aliases, shares, presence). |
| `components/` | Dashboard React UI (Chat, Groups, Missions, Peers, CollectionRecord, …). Android Keys / Security / Privacy: `components/Account.js`. |
| `functions/identityActor.js` | Fabric / Discord / platform actor ids + identity rollup. |
| `functions/collectionRecords.js` | `/collections/:kind/:id` loader + first-class path aliases. |
| `functions/transactionConstruct.js` | Wallet send draft / `/wallet/construct` preview (Hub one-output sends). |
| `contracts/` | GoonCitizen group / application message contracts. |
| `settings/example.js` | Config template → copy to `settings/local.js` (gitignored). |
| `tests/{unit,fabric,relay,integration,ui}/` | Current test layout (`npm test`). |

### Legacy / reference only (do not treat as the running service)
- `services/StarCitizen.js`, `types/StarCitizenAPI.js`, `components/Interface.js` —
  original Fabric Hub path; kept for history / mocha smoke only.
- The old Fabric-free **`app/`** skeleton (`app/server.js`, `app/ui.html`, …) is
  **gone** — do not recreate it or cite it as the live API.

### REST API (base path: `/services/star-citizen`)
Authoritative handlers live in **`services/LiveRelay.js`** (not a separate
`app/server.js`). Dashboard HTML is served at `/`. Status at
`GET /services/star-citizen`. Monitor / feed / missions / groups / chat /
discord / peers / wallet / documents / settings are mounted there — see §3 for
the product surface. `API.md` remains **stale** legacy JSDoc; trust LiveRelay +
tests over `API.md`.

---

## 5. Current state — what works vs. what's next

**Built (see §3 for the live product surface; keep `npm test` green):**
- Read-only live log monitoring with **auto-detect** of install/channel, plus
  **offline replay**. Survives the game rotating/recreating `Game.log`
  (session tracking).
- Rule-based parser: logins, sessions/build/hardware, level/mode loads, missions,
  objectives, notifications (HUD vs. mission split), mission-type classification,
  player-down (incapacitation) detection, and a combat-progress proxy.
- **Current-build (4.8.0) death + mission lifecycle:** `player:death` (corpse
  `body_01_noMagicPocket` marker), `mission:start` and `mission:end`
  (CompletionType: Complete/Abandon/Fail/Deactivate). Kills are still parsed but
  dormant on the current game (only ≤4.3.0 logged them — §1).
- **Activity-analytics dashboard** (Analyze tab): KPI strip, activity heatmap,
  outcome donut, mission-type bars, pilot leaderboard, pilot comparison; **month/
  year add-remove slicer**; served by `GET …/analytics` from **cumulative**
  history (plus in-flight active missions). Header counts are all-time by default;
  `counts.session` on `/monitor` is this-process only.
- **Cumulative log history (D-014):** `functions/cumulativeHistory.js` + startup
  `_syncCumulativeHistory()` — byte cursors in `log-cursors.json`, compact records
  in `history.json` under the store root. Live tail and peer `SCEventBatch`
  deaths/mission ends fold into the same store. Optional CLI: `npm run backfill`.
- **Hub sidechain / Beacon seal (D-015 / D-016 / D-018):** clients publish
  `GameStateSnapshot`; `relay.goon.vc` aggregates into `/services/rsi` **and**
  `/namespaces/<gooncitizenContractId>` on Hub `sidechain/STATE` so each Beacon
  epoch seals a public `stateDigest` + `sidechain/SNAPSHOTS` (Fabric sidechain document;
  Hub ADR-001). Gossip event firehose uses `@fabric/core` **Chain** of **Blocks**
  (`consensus: 'gossip'`) via `functions/eventChain.js` for append/merge/split/replay;
  Beacon epochs use `consensus: 'federation'` (Elements-style signed blocks) on the
  same Chain type. Groups persist Statechain STATE+JOURNAL in the Fabric Store
  collection `groupsidechains` via `functions/groupStatechain.js` (no direct `fs`).
  Helpers: `functions/gooncitizenGameState.js`; hub sync in
  `goon.vc/functions/gooncitizenSidechainSync.js`.
- Kill / vehicle-destruction parsing — **format-verified on real ≤4.3.0 logs**,
  wired to the dashboard 💀 panel + Discord, but dormant on the current game (§1).
- Live dashboard + REST API + optional Discord webhook embeds + **Discord bot bridge**.
- **Mission register (M5):** full lifecycle (open → apply → accept → claim →
  officer validate → completed | reject/cancel), officer allowlist, and a
  hash-chained tamper-evident audit log, exposed over REST. The register also
  **collects Game.log missions** (`source: 'gamelog'`) from live tail +
  cumulative history — evidence rows (reward 0); officer posts remain the
  payout path.
- **Groups / Chat / Peers / desktop** — Federation groups, pinned channels, Fabric
  Peer chat, site login, Electron installers (`npm run build:desktop`).

**Next (owner-prioritised — do not invent a ship list):**
- Owner names the **release cut** (desktop installer vs `relay.goon.vc` vs both).
- Historical milestone labels in `PROGRESS.md` (M4 VPS, M5.3 Discord role hooks,
  M6 signed audit) remain backlog unless the owner re-activates them — Discord bot
  bridging and packaging already exist in some form on this branch.
- Keep docs honest: `CONTINUE.md` / parts of `PROGRESS.md` still describe the
  retired M1 `app/` path; prefer **this file §3–§4** over those until refreshed.

---

## 6. Conventions

- **Style:** CommonJS (`require`/`module.exports`), `'use strict'`, 2-space indent,
  semicolons, single quotes. Match the surrounding file.
- **Dependencies:** Fabric mesh + desktop paths intentionally depend on
  `@fabric/core` / `@fabric/http` / `@fabric/hub` / `@fabric/discord` (Git pins).
  Do **not** add new runtime deps without a strong reason. Prefer Node built-ins
  for leaf helpers. New suites use Node's built-in runner; mocha remains for a
  few legacy Hub construction tests.
- **The log is read-only, always.** Never write to or modify the SC install.
- **Parser honesty — `verified` flag:** every parser rule is tagged `verified:true`
  (confirmed against a real `Game.log`) or `verified:false` (built from
  documented/community format, not yet confirmed). **Do not flip a rule to
  `verified:true` without a real matching log line.** "Verified on real data" must
  be qualified by **game version** (a rule can be verified on 4.3.0 yet not fire on
  4.8.0). Don't invent log formats — feed real `Game.log` lines.
- **Tests alongside code.** Add or extend suites under `tests/unit`,
  `tests/fabric`, `tests/relay`, `tests/integration`, and `tests/ui` (legacy mocha:
  `tests/mission-system.js`, `tests/rsi.stream.js`). Keep `npm test` green.
- **The mission register is the source of truth, not the log.** The log relay is
  *supporting evidence* only — a human officer validates completion (D-005).

---

## 7. Secrets handling

No live webhook/token is committed. Provide secrets via **environment variables**
(or a gitignored `settings/local.js` / `.env`). `.gitignore` already covers
`settings/local.js`, `settings/auth.txt`, `.env`, `node_modules/`, `stores/`,
`reports/`, and `*.log` (so a personal `Game.log` dropped in the folder is never
committed; `test/fixtures/*.log` is the one allow-listed exception). **Never paste a
Discord webhook into a tracked file.**

---

## 8. Documentation map (where the rest of the context lives)

| Doc | What it is |
|-----|------------|
| `AGENTS.md` (this file) / `CLAUDE.md` | Canonical AI-assistant context (CLAUDE.md imports this). |
| `docs/PRODUCTION.md` | Public relay operators (`relay.goon.vc`): nvm 24.15, pm2, Caddy or Nginx, Peer bind. |
| `@fabric/core` `docs/TYPES_AND_SERVICES.md` | Suite `types/` + `services/` layering (core / http / Hub / Passport / this app). |
| `CONTINUE.md` | Quick-start — **partially stale** (still describes M1 `app/`); prefer §3. |
| `PROGRESS.md` | Milestone + retrospective trail (newest first). The live status log. |
| `DECISIONS.md` | ADRs — the *why* (D-001…D-019; note D-002 amended by D-009/D-010). |
| `SOLUTION-BRIEF.md` | Plain-English product brief for org leadership. |
| `DESIGN-missions-mvp.md` | Technical design for the mission register (M5). |
| `DESIGN-distributed.md` | Design-only: optional federated/decentralized future (D-004). |
| `DESIGN-event-convergence.md` | How to merge many players' event streams into one org-wide view (transport-agnostic; for M4 + future Fabric). |
| `REFERENCES.md` | Catalog of reusable SC open-source projects + log-format findings. |
| `BACKLOG.md` | Idea backlog (not an authorised ship list). |
| `SPIKE-LOG-tier0-boot.md` | The spike that proved Fabric was too heavy. |
| `MOBILE-SETUP.md` | Mobile/remote access notes (second computers — not the Android APK). |
| `ANDROID.md` | Local-first Android node (LiveRelay + Fabric Peer), identity clusters, sideload. |
| `START-HERE-claude-code.md` | Beginner walkthrough for running this in Claude Code. |
| `README.md` | Public-facing readme (may lag AGENTS §3). |
| `API.md` | ⚠️ Stale legacy-Fabric JSDoc — see LiveRelay + §3 / §4. |
| `CHANGELOG.md` | Keep-a-changelog file; see `PROGRESS.md` for the real milestone trail. |
| `REVIEW.md` | Async AI collaboration log — historical reviews stay dated; owner authorises work. |

When picking up work, read **AGENTS.md §3–§4 → PROGRESS.md (newest) → DECISIONS.md**
first. Do not treat `CONTINUE.md` as authoritative until refreshed.

---

## 9. Working across Claude Code and OpenAI Codex (tool-agnostic)

This repo is set up so work can move freely between AI coding tools:
- **`AGENTS.md`** (this file) is the canonical context — Codex and other
  AGENTS-aware tools read it automatically.
- **`CLAUDE.md`** imports this file (`@AGENTS.md`), so Claude Code gets the exact
  same context with no duplication.
- **`PROJECT_CONTEXT.md`** is a thin pointer to this file for humans/tools that
  look for it.

**Rule for any tool:** put durable project context in **`AGENTS.md`** only. Do not
fork context into `CLAUDE.md`/`PROJECT_CONTEXT.md` — they intentionally just point
here, so the three can never disagree.

---

## 10. AI collaboration & the human-control model (READ FIRST if you are an AI agent)

This repo is worked by **multiple AI tools** (Claude Code, OpenAI Codex) under one
human product owner (**Neorion**). The rules below are binding for any AI agent.

**Control stays with the product owner. Always.**
- The owner decides **what gets developed**. AI agents are **advisors and
  reviewers** — they **propose**, they do not decide.
- **Do NOT merge to `main`.** Do not build features, refactor broadly, or change
  behaviour **without the owner's explicit go-ahead** in that thread.
- Surface work as **branches + pull requests + committed docs** for the owner to
  review and approve. Small, reversible, well-described changes.
- A review or suggestion is **advisory**, not authorisation to implement it.

**How Claude Code and Codex collaborate (async, via GitHub):**
- The shared channel is **`REVIEW.md`** (committed markdown) and **PR comments** —
  not a live connection. One agent writes findings; the other reads on next pull
  and responds in the same doc; the owner records decisions there.
- Keep the exchange factual and cite files/lines. Don't re-litigate settled
  decisions — check `DECISIONS.md` (D-001…D-019) and `PROGRESS.md` first.

**Ground truths — do not "rediscover" or contradict without new evidence:**
- **D-002** removed the heavyweight Fabric *transport* from the local relay so
  the Game.log path stays simple. **D-009 / D-010** bring Fabric *conventions*
  and a Schnorr-signed **Peer uplink** back (Hub seeds, Chat, Groups, shares).
  Do not claim “Fabric is gone” or reopen a deleted `app/` Fabric-free skeleton.
  Officer-validated register remains core (D-005).
- **Kill logging:** present only in SC **≤ 4.3.0**; CIG removed it after 4.3.0 —
  **not in the current game (4.8.0)**. Verified across 3 players' logs. The kill
  rules parse *historical* logs only. (See `PROGRESS.md` / the combat memory.)
- **Honesty rule:** label **validated** (officer/real-log) vs **inferred**
  (telemetry/proxy); never overclaim. Qualify "verified on real data" by game
  version. Secrets via env only (bot token, never a user token); never commit them.
- `npm test` runs mocha (legacy Fabric Hub construction) plus `node --test` over
  `tests/unit`, `tests/fabric`, `tests/relay`, `tests/integration`, and `tests/ui`.

**Working practice — sub-agents for big batches:** for heavy read/analysis work
(large `Game.log` corpora under `Gamelogs/`, broad multi-repo research), delegate
to a **sub-agent** (its own context window) that returns a **summary**, rather than
reading gigabytes into the main thread. Adopted as the default for big batches.

**Active docs:** prefer this file’s **Release posture** + §3–§4. `REVIEW.md` holds
dated collaboration notes; June-2026 `app/` review requests are **historical** —
not the current work order unless the owner re-opens them.
