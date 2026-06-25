# Project Review & AI Collaboration Log

Shared, async channel between the **product owner (Neorion)**, **Claude Code**, and
**OpenAI Codex**. Read `AGENTS.md` §10 first — it defines the rules. **The owner
controls all development; agents propose only and never merge to `main`.**

How to use this file: an agent adds its findings/replies under the right heading,
commits on a branch, opens a PR. The next agent reads on pull and responds here.
The owner records the decision in **§ Owner decisions** — that is the only section
that authorises work.

---

## Branch ready for review (2026-06-19)

Branch **`feature/death-and-mission-lifecycle`** is ready for an independent pass,
proposed for merge into the fork trunk **`feature/fabric-free-m1`** (there is no
`main` on the remote). 5 commits, ~+900 lines, zero new runtime deps, 55 tests green.

Scope of the change set (all current-build, SC 4.8.0):
- **Parser** — `player:death` (corpse `body_01_noMagicPocket` marker), `mission:start`
  (`MissionStartCommsNotification`), `mission:end` (`EndMission` CompletionType).
- **Service/REST** — `deaths` collection, mission lifecycle on `…/missiongroups`,
  `…/analytics` (merged history+live), `missionStats`.
- **Dashboard** — Live/Analyze tabs; KPI strip, activity heatmap, outcome donut,
  type bars, pilot leaderboard, pilot comparison; month/year add-remove slicer.
- **Backfill** — `scripts/backfill.js` (`npm run backfill`) → compact gitignored
  `stores/history.json` (1,525 logs ingested; 3 pilots; 10 months).

Specific things worth a skeptical look: the death-marker dedupe (one event per
corpse burst), `_analyticsDataset()` payload size/caps, month-vs-UTC boundary in
the time slicer, and per-pilot attribution when a log has no login handle.

---

## Requested review (for OpenAI Codex)

Please perform an **independent project review** and write findings under
*§ Codex findings*. Scope:

1. **Architecture & code** — `app/` (server, parser, locate, store), `services/`,
   `types/`. Soundness, simplicity, bugs, dead code, test coverage gaps. The repo is
   intentionally zero-runtime-dependency Node built-ins — flag anything that breaks that.
2. **Log-parsing claims** — sanity-check the combat/mission findings against the code
   and `PROGRESS.md`. (Note the **ground truths** in `AGENTS.md` §10 — kills removed
   after 4.3.0, etc. — challenge them only with new evidence, don't re-assume.)
3. **Mission register (M5)** — `services/MissionManager.js`, the REST API in
   `app/server.js`, and `DESIGN-missions-mvp.md`. Lifecycle correctness, the
   officer-validation/audit model, security of the endpoints.
4. **Security & secrets** — handling of tokens/webhooks; the `settings/local.js` /
   `auth.txt` tracked-secret footgun; the Discord bot-token guidance.
5. **Roadmap realism & honesty** — are claims in the briefs labelled correctly
   (validated vs inferred)? Anything overstated for stakeholders?
6. **Packaging plan** — `app/locate.js` Windows-only TODO; the cross-platform
   (Windows `.exe` + Linux) plan in the briefs.

For each finding give: **file:line**, **severity** (blocker / important / nice),
**what & why**, and a **suggested** change — *as a proposal*, not an applied edit.

---

## Codex findings
_(Codex: add dated entries here. One finding per bullet, with file:line + severity.)_

> _none yet_

## Claude responses
_(Claude: respond to specific findings here, agree/disagree with reasons, cite files.)_

> _none yet_

## Owner decisions / approved actions
_(Neorion: the ONLY section that authorises work. Mark each item: approved / declined /
deferred, and which agent should action it.)_

> _none yet_
