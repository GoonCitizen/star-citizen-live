# Idea Backlog

Parked ideas not yet scheduled. Each notes *what*, *why*, and an honest
*feasibility* read against what the `Game.log` actually provides (we know its
limits well — see `sc-log` findings in `PROGRESS.md` / memory). Promote to a
milestone in `PROGRESS.md` when picked up.

---

## B-001 — Op participation & loot-split metrics (time-on-site, time-on-mission, ship used)
**Added:** 2026-06-14

**What:** During an operation (e.g. the **Hathor** op), capture per-member:
- **time on mission / time in the op** (active minutes within the op window),
- **presence on-site / near a station** over time (where they were, when),
- **ship type(s) used**,
so the org can split loot fairly by contribution rather than by guesswork.

**Why:** large ops need a defensible basis for dividing rewards; "time on
mission + role/ship" is a fairer, less-arguable input than memory.

**Feasibility (from the log — per member running the relay):**
- ✅ **Time-on-op / time-on-mission** — straightforward. We already track sessions
  (login→logout) and mission timestamps; "active minutes in the op window" is the
  `active-player-minutes per operation` metric already noted in the brief. The op
  window comes from the **Discord Events hook** (event start/end).
- ✅ **Ship type(s) used** — derivable. Ship IDs (`MANUFACTURER_Ship_<id>`) appear in
  the log and `shipName()` already prettifies them (e.g. `DRAK_Corsair` → "Corsair").
  Need to pick the spawn/board lines that mark "the player flew ship X".
- ⚠️ **On-site / near-station presence over time** — *partial*. The log has location
  signals (zone names like `OOC_Stanton_2c_Yela`, jurisdiction notices "Entered
  Hurston Dynamics Jurisdiction", "Entered Monitored Space", quantum-travel/location
  lines). So coarse "where + when" is recoverable, but zones are codenames and
  "near station X" needs interpreting position/zone → would benefit from the
  name-enrichment idea (global.ini / DataForge; see `REFERENCES.md`).
- ➡️ **The loot split itself** is an org-policy calculation on top of these inputs
  (officers decide the formula); we provide the metrics, not the verdict.

**Prerequisites:** members run the relay; a central service to aggregate multiple
members (M4); the Discord-Events op window; optional location-name enrichment.

**Confidence / honesty:** this is **inferred telemetry** (engagement/presence),
clearly labelled as such — an *input* to an officer's loot decision, not a
validated truth. Non-relay members won't appear.

**Related:** Discord Events hook (§5 brief) · metrics table (§6) · mission grouping ·
name-enrichment (`REFERENCES.md`: unp4k / StarCitizen-GameData).

---

## How to add an idea
Copy the block below, increment the id, fill it in. Keep the feasibility read honest.

```
## B-00X — <short title>
**Added:** YYYY-MM-DD
**What:** …
**Why:** …
**Feasibility (from the log):** ✅/⚠️/❌ per sub-part, with the reason.
**Prerequisites:** …
**Confidence / honesty:** validated vs inferred; who/what it depends on.
**Related:** …
```
