# Outstanding (security-first)
Living queue for this repo. Detail: [SECURITY.md](../SECURITY.md), [THREAT-MODEL.md](THREAT-MODEL.md). Suite march: [@fabric/core `docs/PRODUCTION_MARCH.md`](https://github.com/FabricLabs/fabric/blob/feature/rsi/docs/PRODUCTION_MARCH.md).

**Last reviewed:** 2026-08-14. Pins: core `488a87da1` ([#185](https://github.com/FabricLabs/fabric/pull/185)), http `5161e76`, hub `4c1cd14` ([#15](https://github.com/FabricLabs/hub.fabric.pub/pull/15)), discord `eac4633` ([#2](https://github.com/FabricLabs/fabric-discord/pull/2)).

## Blockers before LAN / hosted dashboard claims
1. ~~**`httpSharedMode` mutating APIs**~~ — non-loopback writes now need Schnorr/Bearer (`functions/httpRemoteAuth.js`), same bar as `SC_MODE=server`. Loopback still uses the unlocked identity **on desktop**. Public relays **must** use `SC_MODE=server` because Caddy → loopback would otherwise inherit that unlocked path (`docs/PRODUCTION.md`). Unauth **GET** of settings / guilds / peers on a shared bind remains an information leak.
2. **Chat confidentiality** — global chat and DirectChat are signed plaintext vs relays ([THREAT-MODEL.md](THREAT-MODEL.md)). GroupChat v2 participant seal is hub-blind; v1 tip-HKDF is not.
3. **Identity cluster** — a stolen device key **is** the actor until `IdentityCrossSignRevoke`. Union-find is `@fabric/hub/functions/identityCluster` via the local re-export.

## Next slices
- [ ] DirectChat E2E or `P2P_FORWARD` (pair ARC + participant seal).
- [ ] Drop GroupChat seal v1 once the mesh no longer emits it.
- [ ] Bearer revoke + shorter TTL for hosted sessions.
- [ ] Bind device-link `sessionId` into attest messages with http/Passport (suite redeem possession proof).
- [ ] Mesh chat flood / anonymous inbound rate limits.
- [ ] Shared-bind GET privacy (settings / Discord catalog / peers) without breaking the LAN dashboard.

## Closed / already in tree (do not regress)
- Loopback HTTP default; D-017 log share off; allowlisted Hub login/link; IdentityCrossSign gossip after device-link; Android local-first node. Dashboard keeps a browser-safe local IdentityCrossSign copy (do not webpack `@fabric/core`); `signCrossSign` binds `localPubkey` to `fabricKey.pubkey` and rejects unknown `kind` (same as [@fabric/core #185](https://github.com/FabricLabs/fabric/pull/185)).
- Stale Fabric `:7778` hub dials rewritten to `:7777` (DNS **and** dedicated NICs `65.21.231.166` / `65.21.231.149`); self IPs dropped; peer-dial `ECONNREFUSED` logs rate-limited. This core pin includes candidate cooldown / NOISE-after-connect / in-flight `_outboundDialTargets`. Local IdentityCrossSign copy matches core `_normPubkey` (no `:` field smash). APK `fabricPeerHostLocal` strips `pubkey@` userinfo the same way http will.
- Fabric pins refreshed to GitHub `feature/rsi` tips above; `identityCluster` re-exports Hub; `normalizeDiscordSettings` re-exports `@fabric/discord`. Discord `eac4633` fails the OAuth authorize stub closed (501); GoonCitizen does not mount `/services/discord/authorize`. Device-link fetch uses http `deviceLinkHeaders` (browser omits client-set Origin/Referer).
- Shared-mode LAN **writes** require a session (`shouldEnforceRemoteAuth`).

## PRs
No open GitHub PR for this `feature/rsi` cut (historical [PR #6](https://github.com/GoonCitizen/star-citizen-live/pull/6) is closed overlay/replay work; public API has no review comments). Do not merge to `main`.
