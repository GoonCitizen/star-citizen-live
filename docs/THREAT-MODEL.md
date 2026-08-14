# GoonCitizen threat model (release)
Short security/privacy model for operators and players. See also `DECISIONS.md`
(D-010 peering, D-017 opt-in logs).

## Known Attackers
- Hostile Star Citizen organizations
  - includes Discord infiltrators (implies a need for robust intelligence gathering and analysis UI)
  - sophisticated technologically

## What we claim
- **Peering** uses Fabric Peer (TCP/NOISE) with dedicated message types for
  chat, missions, groups, and opt-in activity share.
- **Local dashboard HTTP** defaults to **loopback** (`127.0.0.1`). LAN bind is
  an explicit Settings / env opt-in (`httpSharedMode` / `FABRIC_HUB_INTERFACE`).
  Non-loopback **writes** on that bind require a Schnorr/Bearer session.
  Public relays (`SC_MODE=server`) require a session on **all** writes, including
  loopback — Caddy or Nginx to `127.0.0.1:3041` would otherwise look like the operator.
  Android is the same: the APK loads a **local node** first; remote hubs are not
  the UI origin.
- **Site login / device-link** use client-signed Schnorr over Hub HTTPS
  rendezvous; desktop and Android only complete against an **allowlisted** hub origin
  (defaults + `FABRIC_HUB_ALLOWLIST`). After device-link, **IdentityCrossSign**
  is gossiped **on Fabric** so other peers treat the keys as one actor; a stolen device key
  **is** the person until another cluster member publishes `IdentityCrossSignRevoke`.
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
| Local Android node / loopback HTTP | The device; same trust as desktop loopback |
| Fabric Peer mesh | Authenticated peers; **not** confidential vs relays for plaintext types |
| Network hubs | Selective relay + optional ingest; plaintext app traffic unless sealed |
| Group statechain tip holders | Can open **v1** tip-HKDF seals; **cannot** open **v2** participant seals |
| Hub HTTPS login/link | Rendezvous only; allowlisted origins |
| Identity cluster | Mutual BIP340; revoke is a network event |
| Discord webhook | External; env-configured |

## Operator checklist
1. Keep HTTP on loopback unless you intentionally share the LAN dashboard.
2. **If `httpSharedMode` is on:** non-loopback hosts must present a Schnorr/Bearer
   session for **writes** (chat, missions, settings, wallet send). Loopback
   (Electron / this machine’s browser) still uses the unlocked identity.
   Unauthenticated **GETs** on a shared bind can still list settings, peers, and
   Discord catalog — treat the LAN as able to *read* operator metadata.
3. Set `SC_OFFICERS` for any public / server-mode register.
4. Leave `shareLogsGlobal` off unless you mean to publish gameplay events.
5. Prefer not to set `DISCORD_WEBHOOK_URL` if privacy matters.
6. Extend `FABRIC_HUB_ALLOWLIST` only for hubs you control.
7. Revoke a lost device from desktop/Passport as soon as you notice — until then it can act as you in groups and chat.
8. Optional: enable `groupChatSeal` so outbound GroupChat uses hub-blind v2 wraps;
   use `requireSealedGroupChat` only when all members can open seals (unlocked
   identity for v2; shared tip for legacy v1 peers).

## Follow-ups (not this release)
- Shared-bind GET privacy (settings / Discord catalog / peers) without breaking the LAN dashboard
- Hub opaque queue + MessageReceived / MessageReceipt UI
- E2E or `P2P_FORWARD` for DirectChat (pair ARC + participant seal)
- Drop v1 tip-HKDF once the mesh no longer emits it
- Historical tip roster replay for seals after membership changes
- Bearer revoke + shorter TTL for hosted sessions
- Coordinated `@fabric/*` SHA bumps with Hub / http / discord (see [SECURITY.md](../SECURITY.md) and [OUTSTANDING.md](OUTSTANDING.md))
- Keep desktop capture on literal `'png'` for `screenshot-desktop` (now `≥1.15.2`); watch discord.js / undici upstream for remaining audit highs
- Mesh chat flood / anonymous inbound rate limits (adversarial local probe 2026-08-13)
