# Objective: consolidate into common APIs

Shared across every Fabric repository.

The long-term goal is fewer, shared APIs that every app reuses, with a hard
line between **Fabric Core messaging** and **HTTP (legacy web) support**.

## Layers

| Layer | Package | Owns | Must not contain |
|-------|---------|------|------------------|
| Messaging | `@fabric/core` | `Message` wire format, types, keys/identity, Peer (TCP P2P), contracts, chain, storage primitives, pure `functions/` | HTTP, Express, WebSocket servers, browser DOM, fetch-based clients |
| Web transport | `@fabric/http` | HTTPServer, WebSocket bridge, JSON-RPC over HTTP, Passport HTTP/peer transport, browser helpers | Protocol logic that belongs in core (define it in core, adapt it here) |
| Reference app | `@fabric/hub` | Composition of core + http into a running node and UI; the flagship downstream apps inherit from | Reimplementations of core or http behaviour |
| Apps | discord, passport, star-citizen, … | Product features | Private forks of shared helpers |

## Working rules

- **Core first, transport second.** Define a message type, schema, signing
  string or state transition in `@fabric/core`. HTTP routes, WebSocket
  handlers and REST shapes in `@fabric/http` / Hub only *map* to it.
- **One implementation.** When the same helper exists in two repos, move it
  to the lowest layer that may own it and make the others `require` it.
  Leave a thin re-export during migration, then remove it.
- **HTTP is an adapter.** Anything reachable over HTTP must also be
  reachable as a Fabric message / RPC without HTTP. New features should not
  be HTTP-only.
- **Apps call the Hub's reference integrations** (for example
  `@fabric/hub/functions/hubPassport`) instead of mounting their own copy.
- When you touch duplicated code, note the consolidation opportunity (in the
  change summary or the repo's roadmap doc) even if you don't do it now.
