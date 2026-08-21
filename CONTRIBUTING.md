# Contributing
The call for developers (G00N SQUAD, PERMAFLEET, and other orgs) and the
contributor guide live in **[DEVELOPERS.md](DEVELOPERS.md)**. That file maps
each job to the rest of the tree (`AGENTS.md`, `docs/PRODUCTION.md`,
`ANDROID.md`, `SOLUTION-BRIEF.md`, …).

Short version:

- Branch from `feature/rsi`. Do not merge to `master`.
- `npm test` before a PR. Node.js **24.15.0**.
- Game.log is read-only. Parser `verified:true` only against a real line.
- Secrets via env / `settings/local.js` — never commit tokens or seeds.
- Other organizations are encouraged to fork, rebrand, and still speak Fabric.

What runs: [AGENTS.md](AGENTS.md) §3–§4. Public seed: [docs/PRODUCTION.md](docs/PRODUCTION.md).
Application basis (fork / second app): [docs/APPLICATION.md](docs/APPLICATION.md).
Intel desk / Groups as orgs / `settings/local.js`: [docs/INTELLIGENCE.md](docs/INTELLIGENCE.md).
