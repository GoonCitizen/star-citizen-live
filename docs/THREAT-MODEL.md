# GoonCitizen threat model (release)
Short security/privacy model for operators and players. See also `DECISIONS.md`
(D-010 peering, D-017 opt-in logs).

## What we claim
- **Peering** uses Fabric Peer (TCP/NOISE) with dedicated message types for
  chat, missions, groups, and opt-in activity share.
- **Local dashboard HTTP** defaults to **loopback** (`127.0.0.1`). LAN bind is
  an explicit Settings / env opt-in (`httpSharedMode` / `FABRIC_HUB_INTERFACE`).
- **Site login / device-link** use client-signed Schnorr over Hub HTTPS
  rendezvous; desktop only completes against an **allowlisted** hub origin
  (defaults + `FABRIC_HUB_ALLOWLIST`).
- **Gameplay log share** is **off by default** (D-017); Discord webhook is
  **env-only** (never Store).

## What we do *not* claim
- **End-to-end confidentiality of conversational traffic.** Global chat
  (`P2P_CHAT_MESSAGE`), DirectChat, and mission offers are **signed plaintext**.
  Any relay hop (including `hub.fabric.pub` / `relay.goon.vc`) that forwards
  frames can read those bodies. Membership filters hide UI for non-members;
  they do **not** encrypt for hubs.
- **Perfect secrecy for sealed GroupChat.** When `groupChatSeal` is on, outbound
  GroupChat uses **participant-key seal (v2)**: a random AES-256-GCM content key
  wrapped to each member via ephemeral ECDH. Relays and tip-journaling hubs
  **cannot** derive the content key from tip+roster alone — only holders of a
  wrapped member private key can open. Legacy **v1 tip-HKDF** seals remain
  readable on ingest for mesh peers that have not upgraded; v1 is **not**
  hub-blind (anyone with the same tip+roster derives the cipher key).
- **Discord privacy.** Optional Discord mirroring is a public/third-party
  exfil path — treat it as non-private.
- **Hosted register without officers.** In `SC_MODE=server`, an empty officer
  allowlist refuses officer mutations (`requireOfficers`).

## Trust boundaries
| Boundary | Trust |
|----------|--------|
| Local Electron / loopback HTTP | Operator machine |
| Fabric Peer mesh | Authenticated peers; **not** confidential vs relays for plaintext types |
| Network hubs | Selective relay + optional ingest; plaintext app traffic unless sealed |
| Group statechain tip holders | Can open **v1** tip-HKDF seals; **cannot** open **v2** participant seals |
| Hub HTTPS login/link | Rendezvous only; allowlisted origins |
| Discord webhook | External; env-configured |

## Operator checklist
1. Keep HTTP on loopback unless you intentionally share the LAN dashboard.
2. Set `SC_OFFICERS` for any public / server-mode register.
3. Leave `shareLogsGlobal` off unless you mean to publish gameplay events.
4. Prefer not to set `DISCORD_WEBHOOK_URL` if privacy matters.
5. Extend `FABRIC_HUB_ALLOWLIST` only for hubs you control.
6. Optional: enable `groupChatSeal` so outbound GroupChat uses hub-blind v2 wraps;
   use `requireSealedGroupChat` only when all members can open seals (unlocked
   identity for v2; shared tip for legacy v1 peers).

## Follow-ups (not this release)
- Hub opaque queue + MessageReceived / MessageReceipt UI
- E2E or `P2P_FORWARD` for DirectChat (pair ARC + participant seal)
- Drop v1 tip-HKDF once the mesh no longer emits it
- Historical tip roster replay for seals after membership changes
- Bearer revoke + shorter TTL for hosted sessions
- Coordinated `@fabric/*` SHA bumps with Hub / http / discord (see [SECURITY.md](../SECURITY.md); current pins: core `2e2aec81…`, http `365f0b49…`, hub `e9e8630…`, discord `8b269fb…`)
- PR #6 split / second-pass review once tooling comments land
- Keep desktop capture on literal `'png'` for `screenshot-desktop` (now `≥1.15.2`); watch discord.js / undici upstream for remaining audit highs
