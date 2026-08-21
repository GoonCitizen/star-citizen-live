# Agent probes

JSON dumps for downstream / follow-up agents. Local path: this directory.
Public (after deploy): https://relay.goon.vc/probes/

| File | Source |
|------|--------|
| `index.json` | Catalog of all probes |
| `discord-scheduled-events.json` | `npm run discord:events -- fetch` |
| `discord-events-schedule.json` | `npm run discord:events -- categorize` |
| `discord-events-resolved.json` | `npm run discord:events -- resolve …` |
| `goon-squad-schedule.json` | `npm run discord:events -- graphic` (paths to SVG/HTML) |
| `adversary-local-probe.json` | `node scripts/adversary-local-probe.js` |
| `adversary-public-probe.json` | `node scripts/adversary-local-probe.js --production` |

Publish to the live relay document root:

```bash
SC_AGENT_STATIC_ROOT=/var/www/goon.vc/html npm run probes:publish
```

Helpers: `functions/agentProbeExport.js`. Secrets are redacted on write.
