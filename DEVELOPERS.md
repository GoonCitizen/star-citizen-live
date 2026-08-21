# Call for developers

Make it work, make it right, make it fast. In that order.

**GoonCitizen** is MIT-licensed Star Citizen tooling that already speaks the
[Fabric Protocol](https://fabric.pub): a live `Game.log` relay, an
officer-validated mission register, Federation **Groups**, signed chat, and a
Fabric Peer that seeds `hub.fabric.pub:7777` and `relay.goon.vc:7777`.

This call has two audiences. Both are welcome.

1. **G00N SQUAD and PERMAFLEET** — build and operate the thing we actually fly.
2. **Every other org** — including competitors — fork it, paint it your colors,
   run your own Discord and your own Groups. You do not need our permission,
   our brand, or a conversation with us.

What we want from the second group is simple: **use the code**. A node that
speaks Fabric is a node on the Fabric Network. Compatible Groups, chat, and
(opt-in) activity still land on the same mesh. We do not need your allegiance.
We need compatible peers.

**Why this tree as the basis for another application** (not Hub, not a blank
Peer): [`docs/APPLICATION.md`](docs/APPLICATION.md) — frozen genesis, Group
Federation contracts, LiveRelay composition, login/device-link, packaging.

Current product surface: [`AGENTS.md`](AGENTS.md) §3–§4. [`CONTINUE.md`](CONTINUE.md)
still describes a retired Fabric-free `app/` skeleton — skip it.

---

## Where to read next

This file is the call. The rest of the tree is the product. Route by job:

| If you are… | Open |
|---|---|
| Joining to contribute (any org) | This file → [`AGENTS.md`](AGENTS.md) §3–§4 → [`PROGRESS.md`](PROGRESS.md) (newest) → [`DECISIONS.md`](DECISIONS.md) |
| Building a Fabric app on this node (not Hub) | [`docs/APPLICATION.md`](docs/APPLICATION.md) — artifacts to copy vs replace |
| Running an intel desk / whitelabel org | [`docs/INTELLIGENCE.md`](docs/INTELLIGENCE.md) — Groups as orgs, `settings/local.js` |
| Running a local / desktop node | [`QUICKSTART.md`](QUICKSTART.md), [`ELECTRON_BUILD.md`](ELECTRON_BUILD.md). Skip [`CONTINUE.md`](CONTINUE.md) until it is rewritten. Second laptop: [`MOBILE-SETUP.md`](MOBILE-SETUP.md) (not the Android APK). |
| Sideloading Android | [`ANDROID.md`](ANDROID.md) |
| Hosting a public Fabric seed | [`docs/PRODUCTION.md`](docs/PRODUCTION.md), [`SECURITY.md`](SECURITY.md), [`docs/THREAT-MODEL.md`](docs/THREAT-MODEL.md) |
| Org leadership (what / why) | [`SOLUTION-BRIEF.md`](SOLUTION-BRIEF.md) — lags LiveRelay; officer validation (D-005) still holds. Longer PERMAFLEET write-up: [`Permafleet-Solution-Brief.md`](Permafleet-Solution-Brief.md) |
| Changing HTTP, IPC, or Fabric wires | [`docs/API-SURFACES.md`](docs/API-SURFACES.md) (not [`API.md`](API.md)) |
| Parking an idea, not a PR | [`BACKLOG.md`](BACKLOG.md) |
| Missions / register design | [`DESIGN-missions-mvp.md`](DESIGN-missions-mvp.md), [`MISSIONS.md`](MISSIONS.md) |
| Older “no central server” sketch | [`DESIGN-distributed.md`](DESIGN-distributed.md) — D-009 / D-010 is what shipped; that file is not the runbook |
| Public HTML site (`goon.vc`, not this repo) | Sibling [`goon.vc` DEVELOPERS.md](https://github.com/GoonCitizen/goon.vc/blob/master/DEVELOPERS.md) / [`DEPLOY.md`](https://github.com/GoonCitizen/goon.vc/blob/master/DEPLOY.md). GoonCitizen still lives here. |
| First session with an AI coding tool | [`START-HERE-claude-code.md`](START-HERE-claude-code.md) (clone URL / branch lag) + [`AGENTS.md`](AGENTS.md) |

GitHub’s contributor entry is [`CONTRIBUTING.md`](CONTRIBUTING.md) (points here).
Issue templates: `.github/ISSUE_TEMPLATE/`.

---

## For G00N SQUAD and PERMAFLEET

You already have the game, the Discords, and the ops. We need people who will
**run a node**, **read a log**, **file a patch**, or **host a seed** — not a
committee.

### Why this is ours to staff

- **G00N SQUAD** is the flying org. Members who run the desktop (or Android)
  node are the live corpus: `Game.log` lines, fleet JSON, Discord bridge,
  mission register as officers actually use it.
- **PERMAFLEET** is the alliance / protectorate layer. Groups here are
  Federation contracts with optional parents — not a hard-coded org id. If you
  can stand up a Group, pin a Discord channel, and Share an opaque `fabric:`
  invite, you are doing the product.

You do not need to be a professional engineer. Honest reports from a real
install beat speculative architecture.

### What to work on (invitations, not a ship list)

The owner names the release cut. Do not invent a roadmap. Useful work that
already exists:

| You can… | Why it matters |
|---|---|
| Run `npm start` / `npm run desktop` on a play machine and file what breaks | The log is read-only and format-hostile. Real installs are the test. |
| Bring a **real** `Game.log` line when a parser rule is wrong or missing | Parser honesty: `verified:true` only against a real line, qualified by game version. Never invent CIG formats. |
| Add or extend a test next to the change (`tests/unit`, `tests/relay`, `tests/ui`, …) | `npm test` is the gate. |
| Operate the Discord bot for a guild you already admin | Bridged channels, `!link`, catalog share — needs a living server. |
| Import a Starjump / FleetViewer fleet and Share it into a Group | Fleet data is how other members see the hangar. |
| QA Android sideload (`ANDROID.md`) or a desktop installer | Packaging is how non-git members show up. |
| Refresh a stale doc so it matches `AGENTS.md` §3–§4 | README / CONTINUE / SOLUTION-BRIEF still lag LiveRelay + Fabric Peer. |
| Read [`docs/THREAT-MODEL.md`](docs/THREAT-MODEL.md) and report a mismatch | Peers may be hostile. Claims must stay honest. |

Do **not** reopen a deleted `app/` tree, bump `@fabric/*` pins casually, or
merge to `master`.

### How to send work

1. Branch from **`feature/rsi`** (current development line).
2. Keep the change small and reversible. Include tests.
3. Open a pull request against `feature/rsi`. The product owner reviews.
   Agents and contributors **propose**; they do not merge.
4. Secrets stay in env / gitignored `settings/local.js`. Never commit a Discord
   token, webhook, or seed.

Repo: [GoonCitizen/star-citizen-live](https://github.com/GoonCitizen/star-citizen-live).
Issues: use the **good first issue** template, or just describe what you ran
and what you saw.

---

## For other organizations

Fork it. Rebrand it. Run it on your Discord. Post missions your officers
validate. Create **your** Groups. Keep **your** identity keys.

This software is **MIT**. Keep the copyright notice. Change the rest.

GoonCitizen is the suite’s **reference application node** (compose Peer + Store;
do not subclass Hub). The contract files, LiveRelay, Groups, login, packaging,
**Group Taproot treasury**, and **publisher-profile pinned desktops** are the
basis — Star Citizen chrome is optional. Catalog:
[`docs/APPLICATION.md`](docs/APPLICATION.md) (artifacts 9–10).
Intel desk / Groups as orgs / `settings/local.js` whitelabel:
[`docs/INTELLIGENCE.md`](docs/INTELLIGENCE.md).

### What you get without talking to us

- A local node that tails `Game.log` (read-only) and a dashboard on
  `http://localhost:3041/`.
- Federation **Groups** as the sharing boundary — not a G00N membership
  requirement. Nested subgroups, opaque `fabric:` Share/Invite clips,
  GroupChat on that contract.
- A Fabric Peer on **`:7777`**. Default seeds are `hub.fabric.pub:7777` and
  `relay.goon.vc:7777`. You may add your own hub and remove ours.
- Opt-in gameplay uplink (`shareLogs` / `shareLogsGlobal`, default **off**).
  Chat and mission broadcasts publish when the Peer is up; logs do not leak
  unless you say so.
- Optional Discord bot (`@fabric/discord`) that you register under **your**
  application. We never need your bot token.
- A public-seed runbook if you want to be a mesh peer, not only a leaf:
  [`docs/PRODUCTION.md`](docs/PRODUCTION.md).
- An **alliance treasury** on each Federation Group (Taproot spend ladder on
  **your** node — Hub is not the custodian). Pin **your** desktop installers
  on **your** Fabric profile (`npm run publish:builds -- --pin`) so members
  install from identity, not from git.

You can fly against us in Stanton and still help the network. A compatible
Peer is enough. You do not have to contribute patches, join G00N, or say
Fabric out loud.

### Minimum path (org operator)

```bash
git clone https://github.com/GoonCitizen/star-citizen-live.git
cd star-citizen-live
# Node.js 24.15.0 — see .nvmrc
npm i          # .npmrc already sets allow-git=all for Fabric git pins
npm test       # unit + fabric + relay + integration + ui
npm start      # LiveRelay → http://localhost:3041/
# or: npm run desktop
```

Then: Identity (nickname / keys) → Groups (create or Import a `fabric:` share)
→ optional Discord in Settings → Peers (seeds; authorize log share only if you
mean it).

Hosted origin: `SC_MODE=server`, HTTP loopback behind Caddy/Nginx, Peer on a
public `:7777`. Do not copy `relay.goon.vc` NIC addresses; use yours.
Details: [`docs/PRODUCTION.md`](docs/PRODUCTION.md).

### Stay compatible (the part that actually matters)

If you fork, please keep:

- Fabric AMP/`Message` over TCP/NOISE for peering (not a private HTTPS-only island).
- Group shares as opaque `fabric:` Messages (D-019), not only HTTP page URLs.
- Log share **opt-in**.
- The Game.log **read-only**.
- Parser `verified` flags honest.

You may rename the product, replace the dashboard chrome, drop Bitcoin, or
ignore GoonCitizen mission types. Unknown contract namespaces must not crash
the Peer (D-012). That is how many orgs share one mesh without sharing one
brand. File-level list of what to copy vs delete:
[`docs/APPLICATION.md`](docs/APPLICATION.md).

---

## Contributor mechanics

**Node.js 24.15.0.** Fabric git deps need `npm i` (see `.npmrc`). Desktop /
mesh paths are not zero-dependency.

| Command | What |
|---|---|
| `npm start` | LiveRelay dashboard |
| `npm run desktop` | Electron shell |
| `npm test` | Gate before a PR |
| `npm run replay -- /path/to/Game.log` | Offline parser check |

Style: CommonJS, `'use strict'`, 2-space, semicolons, single quotes. Match the
file you are in. Prefer Node built-ins for new leaf helpers. Do not add
runtime npm dependencies without a strong reason.

**Parser:** never write to the Star Citizen install. Do not flip
`verified:true` without a real matching log line. Qualify “verified” by game
version (a 4.3.0 kill rule will not fire on 4.8.0).

**Missions:** the officer-validated register is the source of truth. The log
is supporting evidence (D-005).

Read [`AGENTS.md`](AGENTS.md) §3–§4, then newest [`PROGRESS.md`](PROGRESS.md),
then [`DECISIONS.md`](DECISIONS.md) (D-009 / D-010 are why Fabric is back;
D-002 removed a heavyweight *transport*, not the protocol).

---

## Paste-ready posts

### G00N SQUAD / PERMAFLEET (Discord)

```
Call for developers — GoonCitizen

We need people in G00N SQUAD and PERMAFLEET who will run a node, break it
on a real Game.log, or send a small patch. You do not need to be a
professional engineer.

Repo: https://github.com/GoonCitizen/star-citizen-live
Guide: DEVELOPERS.md (branch feature/rsi)
Run: Node 24.15 → npm i → npm start → http://localhost:3041/

Useful: real log lines for the parser, Discord bot ops, fleet JSON,
desktop/Android QA, tests next to a fix. PRs against feature/rsi. Do not
merge to master. Secrets stay in env — never paste a bot token here.
```

### Other orgs (Spectrum, Discord, forums)

```
GoonCitizen is MIT-licensed Star Citizen tooling: live Game.log relay,
officer-validated missions, Discord, and a Fabric Peer.

Fork it. Rebrand it. Run it for YOUR org. You do not join G00N by using
the code. Groups are yours. Identity keys are yours. Log share is off
until you turn it on.

This is a Fabric *application* node (not Hub). Why start here:
https://github.com/GoonCitizen/star-citizen-live/blob/feature/rsi/docs/APPLICATION.md

If your node speaks the Fabric Protocol, it is on the same network as
everyone else who does — including people you compete with. That is
intentional.

https://github.com/GoonCitizen/star-citizen-live/blob/feature/rsi/DEVELOPERS.md
```

---

## License

MIT. Forked from `martindale/star-citizen-live` (upstream
`GoonCitizen/star-citizen-live`). Originally built with
[Fabric](https://fabric.pub) by Fabric Labs. Keep the copyright/license
notice in files you copy.
