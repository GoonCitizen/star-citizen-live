# Fabric ecosystem dependency graph

Shared across every Fabric repository (identical copy in each `docs/agents/`).
If you change it, change it in all of them.

| Order | Package | Repo (local checkout) | Depends on (Fabric) |
|------:|---------|-----------------------|---------------------|
| 1 | `@fabric/core` | `fabric` (`~/fabric-clean`) | — |
| 2 | `@fabric/http` | `fabric-http` (`~/fabric-http`) | core |
| 3 | `@fabric/discord` | `fabric-discord` (`~/fabric-discord`) | core |
| 4 | `@fabric/hub` | `hub.fabric.pub` (`~/hub.fabric.pub`) | core, http |
| 5 | `@fabric/passport` | `fabric-browser-extension` (`~/fabric-browser-extension`) | core, http |
| 6 | `@rsi/star-citizen` | `star-citizen-live` (`~/star-citizen-live`) | core, http, discord, hub |

```text
@fabric/core
├── @fabric/http
│   ├── @fabric/hub ───────────┐
│   └── @fabric/passport       │
├── @fabric/discord ───────────┤
└──────────────────────────────┴── @rsi/star-citizen (core, http, discord, hub)
```

## Rules that follow from the graph

- **Top down.** A change flows core → http → discord → hub → passport →
  star-citizen. Never fix a downstream symptom by patching a copy of an
  upstream module; fix it upstream, then move down.
- **No upward edges.** `@fabric/core` never requires `@fabric/http` (or any
  other Fabric package). `@fabric/http` never requires `@fabric/hub`. A new
  edge that points up the table is a design error.
- **Pins are Git refs** (`FabricLabs/<repo>#<branch>`). Keep the ref for a
  given package the same in every downstream `package.json`. Check with:

  ```bash
  grep -h '"@fabric/' ~/{fabric-http,fabric-discord,hub.fabric.pub,fabric-browser-extension,star-citizen-live}/package.json | sort | uniq -c
  ```

  Known drift at time of writing (2026-11-05): `@fabric/discord` pins
  `@fabric/core#feature/passport` while every other repo pins
  `#feature/schemas`. Align it before relying on cross-repo behaviour.
- **Local development** links checkouts instead of Git pins
  (`npm run link:fabric` in hub; `FABRIC_CORE` / `FABRIC_HTTP` override
  paths). After `npm run report:install`, links are gone; re-link if needed.
