# GoonCitizen / suite security & privacy re-audit
**Scope:** local RSI tips — GC `5e10da8`, core `2a074a71d`, http `f1ab49a`,
Hub `c12df87`, discord `590bfe1`. **Date:** 2026-08-17 (UTC). **Method:**
re-run `tests/relay/privacy-http-auth.test.js` (27/27), spot-check LiveRelay
gates, live adversary probes (`reports/adversary-*-probe.json`,
`adversary-chaos-*.json`), OUTSTANDING heads, `npm audit --omit=dev`.
Canvases: `gooncitizen-security-privacy-audit.canvas.tsx`,
`fabric-stack-privacy-eval.canvas.tsx`.

**No commit.** Living trackers: OUTSTANDING / PRIVACY_REMAINING.

## Verdict

Hosted/shared-LAN **HTTP leak class from Aug-14 remains gated** (27/27).
Follow-up gates (fabric msg log, Game.log browse, fleets, Discord coord,
overlay, presence, locations detail/reports) still hold. Bearer **8h + revoke**.
Shoutbox stays intentionally public; sealed GroupChat is wave-1 confidential.

**Live production probe (relay.goon.vc, 2026-08-17):** writes / settings /
peers / presence / Discord guilds → **401**. **Public-by-design catalogs** still
world-readable: `/groups` (private filtered), `/missions`, `/ships`,
`/locations` map. Hub crash scan OOM still critical (~306 PM2 restarts).

**Still open:** http #69 possession-proof redeem; H6 ops bind discipline;
DirectChat/`P2P_FORWARD`/seal default/flood limits; Discord OAuth 501; Hub heap
OOM deploy; `npm audit` 7 highs; Passport storage/host perms.

## Re-verification

| Check | Result |
|-------|--------|
| `privacy-http-auth.test.js` | **27/27 pass** |
| Bearer TTL / revoke | 8h; `DELETE …/auth` |
| `shareDiscordCatalog` | default **off** |
| `groupChatSeal` | default **off** (UI recommends) |
| `fabricChatKind` | present; re-exported via `fabricChatText` |
| `docs/MESH_CHAT.md` + unit tests | **restored again** (were missing on tip) |
| Live public probe | settings/peers/presence/guilds **401**; groups/missions readable |
| Chaos public probe | same pattern; Hub peering/epoch reachable |
| `npm audit --omit=dev` | 18 vulns (7 high, 7 moderate, 4 low) |

## Closed / locked (do not regress)

Same Aug-14 H1–H7 / M1–M6 HTTP class, plus: fabric message-log, Game.log browse,
fleets, Discord coordination, overlay/missiongroups, presence, locations
detail/reports gated; `/ships` + `/locations` map stay public catalog;
private groups filtered on unauth list; bitcoin runtime omits adminToken;
Bearer revoke; mesh shoutbox product lock + seal recommendation UX.

## Still open

| Sev | Where | Item |
|-----|-------|------|
| High | `@fabric/http` #69 | Possession proof on login/device-link redeem; bind `sessionId` into attests |
| High | Ops / GC | H6: public HTTP must stay loopback-behind-Caddy + `SC_MODE=server` |
| High | Identity | Stolen device key is the actor until `IdentityCrossSignRevoke` |
| High | Hub ops | Heap OOM critical (~306 restarts / ~2.9 GiB); needs Hub+core deploy |
| Medium | Mesh | DirectChat E2E / `P2P_FORWARD`; seal default flip; flood rate limits; drop seal v1 |
| Medium | Live catalog | Unauth `/groups` + `/missions` on public relay (public register; private groups filtered) |
| Medium | Discord | OAuth code exchange still **501** |
| Medium | Hub | Admin token in `localStorage`; message-log / access.log retention |
| Medium | Supply chain | undici via discord.js; uuid via jayson |
| Low | Docs hygiene | `MESH_CHAT.md` / `fabricChatKind` tests keep vanishing from tip — pin or commit |
| Low | Passport | Master key in `chrome.storage.local`; broad `https://*/*` |

## Priority

1. http #69 possession-proof redeem  
2. Hub+core OOM deploy (do not raise `--max-old-space-size`)  
3. Mesh confidentiality product (owner go-ahead)  
4. Commit/pin MESH_CHAT + fabricChatKind tests so they stop regressing  
5. Discord OAuth exchange before public authorize  

## References

- Prior: `reports/security-privacy-audit-2026-08-16.md`, `…-08-14.md`
- Probes: `reports/adversary-public-probe.json`, `adversary-chaos-public.json`
- `docs/PRIVACY_REMAINING.md`, `docs/THREAT-MODEL.md`, suite OUTSTANDING
- Tests: `tests/relay/privacy-http-auth.test.js`
