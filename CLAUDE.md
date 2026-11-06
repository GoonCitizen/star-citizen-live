# CLAUDE.md
The canonical, tool-agnostic project context for this repo lives in **`AGENTS.md`**
(the convention OpenAI's Codex and other tools read). Claude Code imports it below,
so both tools share the exact same context with no duplication or drift.

**Do not put project context here.** Edit `AGENTS.md` instead.

@AGENTS.md

## Fabric ecosystem workflow (shared)
This repo is **6 of 6 — @rsi/star-citizen (depends on core, http, discord, hub)** in the Fabric dependency order. Before installing or testing, read [docs/agents/](docs/agents/README.md):
- **Install** with `npm run report:install` (fresh lock, latest Git pins; log in `reports/install.log`).
- **Strictly serial:** one install or test run at a time across all Fabric repos, top down (core → http → discord → hub → passport → star-citizen). Stop on upstream failure.
- **Consolidate** into common APIs; Core messaging stays free of HTTP, HTTP is an adapter ([API_CONSOLIDATION.md](docs/agents/API_CONSOLIDATION.md)).
