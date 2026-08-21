# Changelog
All notable changes to this project will be documented in this file.

> **Note:** the authoritative, milestone-by-milestone trail (with retros and
> findings) lives in **`PROGRESS.md`**. This file is a high-level summary; the
> entries below the `[0.1.0-dev]` line describe the *original Fabric-based* code,
> most of which was removed in the fabric-free rebuild — treat them as historical.

## [Unreleased] — Fabric-free rebuild (`feature/fabric-free-m1`)
### Added
- **Group voice:** Opt-in Federation-group voice with push-to-talk (**Shift+Tab**,
  rebindable from Chat ⚙ → Voice or Settings → Voice). Uncheck Push-to-talk for
  voice activity. Desktop captures the bind while another app is focused (hold
  via OS key-state poll). Overlay shows joined voice status with a lighter HUD
  so the game stays visible. Signaling inherits Hub `https://hub.fabric.pub`
  WebRTC RPC; RTP stays in the renderer. Active-voice bar is bottom-left on
  `--chrome-inset`. Join uses the unlocked wallet session (and, on desktop, that
  wallet even when `FABRIC_XPRV` is the process publishing identity) so a group
  you created is not 403 `forbidden: members only`.
- **Shareable invitation expiry:** Group **Share** (`GroupOffer`) and private **Invite**
  (`FederationContractInvite`) clips stamp `expiresAt`, defaulting to **7 days**.
  Import and Accept return **410** when the clip is past that stamp. POST
  `/groups/:id/share` and `/groups/:id/invites` accept `expiresInDays`, `ttlMs`,
  or `expiresAt`. Legacy clips without the field still ingest.
- **Group invitations:** Mesh Invite / Share relays the **same signed Fabric
  Message** as the copied `fabric:` clip (no re-sign). Direct invites gate
  ingest and Accept to `inviteePubkey`; Accept adds the member and journals
  GroupChange so both nodes update roster + Statechain.
- **Linux `.desktop` association:** Root `desktopName` is `vc.goon.desktop` (same as `appId` / `WM_CLASS`) with `build.linux.syncDesktopName`.
- **Fabric lettermark:** GoonCitizen desktop (`assets/icon.png` / `.ico` / `.icns`), tray glyphs, Android launcher, and dashboard favicons use the suite serif **f** on royal purple from `@fabric/http` `npm run make:icons`.
- **Downstream intel desk:** `docs/INTELLIGENCE.md` — Groups as orgs;
  `settings/local.js` whitelabel (`defaultGroupMessageId`, Discord, peers).
- **Application basis:** `docs/APPLICATION.md` — why fork LiveRelay (contracts,
  Groups, login, packaging) rather than Hub or a blank Peer.
- **Files disk upload + cluster sync:** the Files create form accepts a disk
  picker (plus the UTF-8 textarea). Local catalog rows can **Sync to my devices**
  (`POST …/files/:id/cluster-sync`); `DeviceDataShare` `account.files` carries
  metadata and `P2P_FILE_SEND` copies bytes to identity-cluster siblings.
- **Fabric Message parents (D-020):** durable outbound AMP frames chain
  `parent` to the previous `Message.id`. Session/peering/ping stay genesis
  zeros. Log + journal rows store `frameId` / `parent`.
### Changed
- **When you fly:** the Home heatmap tab moved to the operator’s own profile
  (identity chip → **My profile**), with a **Publish when I fly** checkbox
  (`sharePlaytimes`) to gossip the weekday×hour grid to Federation groups.
- **npm git deps:** pin `@fabric/core` / `@fabric/http` / `@fabric/hub` and set
  **`.npmrc` `allow-git=all`** so nested Hub→http→core git preparation works under
  npm 12+ (`allow-git=root` still refuses commit-SHA fetches).
- **Removed the Fabric/p2p framework** and rebuilt the core as a zero-dependency
  Node.js service (`app/server.js`). `npm start` now runs the Fabric-free service;
  the old Fabric entry is kept as `npm run start:fabric` (deprecated). (D-002)
### Added
- **Call for developers:** `DEVELOPERS.md` / `CONTRIBUTING.md` — G00N SQUAD,
  PERMAFLEET, and other orgs invited to contribute or fork onto the Fabric
  Network (GitHub issue templates under `.github/ISSUE_TEMPLATE/`).
- **Live monitoring** with auto-detection of install/channel + offline replay
  (`app/locate.js`, `app/server.js`, `scripts/replay.js`), session/restart tracking.
- **Real SC 4.x log parser** (`app/parser.js`): logins, sessions/build, missions,
  objectives, notifications, mission-type classification, player-down detection,
  combat-progress proxy, and version-verified kill/vehicle rules (dormant on 4.8.0).
- **Live dashboard** (`app/ui.html`) + expanded REST API.
- **Officer-validated mission register** (`services/MissionManager.js`,
  `app/store.js`): full lifecycle + officer allowlist + hash-chained audit log,
  exposed over REST. (D-005)
- Test suite on Node's built-in runner (`test/*.test.js`, 45 tests).
- Tool-agnostic AI-assistant context: `AGENTS.md` (canonical), `CLAUDE.md`
  (imports it), `PROJECT_CONTEXT.md` (pointer).

---

## [0.1.0-RC1] - 2025-12-05 — *historical (Fabric-based)*
### Added

## [0.1.0-dev] - 2024-12-05
### Added
#### Declarative API
- Declarative properties on service instances: `activities`, `players`, `vehicles`, `kills`, `logs`, `status`
- Type definitions for all API entities in `types/StarCitizenAPI.js`
- Comprehensive test suite for declarative API in `tests/declarative-api.js`

#### Discord Integration
- Discord webhook integration for game event announcements
- Configurable announcement types (activities, kills, player joins)
- Rich embed support with color coding and timestamps
- `postToDiscord()` method for custom Discord messages
- Automatic Discord wiring when enabled in settings
- Event handlers for Discord announcements: `_handleActivityForDiscord`, `_handleKillForDiscord`, `_handlePlayerJoinForDiscord`

#### HTTP Endpoints
- RESTful endpoints for all resource collections
- `GET /services/star-citizen` - Service status and statistics
- `GET /services/star-citizen/activities` - List activities
- `POST /services/star-citizen/activities` - Create activity
- `GET /services/star-citizen/players` - List players
- `POST /services/star-citizen/players` - Register player
- `GET /services/star-citizen/vehicles` - List vehicles
- `POST /services/star-citizen/vehicles` - Register vehicle
- `GET /services/star-citizen/kills` - List kills
- `POST /services/star-citizen/kills` - Register kill
- `GET /services/star-citizen/messages` - List messages
- `POST /services/star-citizen/messages` - Create message

#### State Management
- Extended state to include `activities`, `kills` collections
- Proper state initialization with all collection types
- State commit on all collection updates

#### Events
- New event types: `kill`, `player:join`, `ready`, `stopped`
- Enhanced `activity` event with proper structure
- Event-driven Discord integration

#### Documentation
- Comprehensive README with features and usage examples
- API.md with complete API documentation
- INTEGRATION.md guide for Discord, Fabric, and Sensemaker integration
- Example code in `examples/discord-integration.js`
- Example code in `examples/declarative-api.js`
- Settings example file in `settings/example.js`
- Environment variable example in `.env.example` (would be created)

#### Configuration
- Discord configuration in settings
- Environment variable support for Discord webhook
- Configurable announcement flags
- HTTP enable/disable flag

#### Developer Experience
- Test suite for declarative API
- JSDoc comments throughout codebase
- Type definitions for better IDE support
- .gitignore for clean repository

### Changed
- Updated package.json with new dependencies (cross-fetch, lodash.merge)
- Updated package.json keywords to include Discord and gaming
- Enhanced service description to mention Discord integration
- Improved log change handler to store activities
- Enhanced HTTP request handlers to return structured responses
- Updated start/stop methods with better logging and error handling

### Fixed
- Activities now properly stored when log changes occur
- Proper status management throughout lifecycle
- HTTP handler for kills now uses correct method signature
- State properties now safely handle undefined collections

## [0.0.1] - Previous
### Added
- Initial Star Citizen log monitoring
- Basic HTTP server
- Fabric Hub integration
- Log parsing
- Screenshot capability
- Activity announcements to authority

[0.1.0-dev]: https://github.com/GoonCitizen/star-citizen-live/compare/v0.0.1...HEAD
[0.0.1]: https://github.com/GoonCitizen/star-citizen-live/releases/tag/v0.0.1

