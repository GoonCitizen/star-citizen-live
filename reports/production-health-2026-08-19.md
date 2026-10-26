# Production health note — 2026-08-19T23:31Z
Source: https://relay.goon.vc/downstream.agents.md

## Summary
- **Crashes:** none new. Hub PM2 **539** / FATAL **317** frozen. Same PID **~73 h**.
- **Health (critical):** Hub heap **~81 MiB → ~3.0 GiB @ 96%** / RSS **~8.6 GiB**. Memory-bounding stopped the minute-scale loop; slow multi-day climb is back.
- **RSI:** 0 FATAL, RSS **~9.3 GiB**, closed-stream / oversized-frame spam.
- **Sensemaker:** stable (~134 h).
- **Ops leftovers:** `~/.pm2/logs` ~41 GiB (no logrotate); Hub↔RSI hairpin still missing; `sensemaker.io:7778` still timing out.

## Agent action
Do **not** raise `--max-old-space-size`. Resume Hub retainer triage (`Filesystem.publish` / STATE / sidechain) + RSI write-after-close / AMP frame size. Living queues updated in Hub/core/GC `docs/OUTSTANDING.md`. Canvas: `gooncitizen-security-privacy-audit.canvas.tsx`.
