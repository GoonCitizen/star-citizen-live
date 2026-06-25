# Star Citizen Live

A **zero-dependency Node.js service** that watches the Star Citizen `Game.log`
file (read-only) and relays gameplay — logins, missions/objectives,
combat-progress, player-downs, and (on older game builds) kills — to a **live web
dashboard**, an optional **Discord webhook**, and a small **REST API**. On top of
the relay runs an **officer-validated mission register** with a tamper-evident,
hash-chained audit log.

> This is a **Fabric-free** rebuild of the original `@rsi/star-citizen` Fabric
> service (the Fabric/p2p framework was removed — see `DECISIONS.md` → D-002). The
> service now runs on Node.js built-ins only. The original Fabric code is kept for
> reference but is not what runs.

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

> **Note on kills:** CIG **removed** kill logging (`<Actor Death> CActor::Kill`,
> `<Vehicle Destruction>`) after SC **4.3.0**. The kill feed is verified against
> historical ≤4.3.0 logs but will **not** fire on the current game (4.8.0). See
> `PROGRESS.md` (top) for the full finding.

## Requirements

**Node.js LTS (18+).** That's it — the service has **no runtime npm dependencies**.
There is **no `npm install` step** needed to run it.

## Quick start

```bash
npm start        # run the service
npm test         # run the test suite (Node's built-in runner)
npm run replay /path/to/Game.log   # replay a saved log and tally detected events
```

Then open:

- **Dashboard:** http://localhost:3041/
- **Status JSON:** http://localhost:3041/services/star-citizen

`npm start` auto-detects your Star Citizen install. It **only ever reads** the log
— it never modifies your game installation.

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
| `SC_REGISTER_DIR` | Persist the mission register to disk (default: in-memory). |

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

- `AGENTS.md` / `CLAUDE.md` — full project context for AI coding assistants.
- `CONTINUE.md` — how to run/replay right now.
- `PROGRESS.md` — milestone + retrospective trail (newest first).
- `DECISIONS.md` — the *why* behind key choices (ADRs).
- `SOLUTION-BRIEF.md` — plain-English product brief.
- `DESIGN-missions-mvp.md`, `DESIGN-distributed.md` — technical designs.

## License

MIT. Forked from `martindale/star-citizen-live` (upstream
`GoonCitizen/star-citizen-live`); originally built with [Fabric](https://fabric.pub)
by Fabric Labs.
