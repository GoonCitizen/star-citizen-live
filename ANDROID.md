# GoonCitizen Android
Sideload APK first. The mobile app is a **local GoonCitizen node**: bundled dashboard, loopback LiveRelay, and a **local Fabric Peer**. If the network is off, the app still loads and talks only to that local node. Remote application traffic (chat, groups, missions, delegation grants) goes over Fabric — not HTTPS to `relay.goon.vc`.

QA and patches from G00N SQUAD / PERMAFLEET (and forks) go through
[`DEVELOPERS.md`](DEVELOPERS.md). Desktop counterpart: [`ELECTRON_BUILD.md`](ELECTRON_BUILD.md).
Threat model for the local node: [`docs/THREAT-MODEL.md`](docs/THREAT-MODEL.md).

D-021 / D-022 **HTTPS** to an allowlisted hub remains sign-in, pairing **rendezvous**, and signing-request **mailbox** only.

## Identity

Every device (Passport, desktop, Android, Hub browser) has its **own keypair / seed**. Linking does **not** copy a mnemonic.

**First-run.** On first launch the device uses a full-screen onboarding page (not a desktop overlay): **Create new identity**, **Restore seed or xprv**, or **Load from backup file**. Optional **Master seed wizard…** derives one seed + password into a Bitcoin xprv and per-device identity xprvs (install the first-device xprv here; restore the companion xprv on another device). After the seed is written down (or a restore/import succeeds), GoonCitizen opens **Keys**. Desktop still uses the Identity / Settings overlay modals.

**On-device key storage.** The password-sealed identity blob is wrapped by a hardware-backed Android Keystore AES-256-GCM key (`FabricKeyStore` plugin, alias `vc.goon.android.identity-wrap`; StrongBox when the device has it, else TEE) and written to app-private `files/identity.wrapped`. Unlock still needs the password (inner AES-GCM). Older installs migrate from Capacitor Preferences / WebView `localStorage` once, then those copies are deleted. Seed / xprv screens set `FLAG_SECURE`. The APK opts out of Google Auto Backup and device-to-device transfer so the wrap file never leaves the device via cloud.

**Keys / Linked signers / Security / Privacy.** These are dedicated dashboard pages (`#keys`, `#signers`, `#security`, `#privacy`; an old `#devices` link opens `#signers`) so the mobile UI never opens the cluttered Identity or Settings cards for day-to-day key work:

| Page | What it is |
|------|------------|
| **Keys** | This device’s pubkey / xpub, recovery backups, reveal seed, encrypted backup export/import, **Forget identity** |
| **Linked signers** | The apps linked to this player (Passport, a Hub, GoonCitizen elsewhere) with what each may do, **Add a signer** (show an invitation as QR / copy, or use one), signing requests waiting for you (**Sign** / **Decline**), per-app account sync (**DeviceDataShare**). **Sync account now** re-registers on Hub and re-publishes the share. **Revoke** / **Unlink** |
| **Security** | Unlock, lock / auto-lock, the same linked-signer embed, forget identity |
| **Privacy** | Profile, presence. **Relay & advanced…** is the escape hatch for Advanced mode and desktop-shaped relay settings |

The identity chip and header ⚙ open these pages (chip → Keys / Security when locked; ⚙ → Privacy; header sync chip **Manage linked signers** → Linked signers). Add a signer, Revoke, and Unlink also live on **Security**. Desktop uses the same Linked signers page (`#signers`) from the identity flyout.

**Linking a signer** (D-022; `@fabric/core` `docs/DELEGATION.md`). Any of Passport, GoonCitizen Android, GoonCitizen desktop, or a Hub can **show** an invitation or **use** one; each keeps its own key and its own message store. **Add a signer → Show an invitation** signs a `DELEGATION_LINK_OFFER` naming an allowlisted hub (`https://relay.goon.vc` by default — HTTPS rendezvous only) and shows it as a `fabric:` QR and a copy button. The other app scans it with the **header QR button**, opens it as a `fabric:` deep link, or pastes it into **Use invitation**. Both screens then show the same six-digit code; the player confirms it matches and picks what the other app may do (**Act as this player** — `identity`, **Sign in to websites** — `passport`, **Ask you to sign messages** — `message`). Each side signs its `DELEGATION_GRANT` from its **local node**; grants and revokes are stored locally and gossiped as `DelegationShare` so later peers verify the cluster without re-pairing. **Both** sides must grant `identity` before they are one player (one-way shows as "Waiting for the other side to grant identity"). Each linked node then gossips a compact `DeviceDataShare` (profile, Federation groups, notes, local tags, a bounded chat slice, plus `account.peers` LAN RFC1918 / advertise-host dial hints — never seeds, xprvs, or tokens) as AMP hex in a `FabricMessageCollection`. LiveRelay also registers those LAN hints on Hub `RegisterWebRTCPeer` (coordinator — not ICE) so the sibling can `ListWebRTCPeers` and TCP-dial `:7777` on the same Wi-Fi. The sibling applies that share only when the signer is in the same identity cluster. Hub seeds still relay when LAN is blocked; Passport / Hub browser uses Hub WebRTC signaling. Group journals still catch up over `GroupJournalRequest` / `GroupJournalBatch`. Account replay is Fabric-only; HTTPS `/identity/cluster/sync` is a session export/ingest of the same collection, not pairing. HTTPS `/delegations` stays pairing rendezvous.

**Signing requests.** A linked signer with the `message` (or `passport`) grant asks with a `DELEGATION_REQUEST`, left in a mailbox on the hub (`/services/delegation/mailbox`, polled every 30 s). Nothing signs on its own: it lands in **Notifications** with **Sign** / **Decline** (and a toast), and Sign answers with a signed `DELEGATION_RESULT`.

**Revoke** lives on Linked signers / Security (Android) / Identity and on Settings / Security & privacy (desktop). It signs a `DELEGATION_REVOKE` for that grant; **Unlink** revokes every grant to that signer. A stolen phone **is** the person until another linked signer revokes its grants.

Sign-in is Passport v2 (D-021). Android signs in to a relay as a native client (`functions/fabricLoginClient.js`: `POST /sessions/challenges` with `X-Fabric-Native: 1` through native HTTP, so the WebView adds no `Origin`; `POST /sessions` with the binding secret; Bearer token in memory). Desktop, Passport, and Android can each sign in to a supporting Fabric site — that does **not** share a seed. There is no `fabric://login`. Canonical display id = lexicographically smallest x-only pubkey.

## Architecture (threat model)

| Plane | Where |
|-------|--------|
| UI | Capacitor WebView, assets bundled in the APK |
| Local API | LiveRelay on `http://127.0.0.1:3041` (`SC_MODE=android`) |
| Identity | This device’s seed, Keystore-wrapped in app-private files; unlock posts to the local node (`POST …/identity/session`, loopback only) |
| Store | JSON collections under the Capacitor Node data path (groups, chat, missions, replay). Native LevelDB is not used — Capacitor’s Node 18 `libnode` cannot load `classic-level`. The Fabric Peer uses a JS Level shim. |
| Remote | `@fabric/core` Peer on port 7777 → seeds `hub.fabric.pub:7777` and `relay.goon.vc:7777` |

HTTP is loopback-only (`httpSharedMode` is off and hidden). Game.log, snapshots, and Discord bot credentials are desktop LiveRelay controls.

The Capacitor-NodeJS engine loads `android-www/nodejs/index.js`, which **always calls `main()`** in the staged `scripts/android-node.js` (a bare `require()` does not start LiveRelay). Plugin `startMode` is **`auto`**. Loopback HTTP binds **before** `require('LiveRelay')` so the wait screen can leave as soon as `GET /services/star-citizen` answers; other APIs queue until LiveRelay attaches. Staging skips Hub UI packages (webpack, React, discord.js, …) so the first-launch copy of `files/nodejs` is the local Peer runtime, not a Hub desktop tree.

## Build (sideload)

Requires Android Studio / SDK **and** Homebrew **OpenJDK 21** (`JAVA_HOME=/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home`). Node 26.12.1 on the build machine. Capacitor 7 compiles the Android project as Java 21. The APK embeds `@choreruiz/capacitor-node-js` (Node 18 runtime + `libnode`).

```bash
export JAVA_HOME=/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home
export ANDROID_HOME=$HOME/Library/Android/sdk
npm i
npx cap add android          # once — generates android/
npm run android:sync         # build dashboard, stage LiveRelay into android-www/nodejs, patch intents
emulator -avd Medium_Phone_API_36.0   # or any arm64 AVD
cd android && ./gradlew :app:installDebug
adb shell am start -n vc.goon.android/.MainActivity
```

`npm run android:run` is `npx cap run android` (needs the same `JAVA_HOME`; do not use JDK 25 with this Gradle).

Optional desktop-shaped check of the same settings: `npm run start:android`.

App id: `vc.goon.android`. The first paint is a local-node wait screen, then the dashboard. There is **no origin picker** for `relay.goon.vc`.

Deep links: a `fabric:` signer invitation (`DELEGATION_LINK_OFFER`) opens **Linked signers** with the invitation filled in; nothing is fetched until the player presses **Use invitation**. The app registers no `fabric://login` or `fabric://link` (`scripts/android-patch.js` removes filters left by an older patch). Invitations naming a non-allowlisted hub are refused. Grants are signed by the **local** node, which gossips them on Fabric.

Embedded Node: `@choreruiz/capacitor-node-js` loads `android-www/nodejs/` (`startMode: auto`). `npm run android:sync` copies LiveRelay sources into `android-www/nodejs/app` (gitignored; dashboard HTML stays in `android-www/index.html`, not the Node tree), **location and ship catalogs** from `data/locations` and `data/ships` (not personal `data/fleets` dumps), Fabric runtime packages into `android-www/nodejs/node_modules` (JS `level` shim, no `classic-level` `.node`; Hub UI deps such as webpack / React / discord.js are skipped; fills hoisted nested deps such as `xtend` for `through2@2`), and Node `builtin_modules` into app assets. After install, wipe `files/nodejs` once (`run-as vc.goon.android rm -rf files/nodejs`) so Capacitor recopies assets.

## What the mobile app hides

Desktop LiveRelay controls that cannot work on the companion:

- Game.log path, corpus / **My logs**, Home Analyze (missions charts, QT, pilots, parser rules)
- Snapshots / **Library**
- Discord **bot** settings (token, Bot settings page). Shared Discord catalog from Federation groups can still appear in Chat.
- Hub Bitcoin proxy — **Wallet** tab and Keys **Associated funds**
- Files catalog (advanced **Files** tab; chat 📎 stays off while `documents.enable` is false)
- Hub HTTP peering **observe** (`hub.fabric.pub` / `relay.goon.vc` OPTIONS)
- `httpSharedMode`, overlay, and relay restart

The device still shows Groups, Chat (Fabric), Missions, Fleets, Network (Feed + Peers), Notifications, and Keys / Linked signers / Security / Privacy. Those paths use the **local** LiveRelay + Fabric Peer (store, message validation, replay).

## Verification

- Airplane mode: dashboard loads from the APK; API calls stay on `127.0.0.1`; no application traffic to `relay.goon.vc`. **Add a signer** and signing-request mailboxes are the exception (HTTPS rendezvous / mailbox only).
- First launch: create / restore seed or xprv / import backup → **Keys** shows pubkey; ⚙ opens **Privacy**, not the Settings overlay. If an identity already exists, Unlock offers **Forget identity on this device** (type `forget`) so a lost password cannot trap the app.
- Unlock identity → **Linked signers → Add a signer → Show an invitation** on desktop, then scan it with the phone’s header QR button (or paste it into **Use invitation**) → both screens show the same six-digit code → **The codes match** with **Act as this player** on both sides (Linked signers shows “Waiting for the other side to grant identity” until mutual) → a third peer’s Profile/Chat shows **one** actor with two pubkeys. Same-WiFi phone and desktop should log `fabric peering webrtc-hub` then `fabric sync … DeviceDataShare`.
- Group membership on the desktop pubkey → a linked mobile device in the same cluster can post GroupChat without a second invite.
- Revoke (or Unlink) from **Linked signers** or **Security** on the phone (or Identity / Settings on desktop) on any remaining linked signer → the revoked app loses cluster equivalence.
- Passport sign-in on Chrome still works (D-021); there is no login QR to scan.
- Non-allowlisted hub refused.
- Chat POST to `http://127.0.0.1:3041/services/star-citizen/chat/messages` succeeds after the wait screen (the local node must be listening).

See `DECISIONS.md` D-010 / D-022 and `docs/THREAT-MODEL.md`.
