# DESIGN — Mission lifecycle dashboard (from the log)

**Status:** ✅ **Built** (branch `feature/death-and-mission-lifecycle`, owner
go-ahead given 2026-06-17). Parser rules, service/REST wiring, dashboard panel, and
tests are all in. This doc is kept as the design record.

**Question asked:** can we show a dashboard of missions **accepted / completed /
abandoned / failed** etc., from the `Game.log`?

**Short answer:** Yes — the current game (4.8.0) logs a clean, per-mission
lifecycle. I verified the exact signals against real logs (Kersa 4.8.0 + a
525-file corpus). Below is what the log gives, what the dashboard would show, and
the honest limits.

---

## 1. The signals (all VERIFIED on real 4.7–4.8 logs)

| Lifecycle stage | Log line (tag) | Parser rule | Key fields |
|---|---|---|---|
| **Accepted / started** | `<CSCPlayerMissionLog::MissionStartCommsNotification>` | `mission:start` | `contractId`, `missionId` |
| **Ended (outcome)** | `<EndMission> … CompletionType[…] Reason[…]` | `mission:end` | `missionId`, `player`, `completionType`, `reason` |
| *(corroborating)* | `<MissionEnded> … mission_state MISSION_STATE_*` | *(not parsed yet)* | mission_id, state |
| Type / name | `<CLocalMissionPhaseMarker::CreateMarker>` → generator | `mission:marker` *(existing)* | `missionId`, `generator` → `missionType()` |
| Objectives | `<CMissionLogEntry::UpdateActiveObjective>` | `mission:objective` *(existing)* | text, objectiveId |

**`CompletionType` is the headline signal.** Full vocabulary, counted across the
525-file corpus:

| CompletionType | Corpus count | Dashboard bucket |
|---|---|---|
| `Complete` | 1043 | ✅ Completed |
| `Abandon` | 292 | ⤺ Abandoned (Reason usually "Player left") |
| `Fail` | 98 | ✖ Failed |
| `Deactivate` | 20 | ⊘ Deactivated (mission pulled/expired) |

(`<MissionEnded>` adds `MISSION_STATE_WITHDRAWN`/`EXPIRED`/`ENDED` as finer reasons
if we ever want them — not needed for v1.)

---

## 2. Proposed dashboard

**A. Counters (this session + cumulative):**
`Accepted · Completed · Abandoned · Failed · Active (accepted, not yet ended)`.

**B. Per-mission table:** Type (from generator) · Started · Ended · Outcome ·
Duration (ended − started). Joined on `missionId`: `mission:start` opens the row,
`mission:end` closes it with the outcome.

**C. Breakdown by mission type:** completed/failed counts per category
(Bounty, Mercenary/Defense, Hauling, Recovery, Mining, FPS/Facility…), reusing the
existing `missionType()` classifier.

**D. (bonus) Deaths during a mission** — the new `player:death` signal, so the
session view can show "died 3× this op."

---

## 3. Wiring plan (the work, if approved)

Purely additive, same zero-dependency style:

1. **`app/server.js`** — extend `_indexMission()`: on `mission:start` set
   `missionGroups[missionId].startedAt` + `contractId`; on `mission:end` set
   `endedAt`, `outcome`, `reason`. Add small rolling counters. Route `player:death`
   into a `deaths` collection mirroring `incaps` (attributed to `_sessionHandle`).
2. **REST** — add outcome fields to the existing `…/missiongroups` payload; add
   `…/deaths`; surface the counters in `…/monitor`.
3. **`app/ui.html`** — one "Missions" panel (counters + recent table) and a death
   counter alongside the existing 💀/down counters.
4. **Tests** — extend `test/service.test.js` + `test/api.test.js` for the lifecycle
   join and the death routing. (Parser side is already covered.)

Estimated: a focused, reversible change to 3 files + tests.

---

## 4. Honest limits (read before believing the numbers)

- **Local player only.** This is *your* mission history from *your* log — not the
  whole org's. Org-wide stats need every member running the relay (the federation/
  central-service path), or the officer register.
- **Self-reported.** Same caveat as everything log-derived (D-005): it reflects what
  your client logged, not an authoritative server truth. The **officer-validated
  register stays the source of truth**; this dashboard is *personal stats /
  supporting evidence*, not proof of completion for pay/credit.
- **In-game missions only.** Out-of-game fleet actions have no log signal — those
  live entirely in the mission register.
- **"Accepted" nuance.** `MissionStartCommsNotification` fires when a mission starts
  for you; for party-shared missions the start/accept attribution can be fuzzy. The
  `<EndMission>` line, by contrast, names `Player[<you>]` explicitly and is solid.
- **Content drift.** CIG adds/renames generators each patch; `missionType()` is an
  editable map (same maintenance as the NPC list), and unknowns fall back to
  "Other" — never a crash.

---

## 5. Status — all built ✅

- **Parser:** rules `mission:start`, `mission:end`, `player:death`.
- **Service/REST:** `deaths` collection + `GET …/deaths`; `missionStats()`;
  lifecycle fields (`startedAt`/`endedAt`/`outcome`/`reason`/`status`/`contractId`)
  on `…/missiongroups`; `deaths` + `missionStats` in `…/monitor`.
- **Dashboard:** a `deaths` counter, a mission-outcome summary line
  (accepted/✅/⤺/✖/active), and per-mission status badges.
- **Tests:** parser (5) + service replay of a real-format fixture + API monitor/
  deaths checks. Suite green (**53 tests**).

Next possible step (not built): Discord announce for deaths/mission outcomes, and
rolling these per-session/per-op once multiple relays report in.
