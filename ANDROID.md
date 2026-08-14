# GoonCitizen Android
Sideload APK first. The mobile app is a **local GoonCitizen node**: bundled dashboard, loopback LiveRelay, and a **local Fabric Peer**. If the network is off, the app still loads and talks only to that local node. Remote application traffic (chat, groups, missions, IdentityCrossSign) goes over Fabric — not HTTPS to `relay.goon.vc`.

D-011 / D-013 **HTTPS** to an allowlisted hub remains pairing / site-login **rendezvous only**.

## Identity

Every device (Passport, desktop, Android, Hub browser) has its **own keypair / seed**. Linking does **not** copy a mnemonic.

**First-run.** On first launch the device uses a full-screen onboarding page (not a desktop overlay): **Create new identity**, **Restore seed or xprv**, or **Load from backup file**. Optional **Master seed wizard…** derives one seed + password into a Bitcoin xprv and per-device identity xprvs (install the first-device xprv here; restore the companion xprv on another device). After the seed is written down (or a restore/import succeeds), GoonCitizen opens **Keys**. Desktop still uses the Identity / Settings overlay modals.

**Keys / Security / Privacy.** These are dedicated dashboard pages (`#keys`, `#security`, `#privacy`) so the mobile UI never opens the cluttered Identity or Settings cards for day-to-day key work:

| Page | What it is |
|------|------------|
| **Keys** | This device’s pubkey / xpub, recovery backups, reveal seed, encrypted backup export/import, **Forget identity** |
| **Security** | Unlock, lock / auto-lock, **Add a device**, linked devices / **Revoke**, forget identity |
| **Privacy** | Profile, presence. **Relay & advanced…** is the escape hatch for Advanced mode and desktop-shaped relay settings |

The identity chip and header ⚙ open these pages (chip → Keys / Security when locked; ⚙ → Privacy). Add a device and Revoke live on **Security**, not a stacked modal.

**Peer-equivalent pairing.** Any of Passport, GoonCitizen Android, GoonCitizen desktop, or Hub browser can **create** a `fabric://link` offer or **accept** one. Security → **Add a device** (or Passport Settings → Security & privacy) posts the offer to an allowlisted hub (`https://relay.goon.vc` by default — HTTPS rendezvous only) and shows:

1. **QR / `fabric://link?sessionId&hub`** — the other GoonCitizen app opens the in-app approve card.
2. **HTTPS landing** `https://<hub>/#device-link=<sessionId>` — Chrome with Fabric Passport. The hosted dashboard `postMessage`s `FABRIC_DEVICE_LINK_REQUEST` (Passport requires page origin = hub origin).

After `status: linked`, each side publishes `IdentityCrossSign` from its **local node** (Fabric `CONTRACT_MESSAGE` wrapping a BIP340-signed body). The signed object is stored locally and re-gossiped to later peers so they can verify the cluster without re-running `/device-links`.

**Revoke** lives on Security (Android) / Identity and on Settings / Security & privacy (desktop). It publishes `IdentityCrossSignRevoke` (same BIP340 construction). A stolen device **is** the person until another cluster member revokes.

Site login (D-011) stays interchangeable: `fabric://login` and Passport `FABRIC_SITE_LOGIN_REQUEST` sign `POST /sessions`. Desktop, Passport, and Android can each sign in to a supporting Fabric site — that does **not** share a seed. Canonical display id = lexicographically smallest x-only pubkey.

## Architecture (threat model)

| Plane | Where |
|-------|--------|
| UI | Capacitor WebView, assets bundled in the APK |
| Local API | LiveRelay on `http://127.0.0.1:3041` (`SC_MODE=android`) |
| Identity | This device’s seed; unlock posts to the local node (`POST …/identity/session`, loopback only) |
| Store | JSON collections under the Capacitor Node data path (groups, chat, missions, replay). Native LevelDB is not used — Capacitor’s Node 18 `libnode` cannot load `classic-level`. The Fabric Peer uses a JS Level shim. |
| Remote | `@fabric/core` Peer on port 7777 → seeds `hub.fabric.pub:7777` and `relay.goon.vc:7777` |

HTTP is loopback-only (`httpSharedMode` is off and hidden). Game.log, snapshots, and Discord bot credentials are desktop LiveRelay controls.

The Capacitor-NodeJS engine loads `android-www/nodejs/index.js`, which **always calls `main()`** in the staged `scripts/android-node.js` (a bare `require()` does not start LiveRelay). Plugin `startMode` is **`auto`**. The dashboard waits until loopback HTTP answers before rendering Chat / Groups.

## Build (sideload)

Requires Android Studio / SDK **and** Homebrew **OpenJDK 21** (`JAVA_HOME=/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home`). Node 24.15.0 on the build machine. Capacitor 7 compiles the Android project as Java 21. The APK embeds `@choreruiz/capacitor-node-js` (Node 18 runtime + `libnode`).

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

Deep links: `fabric://login` and `fabric://link` open the in-app approval card (hub origin + purpose). Non-allowlisted hubs are refused. After device-link, `IdentityCrossSign` is posted to the **local** node, which gossips it on Fabric.

Embedded Node: `@choreruiz/capacitor-node-js` loads `android-www/nodejs/` (`startMode: auto`). `npm run android:sync` copies LiveRelay sources into `android-www/nodejs/app` (gitignored), Fabric runtime packages into `android-www/nodejs/node_modules` (JS `level` shim, no `classic-level` `.node`; fills hoisted nested deps such as `xtend` for `through2@2`), and Node `builtin_modules` into app assets. After install, wipe `files/nodejs` once (`run-as vc.goon.android rm -rf files/nodejs`) so Capacitor recopies assets.

## What the mobile app hides

Desktop LiveRelay controls that cannot work on the companion:

- Game.log path, corpus / **My logs**, Home Analyze (heatmap, missions charts, QT, pilots, parser rules)
- Snapshots / **Library**
- Discord **bot** settings (token, Bot settings page). Shared Discord catalog from Federation groups can still appear in Chat.
- Hub Bitcoin proxy — **Wallet** tab and Keys **Associated funds**
- Files catalog (advanced **Files** tab; chat 📎 stays off while `documents.enable` is false)
- Hub HTTP peering **observe** (`hub.fabric.pub` / `relay.goon.vc` OPTIONS)
- `httpSharedMode`, overlay, and relay restart

The device still shows Groups, Chat (Fabric), Missions, Fleets, Network (Feed + Peers), Notifications, and Keys / Security / Privacy. Those paths use the **local** LiveRelay + Fabric Peer (store, message validation, replay).

## Verification

- Airplane mode: dashboard loads from the APK; API calls stay on `127.0.0.1`; no application traffic to `relay.goon.vc`. **Add a device** is the exception (HTTPS pairing rendezvous only).
- First launch: create / restore seed or xprv / import backup → **Keys** shows pubkey; ⚙ opens **Privacy**, not the Settings overlay. If an identity already exists, Unlock offers **Forget identity on this device** (type `forget`) so a lost password cannot trap the app.
- Unlock identity → **Security → Add a device** (or paste / open a `fabric://link` started on desktop — camera QR or **Open link** on Security) → both `IdentityCrossSign` verified on the mesh → a third peer’s Profile/Chat shows **one** actor with two device pubkeys.
- Group membership on the desktop pubkey → a linked mobile device in the same cluster can post GroupChat without a second invite.
- Revoke from **Security** on the device (or Identity / Settings on desktop) on any remaining cluster member → the revoked device loses cluster equivalence.
- Laptop SiteLogin QR → mobile D-011 still works; Passport `postMessage` on Chrome still works.
- Non-allowlisted hub refused.
- Chat POST to `http://127.0.0.1:3041/services/star-citizen/chat/messages` succeeds after the wait screen (the local node must be listening).

See `DECISIONS.md` D-010 / D-013 and `docs/THREAT-MODEL.md`.
