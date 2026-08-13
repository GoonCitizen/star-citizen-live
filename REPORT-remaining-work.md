# Remaining work — Groups / journal / Taproot consolidation

**Date:** 2026-08-06  
**Context:** After Core catalog, `ContractStateTip`, invite JSON in `@fabric/http`, and **readers + Taproot failover ladder**.

## Done this pass

| Layer | Change |
|-------|--------|
| `@fabric/core` | `contractTaproot` (failover `after`/`until`, migrate), `contractTierWhen`, `contractCapability`, Token `ctx`, Contract/Federation `toAddress` / `toTaprootContract`, catalog Withdrawal/Capability types |
| `@fabric/http` | Invite `role` + `capabilityToken` |
| Hub | `federationVault` → Core re-export; docs |
| GoonCitizen | `members` vs `validators`, reader invites, Taproot wallet, publisher withdrawals API, thin Wallet/GroupPage UI |

---

## P0 — correctness / mesh (prior journal track)

1. Journal catch-up on peer reconnect with real `fromClock`
2. Attach inbound AMP `messageHex` to journal rows
3. Tip threshold enforcement on merge + multi-member tip sig collection
4. Star-topology journal catch-up test

## P1 — roles / Taproot follow-ups

5. Promote reader → signer via `ContractCapabilityGrant` + GroupChange (UI + API)
6. Richer `when` ops for tier activation; surface decay/migrate in Groups UI (not only Wallet)
7. CTV/APO covenant binding of migration outputs (v1 checks child address in preparer only)
8. Hub Beacon UI: deposit to ladder address + optional tier0 `until` config
9. Browser Groups identity / session (non-Electron)
10. Align Hub `InvitePeerToFederationContract` with `role` / group fields

## P2 — cleanup

11. Soft catalog string fallbacks once published core is everywhere
12. Unused `relayAppMessages`
13. Minsc `tr()` export optional / illustrative only
14. Protocol docs: tip kind `ContractStateTip` vs legacy colon string

## Suggested order

Journal P0 → reader promote (P1.5) → Beacon deposit UI (P1.8) → covenant migrate (P1.7).
