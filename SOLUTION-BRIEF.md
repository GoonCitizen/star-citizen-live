# Solution Brief — Permafleet Mission Register & Live Relay

> **Audience:** product owner / org leadership (non-technical).
> **Purpose:** explain *what* we're building, what it does for members and officers,
> what it needs to run, and what's realistic vs. aspirational. Plain English.
> **Companion docs (technical):** `DESIGN-missions-mvp.md`, `DESIGN-distributed.md`,
> `DECISIONS.md`.

---

## 1. The one-paragraph version

We're building a **mission register for the org** — a place where officers post
missions and fleet actions (in-game *or* out-of-game), members apply and do the
work, and an **officer validates** that it was completed. Alongside it runs a
**live relay** that watches each player's Star Citizen game log and shares
activity (logins, missions, combat progress) to Discord and the register as
*supporting evidence*. **Discord is the front door** members already use; a small
always-on server in the cloud holds the shared record.

---

## 2. How it works, in pictures and plain words

There are **two halves** that work together but are deliberately kept separate:

**Half A — the Live Relay (already built).**
A tiny program runs on each player's PC and watches their Star Citizen log file.
When something happens (you log in, take a mission, progress a combat objective),
it reports it. Because the game log only exists on the player's own machine, this
piece *must* run locally — it can't be done from the cloud.

**Half B — the Mission Register (what we build next).**
A small always-on service in the cloud holds the org's missions, applications, and
validations. Officers and members interact with it through **Discord** (and a web
view). This is the high-value part, and it barely depends on the game log at all —
so we can build it now without waiting for log-reading to be "perfect."

```
   Each member's PC                     Cloud (one small server)         People
  ┌────────────────┐   activity        ┌───────────────────────┐
  │  Game.log  →   │ ───────────────►  │   Mission Register     │ ◄──► Discord
  │  Live Relay    │  (evidence)       │  + Live Feed + Audit   │      (members
  └────────────────┘                   └───────────────────────┘       & officers)
```

---

## 3. The big honest truth that shapes everything

**The game log cannot prove what happened.** We tested this thoroughly: the
current game build does **not** record kills or ship destruction at all, and even
where it records mission progress, a player's own log could in principle be wrong
or edited. **No amount of clever software fixes this** — it's how the game works.

So the design makes a **human the authority**: an **officer validates** each
completed mission. The game log is used as *helpful evidence where it exists*
(was the member online, did the mission's objective advance) — never as the sole
proof. This is exactly why **out-of-game missions and fleet actions fit perfectly**:
they have no log signal at all, so they rely entirely on the officer's sign-off,
the same way everything else does.

**Takeaway for you:** trust in this system comes from *your officers*, backed by a
tamper-evident record — not from trusting the game or the software.

---

## 4. What members can do (capabilities — Member)

- **Browse missions** the org has posted (bounty, cargo, exploration, fleet
  action, or custom), with reward (UEC), requirements, and deadline.
- **Apply** to a mission from Discord.
- **Get assigned** when an officer accepts them.
- **Mark a mission complete** and (optionally) attach evidence the relay captured
  (e.g. "I was in this session / this objective progressed").
- **See their own history** — what they've done and what was validated.

## 5. What officers/administrators can do (capabilities — Officer)

- **Post missions and fleet actions** — including out-of-game ones (e.g. "escort
  op Saturday 8pm", "recruitment drive") that the game can't see.
- **Review and accept/reject applications.**
- **Validate completions** — the core authority step: confirm an activity really
  happened and approve the reward. This is the "officer validation" you asked for.
- **Manage who is an officer** (who's allowed to validate) via a Discord role.
- **See a tamper-evident audit trail** — an append-only record of who created,
  applied to, and approved every mission, so nothing can be quietly changed.

## 6. What it does today vs. what's planned

| Capability | Status |
|---|---|
| Live relay reads the game log (sessions, missions, objectives) | ✅ Built & tested |
| Shares activity to Discord (live feed) | ✅ Built (optional) |
| Auto-detects game install & channel (LIVE/PTU/HOTFIX…) | ✅ Built |
| Groups missions with objectives; "combat progress" proxy | ✅ Built |
| **Mission register: post / apply / validate** | 🔜 **Next (M5)** |
| Always-on cloud hosting | 🔜 Next (M4) |
| Officer roles + signed/tamper-evident audit | 🔜 After M5 (M6) |
| Detecting individual kills | ❌ Not possible (game doesn't log them) |
| Fully decentralized / no-central-server | 🔬 Optional research, later (not needed) |

---

## 7. What it needs to run (external dependencies you should know about)

These are the things outside our own code that the solution relies on. A few cost
money or need an account/decision from you:

| Dependency | What it's for | Who provides it | Rough cost / effort |
|---|---|---|---|
| **A small cloud server (VPS)** | Hosts the always-on Mission Register so the whole org shares one record | A hosting provider (e.g. Hetzner, DigitalOcean, Linode) | ~**$5–10/month**; we pick & set up |
| **A Discord bot** | Lets members/officers use the register *inside* Discord (post, apply, validate); also posts the live feed. A *webhook* alone can only post out — a **bot** is needed for two-way commands. | Discord (free) — you create an app & invite the bot to your server | Free; ~30 min one-time setup with your admin rights |
| **Discord server + an "Officer" role** | Identity (who's who) and permissions (who can validate) | Your existing org Discord | Free; you decide who gets the role |
| **Each player runs the Live Relay** | Reads their local game log (the only place it exists) | The player's own PC | Free; a small download per player |
| **Players' internet connection** | Relays report activity to the cloud server | The players | Already have it |
| **(Optional later) a domain name** | A friendly web address for the dashboard | A registrar | ~$10–15/year; optional |

**Things we do *not* need** (deliberately, to keep it simple and cheap): no
blockchain, no cryptocurrency, no heavyweight peer-to-peer network, no paid
database service (we use a built-in lightweight one), no app-store apps.

**Your decisions as product owner will be:** which hosting provider/budget is OK;
approving creation of the Discord bot; deciding who holds the Officer role; and
whether the live feed posts to a public or private channel.

---

## 8. Privacy & trust notes (worth knowing)

- **Secrets** (the Discord bot token, the server keys) are kept private and never
  shared publicly — already enforced in how we handle configuration.
- **Members' game logs** stay on their own PCs; only the *summarized activity*
  (e.g. "took mission X", "objective progressed") is shared, not the raw file.
- **The audit trail** means even an officer can't silently rewrite history — every
  approval is recorded, and (in a later step) cryptographically signed.

---

## 9. Where we are and the suggested order

1. **M4 — Stand up the cloud server** (so the register has a home). *Your input:
   hosting choice/budget.*
2. **M5 — Build the Mission Register MVP** (post → apply → validate, in Discord +
   web). *Your input: create the Discord bot, define the Officer role.*
3. **M6 — Officer roles + tamper-evident (signed) audit trail.**
4. **Ongoing — keep improving what the live relay can recognize** (it gets better
   over time, but never blocks the register).
5. **Later/optional — decentralization** for resilience, *only if* the org ever
   wants to remove reliance on the single cloud server. Not needed for the product.

> **The headline:** we can deliver the mission register you described — officers
> posting missions and fleet actions, members applying, officers validating —
> **soon and on a shoestring**, because the valuable part doesn't depend on the
> hard/uncertain game-log reading. The log is a helpful bonus, not the foundation.
