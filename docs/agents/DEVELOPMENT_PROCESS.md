# Development process for agents

Shared across every Fabric repository. Read with
[DEPENDENCY_GRAPH.md](DEPENDENCY_GRAPH.md) and
[API_CONSOLIDATION.md](API_CONSOLIDATION.md).

## 1. Install with `npm run report:install`

Every Fabric repo defines `report:install`. It removes `node_modules` and
`package-lock.json`, runs a fresh `npm i` (with `--allow-git=all` where Git
pins are used), and writes the full log to `reports/install.log`.

- Use it to pull the **latest** commits behind each Git pin; a plain
  `npm install` against an old lockfile keeps stale upstream code.
- Read `reports/install.log` after it finishes. Report failures with the log
  excerpt; do not paper over them.
- Prefer current releases of third-party dependencies too; when the log
  shows deprecations or audit findings, mention them.

## 2. Strict serial execution (no concurrency)

**At most one install or test run across the whole ecosystem at any time.**

- Process repos in graph order, one after another:
  1. `fabric` (`@fabric/core`)
  2. `fabric-http`
  3. `fabric-discord`
  4. `hub.fabric.pub`
  5. `fabric-browser-extension`
  6. `star-citizen-live`
- Within one repo: `report:install` → wait for it to exit → tests
  (`npm run ci` where defined, else `npm test`) → wait → next repo.
- Never run two of these in parallel: not in background shells, not in
  subagents, not in separate sessions, not chained with `&`. Downstream
  installs fetch upstream Git refs, and tests share ports (Hub 8080, P2P
  7777, regtest RPC 20444, ZMQ 29500) and `stores/` directories.
- Before starting, check nothing is already running
  (`pgrep -fl 'npm (i|install|test|run)|mocha'`). If something is, wait or
  ask; do not kill another session's process.
- If an upstream step fails, **stop**. Do not continue down the graph on a
  broken upstream; fix it (or report it) first.
- Upstream change pushed? Downstream repos need a fresh `report:install` to
  see it, again top down.

## 3. Change discipline

- Make the change in the lowest package that owns the concern (see the
  layering in [API_CONSOLIDATION.md](API_CONSOLIDATION.md)).
- Keep each repo's release gate green (`npm run ci` or `npm test`).
- Follow the repo's own AGENTS.md / CLAUDE.md for style and scope. Repo
  owners' commit policy wins (for example: stage only, never commit).
