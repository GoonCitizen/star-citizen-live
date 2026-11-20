# GoonCitizen / suite security & privacy re-audit
**Scope:** local trees on `feature/rsi` (GoonCitizen `~/star-citizen-live` + suite
pins). **Date:** 2026-08-16. **Method:** re-verify Aug-14 audit claims against
current code, `tests/relay/privacy-http-auth.test.js` (27/27 pass),
`docs/PRIVACY_REMAINING.md`, http/Hub/core OUTSTANDING, `npm audit --omit=dev`.
Canvases: `gooncitizen-security-privacy-audit.canvas.tsx`,
`fabric-stack-privacy-eval.canvas.tsx`.

**No commit.** Living trackers stay OUTSTANDING / PRIVACY_REMAINING — this file
is a snapshot.

## Verdict

Hosted/shared-LAN **HTTP GET leaks from the Aug-14 audit remain gated** and
locked by tests. Additional surfaces gated since then: Fabric message-log,
Game.log browse, personal fleets, Discord coordination, overlay/missiongroups,
presence roster. Bearer sessions are **8h + revocable**. Mesh product lock:
shoutbox is intentionally public; sealed GroupChat is wave-1 confidential.

**Still open (not HTTP GET leaks):** http #69 possession-proof redeem;
DirectChat / `P2P_FORWARD`; mesh flood limits; stolen device key until revoke;
Discord OAuth code exchange (501); Hub production heap OOM (ops);
`npm audit` 7 high (undici via discord.js, etc.).

## Re-verification (2026-08-16)

| Check | Result |
|-------|--------|
| `privacy-http-auth.test.js` | **27/27 pass** |
| Bearer TTL | `BEARER_TTL_MS = 8h`; `DELETE …/auth` revokes |
| `shareDiscordCatalog` default | **off** (test + constructor) |
| X-Forwarded-For as loopback | ignored (`isLoopbackRequest`) |
| Non-loopback HTTP bind | `console.warn` (`httpBindWarning`) |
| GroupChat seal | opt-in; UI recommends; confirm on disable |
| Shoutbox framing | Public shoutbox labels + THREAT-MODEL honesty |
| `fabricChatKind` | present in `@fabric/core` |
| `docs/MESH_CHAT.md` | restored 2026-08-16 (was missing while referenced) |
| `npm audit --omit=dev` | 18 vulns (7 high, 7 moderate, 4 low) — no critical |

## Closed since Aug-14 audit (do not regress)

### Original H1–H7 / M1–M6 HTTP class
- H1 notes, H2 local-tags, H3 Discord link, H4 file pin, H5 gameplay GETs,
  H7 snapshots — session-gated; no operator-pubkey fallback for missing session.
- M1 `/fs`, M2 document bytes, M3 catalog gossip default off, M4 settings/peers,
  M5 world-view hosted dump, M6 `/lookup` local tags omitted.

### Follow-up gates (still locked in privacy-http-auth)
- Gameplay collections, groupaudit, chat list/channels, identity cluster
- Overlay `/overlay/primary-group`, `/missiongroups`
- Presence roster/ship; Fabric message-log (GET/DELETE/clear/…)
- Game.log browse `/loginfo`, `/logslice`, `/reparse`
- Personal `/fleets*`; Discord `/discord/coordination`
- Unauth `GET /groups` does not dump private groups
- Bitcoin runtime omits `adminToken`
- Bearer revoke via `DELETE …/auth`

### Mesh / product honesty
- Shoutbox documented as intentional cleartext (not a “fix by encrypting flood”)
- Seal recommended in Settings; confirm before turning off
- Core classifier `fabricChatKind` + `MESH_CHAT.md`

## Still open

| Sev | Where | Item |
|-----|-------|------|
| High | `@fabric/http` #69 | Possession proof on login/device-link redeem (Origin ≠ capability); bind `sessionId` into attests |
| High | Ops / GC | H6: public HTTP must stay loopback-behind-Caddy + `SC_MODE=server` |
| High | Identity | Stolen device key **is** the actor until `IdentityCrossSignRevoke` |
| Medium | Mesh | DirectChat E2E / `P2P_FORWARD`; default `groupChatSeal` flip (owner); drop seal v1; flood rate limits |
| Medium | Discord | OAuth code exchange still **501** (CSRF state in tree) |
| Medium | Hub | Production heap OOM (crash scan ~306 PM2 restarts; not fixed by http Internal-log cut alone) |
| Medium | Hub | Admin token in `localStorage`; message-log / access.log retention |
| Medium | Supply chain | `npm audit` highs via discord.js→undici; uuid via jayson (no fix upstream yet) |
| Low | Passport | Master key in `chrome.storage.local`; broad `https://*/*` host perms |
| Low | Docs / ops | Footguns: shareLogsGlobal, advertise host, `sensitive≠encrypt`, open Hub WS |

## Controls that hold

- Desktop HTTP loopback; socket-based loopback check (not `X-Forwarded-For`)
- `SC_MODE=server` / shared bind: writes + gated GETs need session
- Electron: `nodeIntegration: false`, `contextIsolation: true`, `webSecurity: true`
- Discord secrets outside Fabric Store; DeviceDataShare strips seeds/tokens
- Hub self-sign loopback-gated in `@fabric/http`; HTTPS allowlist; `wss:` origin map
- Chat bodies as React text (no `dangerouslySetInnerHTML` in Chat)

## Priority (next)

1. http #69 possession-proof redeem (suite-coordinated) — **auth blocker**
2. Production Hub OOM + bind ops (H6)
3. Mesh confidentiality wave (seal default / DirectChat / flood limits) — owner go-ahead
4. Discord OAuth code exchange before public authorize
5. Supply-chain bumps when consumers can move (discord.js / undici)

## References

- `docs/PRIVACY_REMAINING.md`, `docs/THREAT-MODEL.md`, `docs/OUTSTANDING.md`, `SECURITY.md`
- Prior snapshot: `reports/security-privacy-audit-2026-08-14.md`
- Suite: `@fabric/http` / Hub / core `docs/OUTSTANDING.md`; core `docs/MESH_CHAT.md`
- Tests: `tests/relay/privacy-http-auth.test.js`
