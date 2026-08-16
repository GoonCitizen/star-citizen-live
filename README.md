# Star Citizen Live
A Node.js service that watches the Star Citizen `Game.log` file (read-only) and
relays gameplay — logins, missions/objectives, combat-progress, player-downs,
and (on older game builds) kills — to a **live web dashboard**, optional
**Discord**, and a REST API. On top of the relay: an **officer-validated mission
register**, Federation **Groups**, signed chat, and a **Fabric Peer**.

> **Call for developers.** G00N SQUAD, PERMAFLEET, and other orgs (including
> competitors): run a node, send a patch, or fork and rebrand. Using the code
> still speaks the Fabric Protocol. See **[DEVELOPERS.md](DEVELOPERS.md)**.
>
> **What runs:** `npm start` → `services/LiveRelay.js` plus a Fabric Peer
> (D-009 / D-010). Node.js **24.15.0**, then `npm i` (Fabric git pins). Current
> surface: **[AGENTS.md](AGENTS.md) §3–§4**. D-002 removed a heavyweight
> *transport*; the protocol is back. `services/StarCitizen.js` is reference only.

## Features

- 🎮 **Read-only live monitoring** of the game log, with **auto-detection** of the
  install and channel (LIVE / PTU / EPTU / HOTFIX / TECH-PREVIEW) across drives —
  it picks the log you're actually playing and survives the game rotating it.
- 📜 **Real SC 4.x log parser** — logins, sessions/build/hardware, missions,
  objectives, notifications, mission-type classification, and player-down detection.
- ⚔️ **Combat-progress proxy** inferred from mission objectives (the current game,
  4.8.0, no longer logs kills — see below).
- 💀 **Kill / vehicle-destruction feed** — format-verified on real ≤4.3.0 logs;
  wired to the dashboard and Discord. *Dormant on the current game build.*
- 📊 **Live dashboard** (`/`) + **REST API** (JSON).
- 💬 **Optional Discord webhook** with rich embeds.
- 📝 **Officer-validated mission register** — post → apply → assign → claim →
  officer-validate, with a hash-chained audit trail.
- 🌐 **Fabric Network** — Peer on `:7777` (default seeds `hub.fabric.pub` and
  `relay.goon.vc`), Federation Groups, signed chat. Gameplay log share is **opt-in**.

> **Note on kills:** CIG **removed** kill logging (`<Actor Death> CActor::Kill`,
> `<Vehicle Destruction>`) after SC **4.3.0**. The kill feed is verified against
> historical ≤4.3.0 logs but will **not** fire on the current game (4.8.0). See
> `PROGRESS.md` (top) for the full finding.

## Requirements

**Node.js 24.15.0** (see `.nvmrc`). Then `npm i` — Fabric is pinned from Git
(`.npmrc` sets `allow-git=all`). Desktop / mesh paths are not zero-dependency.

## Quick start

```bash
npm i            # Fabric git deps
npm start        # LiveRelay → http://localhost:3041/
npm test         # unit + fabric + relay + integration + ui
npm run desktop  # Electron shell
npm run replay -- /path/to/Game.log
```

Then open:

- **Dashboard:** http://localhost:3041/
- **Status JSON:** http://localhost:3041/services/star-citizen

`npm start` auto-detects your Star Citizen install. It **only ever reads** the log
— it never modifies your game installation. Contributor / org call:
[DEVELOPERS.md](DEVELOPERS.md).

## Configuration

Configuration is via environment variables (preferred for secrets) or an optional
`settings/local.js` (copy `settings/example.js`).

| Variable | Purpose |
|----------|---------|
| `SC_LOGFILE` | Force an exact `Game.log` path (highest priority). |
| `SC_CHANNEL` | Force a channel, e.g. `HOTFIX` (when auto-detect ties). |
| `SC_SEED` | Pre-fill the monitor from a different log on start. |
| `DISCORD_WEBHOOK_URL` | Enable Discord posting (optional). |
| `SC_OFFICERS` | Comma-separated officer allowlist for the mission register. |
| `SC_REGISTER_DIR` | Fabric Store (LevelDB) for all internal storage — missions, groups, settings. Default: `stores/gooncitizen/register`. |
| `SC_SETTINGS_DIR` | Named Fabric store root (like Hub `stores/hub`). Default: `stores/gooncitizen`. |

**Never commit secrets.** `settings/local.js`, `settings/auth.txt`, and `.env` are
gitignored. To enable Discord, create a webhook (Server Settings → Integrations →
Webhooks) and set `DISCORD_WEBHOOK_URL`.

## REST API

Base path: `/services/star-citizen`.

- `GET /` — live dashboard (HTML)
- `GET /services/star-citizen` — status summary
- `GET …/monitor` — dashboard snapshot (counts, recent lines, flagged, kills, missions)
- `GET …/missiongroups` — missions grouped by MissionId (objectives nested)
- `GET …/combat` — combat-progress proxy
- `GET …/<collection>` — `activities`, `players`, `logins`, `vehicles`, `kills`,
  `incaps`, `missionlog`, `notifications`, `messages`
  (`POST` accepted on `activities`, `players`, `vehicles`, `kills`)
- **Mission register:** `GET|POST …/missions`, `GET …/missions/:id`,
  `GET …/missions/:id/applications`, `POST …/missions/:id/{apply,claim,cancel}`,
  `POST …/applications/:id/decision`, `POST …/claims/:id/validate`, and read lists
  `GET …/{applications,claims,validations,audit}`

Errors map to **403** (officer forbidden), **404** (not found), else **400**.

## Documentation

- `DEVELOPERS.md` / `CONTRIBUTING.md` — call for G00N SQUAD, PERMAFLEET, and other orgs (maps the rest of this list).
- `AGENTS.md` / `CLAUDE.md` — full project context for AI coding assistants (current surface).
- `QUICKSTART.md` / `ELECTRON_BUILD.md` / `ANDROID.md` — run desktop, installer, sideload.
- `docs/PRODUCTION.md` — public Fabric seed operators.
- `SECURITY.md` / `docs/THREAT-MODEL.md` — claims vs non-claims.
- `docs/API-SURFACES.md` — IPC vs HTTP vs Fabric (not `API.md`).
- `CONTINUE.md` — how to run/replay right now (partially stale; prefer AGENTS §3).
- `PROGRESS.md` — milestone + retrospective trail (newest first).
- `DECISIONS.md` — the *why* behind key choices (ADRs).
- `SOLUTION-BRIEF.md` / `Permafleet-Solution-Brief.md` — plain-English product brief.
- `DESIGN-missions-mvp.md`, `DESIGN-distributed.md` — technical designs.
- `START-HERE-claude-code.md` — first session with an AI coding tool.

## License

MIT. Forked from `martindale/star-citizen-live` (upstream
`GoonCitizen/star-citizen-live`); originally built with [Fabric](https://fabric.pub)
by Fabric Labs.
