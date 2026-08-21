# Intelligence operations (downstream orgs)

How another organization runs **this node** as their own intelligence desk —
without joining G00N, and without subclassing Hub.

The org is a **Federation Group**, not a string in our source tree. The
whitelabel is **`settings/local.js`** (copy [`settings/example.js`](../settings/example.js);
gitignored). Chrome that `local.js` cannot change is listed at the end.

Why this tree: [`APPLICATION.md`](APPLICATION.md). Call:
[`DEVELOPERS.md`](../DEVELOPERS.md). Threat model: [`THREAT-MODEL.md`](THREAT-MODEL.md)
(hostile orgs, Discord infiltrators). Public seed: [`PRODUCTION.md`](PRODUCTION.md).

---

## Groups are the org

GoonCitizen does not hard-code an RSI org id. **Groups**
([`contracts/gooncitizenGroup.js`](../contracts/gooncitizenGroup.js),
[`services/GroupManager.js`](../services/GroupManager.js)) are Hub-aligned
Federation contracts. Each Group is its own `CONTRACT_PUBLISH`. Membership,
chat, shares, and journal live on **that** contract.

| You want… | Use |
|---|---|
| The flying org / alliance | One **public** Group. Share an opaque `fabric:` clip (D-019). Recipients Import… and Apply / Join. |
| Squads, fleets, intel cells | Nested Groups (`parentId`). Children inherit the tree for membership filters (`isInGroupTree`). |
| A quiet cell | A **private** Group. Share is clipboard-only (not mesh-flooded). Targeted Invite still relays to a pubkey. |
| A list only you see | **Local tags** (`GET\|POST …/local-groups`) — operator-only, not a Federation org. |
| Notes on a person | **Identity notes** (`…/notes`) — private on this node until `NoteShare` / `NoteUpdate` to a Group or peer. |

The Group is the **sharing boundary** across installs (D-010). Mission
broadcasts with group scope are membership-filtered on receive. `GroupDataShare`
packs (chat catalog / messages, opt-in playtimes / pinned files) merge into one
**world view** so operators without Discord credentials still see what members
shared.

That merge **is** the intelligence operation: Discord guilds and messages you
collected, Fabric identities you linked (`!link`), notes you wrote, local tags,
public Groups and fleets, peer aliases. Chat **Search people…** and hover cards
(common Discord servers, common Fabric groups) read that view
(`GET …/world-view`). `/lookup` races peers for a master local report.

Do not treat Hub, `goon.vc`, or `relay.goon.vc` as your org. They are mesh
seeds and a zipper. Your org is the Group you publish and the nodes that join
it.

### Stand up the org Group

1. Run a node (`npm start` / `npm run desktop`). Unlock identity.
2. Groups → create. Name it your org. Public if you want Import-from-share;
   private if membership is invite-only.
3. Groups → **Share**. Copy the opaque `fabric:` Message (Settings can prefer
   hex). That clip is the join artifact — not an HTTP page URL.
4. Pin it as this instance’s default org (next section:
   `defaultGroupMessageId`).
5. Optional: **+ Channel** for a subgroup; pin Discord channels on the Group
   (bot required to post as the bot).
6. Settings → Discord → share group data when you mean the world-view packs
   to leave this node (`shareDiscordCatalog`, default **off**).

Member machines Import the same share (or you ship `defaultGroupMessageId` in
their `local.js`). Notifications holds Apply / Join. Creators accept
applications. The Group **Log** is the journal (Data / Fabric hash when
present).

---

## Whitelabel: `settings/local.js`

Copy the example. **Never commit** `settings/local.js` (tokens, paths, Hub
admin files). Env vars win over this file for secrets and bind addresses.

```bash
cp settings/example.js settings/local.js
```

LiveRelay reads `local.js` at boot (`scripts/node.js`). After start, many keys
also live in the Fabric Store `settings` collection (Settings UI). Store wins
for allowlisted keys once set (`functions/settingsStore.js`).
`defaultGroupMessageId` in `local.js` only **seeds** `primaryGroupId` when the
Store value is still empty.

### Annotated starter (intelligence desk)

```js
'use strict';

module.exports = {
  // Peering / HTTP display name — not the cryptographic identity.
  name: 'AEGIS-INTEL',

  // Seed this machine’s primary Group (the org). Paste from Groups → Share:
  // opaque fabric: clip, AMP message id (64 hex), or group id.
  // UI also emits a snippet via functions/defaultGroupMessage.js.
  defaultGroupMessageId: 'fabric:…',

  logfile: null, // null = auto-detect Star Citizen; omit Game.log on a server

  http: {
    enable: true,
    port: 3041
    // sharedMode: true  // LAN dashboard; writes need a session. Prefer loopback.
  },

  fabric: {
    listen: true,
    port: 7777,
    // Keep public hubs so you are on the mesh. Add your seed; you may remove ours.
    peers: ['hub.fabric.pub:7777', 'relay.goon.vc:7777']
    // interface: '0.0.0.0',
    // Public hostname for P2P_PEERING_OFFER (your seed): set FABRIC_PUBLIC_HOST.
  },

  // Your Discord application — never ours. Token via env, not this file, in prod.
  discord: {
    enable: true,
    // token: process.env.DISCORD_BOT_TOKEN,
    // app: { id: process.env.DISCORD_APP_ID, secret: process.env.DISCORD_APP_SECRET },
    // channel: process.env.DISCORD_CHANNEL_ID,
    announceActivities: false,
    announceKills: false,
    announcePlayerJoins: false,
    announceMissions: false
  },

  // Quiet intel node: leave Files/Wallet off until you need them.
  documents: { enable: false },
  bitcoin: { enable: false, hub: 'http://127.0.0.1:8080', network: 'regtest' }
};
```

### What each block is for

| Key | Intelligence use |
|---|---|
| `name` | Alias on peering HTTP (`/services/peering`). Identity remains the pubkey. |
| `defaultGroupMessageId` | Pins **your org Group** as `primaryGroupId` on first start. Overlay / HUD defaults follow that Group. |
| `fabric.peers` | Who you dial. Empty saved list is respected (no forced GoonCitizen hubs). Add `yourexample.org:7777` when you host [`PRODUCTION.md`](PRODUCTION.md). |
| `fabric.port` / `FABRIC_PORT` | Peer listen (default 7777). Do not collide with Hub on the same NIC. |
| `FABRIC_PUBLIC_HOST` | Required on a public seed so the node does not self-dial. |
| `discord.*` | **Your** bot. World-view catalog accumulates from the gateway **and** from `GroupDataShare`. Peers without a token still merge shares. |
| `DISCORD_BOT_TOKEN` (env) | Prefer env over `local.js`. Never commit. |
| `http` | Dashboard. Default loopback. `SC_MODE=server` + Caddy for a hosted desk. |
| `documents.enable` | Local Files catalog (Advanced). Chat 📎 still writes the catalog. |
| `bitcoin.enable` | Personal Hub-wallet proxy. Off for a desk that is not paying. Group Taproot treasury is **on the Group**, not this flag ([`APPLICATION.md`](APPLICATION.md) §9). |
| `logfile` / `SC_LOGFILE` | Game.log path. Server mode does not tail. Share of parsed events is **opt-in** (`shareLogsGlobal` / per-peer `shareLogs`, D-017). |
| `SC_OFFICERS` | Mission-register officer allowlist (pubkeys). Empty + server mode refuses officer writes. |

### Env that should stay out of git

```bash
export FABRIC_XPRV=…                 # operator identity (suite-wide)
export DISCORD_BOT_TOKEN=…
export DISCORD_APP_ID=…
export DISCORD_APP_SECRET=…
export DISCORD_CHANNEL_ID=…          # announce; also scopes DiscordRequest
export SC_OFFICERS=pubkey1,pubkey2
export SC_DEFAULT_GROUP_MESSAGE_ID=  # same as defaultGroupMessageId
export FABRIC_PUBLIC_HOST=intel.example.org
export FABRIC_HUB_ORIGIN=https://hub.fabric.pub   # login/link allowlist family
```

Identity: `FABRIC_XPRV` / `FABRIC_MNEMONIC` / `~/.fabric/wallet.json`. Do not
put seeds in `local.js`.

### After first boot (Settings UI / Store)

These are **not** `local.js` keys; they persist in the register Store:

| Setting | Default | Intel note |
|---|---|---|
| `shareDiscordCatalog` | off | Gossip `chat.catalog` / `chat.messages` to Groups you belong to. |
| `shareLogsGlobal` / per-peer `shareLogs` | off | Gameplay events leave the node only when you authorize. |
| `sharePlaytimes` | off | Weekday×hour grid on **your** profile (When you fly → Publish when I fly), not someone else’s heatmap. |
| `groupChatSeal` | off | v2 participant seal is hub-blind; v1 tip-HKDF is not. |
| `nickname` / `profile` | empty | Display only; pubkey is the actor. |
| `primaryGroupId` | seeded from `defaultGroupMessageId` | Local HUD; membership is still the Group contract. |

---

## Chrome `local.js` cannot change

Rebuild / fork for installer and SPA title:

| File | What it is |
|---|---|
| [`constants.js`](../constants.js) `NAME` / `BRAND_NAME` | Tray, window title, Electron IPC brand |
| [`components/Dashboard.js`](../components/Dashboard.js) `TITLE` | SPA `<title>` (`npm run build:browser`) |
| [`package.json`](../package.json) `build.productName`, `appId`, `executableName` | Desktop installers |
| Android `vc.goon.android` | APK application id — see [`ANDROID.md`](../ANDROID.md) |

Keep speaking Fabric (Peer `:7777`, opaque `fabric:` Group shares, opt-in log
share). Paint the rest. [`APPLICATION.md`](APPLICATION.md) lists what to copy
vs delete.

---

## A desk that is not a public seed

Loopback HTTP, Fabric Peer on, Discord bot with **your** token, `defaultGroupMessageId`
set, `shareDiscordCatalog` on only for Groups you intend to feed, log share
off. Members run desktop/Android with the same Group share. You do not need
`relay.goon.vc` except as an optional mesh seed.

A desk that **is** a seed: [`PRODUCTION.md`](PRODUCTION.md) — `SC_MODE=server`,
HTTP loopback behind TLS, Peer on a public NIC, `FABRIC_PUBLIC_HOST` yours
(not `65.21.231.149`).
