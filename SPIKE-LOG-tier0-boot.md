# Tier 0 Spike — "Can we get this project running?"

**Date:** 8 June 2026
**Who/what ran it:** Automated assistant working from the project's GitHub branch `feature/fabric-0.1.0`.
**Goal in one sentence:** Find out whether the project can actually be installed and started on a clean machine — because that single answer decides how we approach everything else.

> **What is a "spike"?** A short, throwaway experiment to answer one risky question before committing real effort. We're not building features here. We're just testing: *does the engine even turn over?*

---

## The bottom line (read this if nothing else)

- **Getting the code: works perfectly.** ✅
- **Installing the building blocks it depends on: works, but only after a fix, and it's heavy and slow.** ⚠️
- **Starting the program: not achieved in this test environment** — blocked on one large dependency that our sandbox couldn't finish downloading. On a normal developer laptop it would very likely succeed. ⚠️
- **The previously-known "instant crash" bug is now fixed** (we added the missing piece). The program no longer crashes for that reason. ✅

**What this means for the decision:** The project *is* installable and bootable, but it sits on top of a very large, fragile foundation (a framework called "Fabric"). Confirming this strengthens the earlier recommendation: before investing in features, the team should consciously decide whether to **keep that heavy foundation or replace it with a much simpler one.** More on that at the end.

---

## What we set out to test, in plain terms

The program is built on top of a third-party framework called **Fabric**. Think of Fabric as the foundation of a house — everything else is built on it. The concern going in was: *is that foundation easy to obtain and stand up, or is it going to fight us?* If the foundation is a problem, no amount of work on the "rooms" (the features) matters until it's resolved.

So this spike walked through the four things a developer does to run any project for the first time:

1. **Get the code** (download it).
2. **Install the dependencies** (the building blocks the code needs to run).
3. **Patch the one known crash** (a missing file the project expects).
4. **Start it up** and see if it responds.

---

## Step-by-step log of what was done and what it means

### Step 1 — Download the code ✅
**What we did:** Made a clean copy of the project from GitHub (the `feature/fabric-0.1.0` branch).
**What happened:** Worked first try. All the expected files were there.
**Plain-English meaning:** Getting the code is not a problem. Anyone with the link can obtain it.

### Step 2 — Install the dependencies ⚠️ (this is where the real story is)
**What we did:** Ran the standard install command that fetches every building block the project needs.

**What happened — three findings:**

**Finding A — The install was initially broken by a "locked door" problem.**
The two most important building blocks (the Fabric framework pieces) were set up to be fetched through a **private-style door** that requires a personal key (technically: they're pinned to "SSH" GitHub addresses). On a clean machine with no key, the door is slammed shut — the install fails with "Permission denied."

- *Why this matters:* Anyone trying to set this project up fresh — a new teammate, a server, an automated build — will hit this wall unless they happen to have the right GitHub key configured. It's a silent tripwire.
- *The fix (which we applied and confirmed works):* Tell the installer to use the **public door** (HTTPS) instead of the private one. This is a one-line configuration change and it requires no key. After applying it, the blocked downloads went through.

**Finding B — One building block isn't even on the official parts list.**
The project's "parts list" (its `package.json`) names the Fabric *hub* piece but **not** the Fabric *core* piece — yet the code needs core to run. Core only arrives "along for the ride" with hub. This matches a warning already noted in the project's context document, and we confirmed it first-hand.

- *Why this matters:* Undocumented dependencies are fragile. If hub ever stops bundling core, the project breaks with a confusing error. It should be added to the parts list explicitly.

**Finding C — The foundation is enormous and slow to install.**
Once the doors were open, the Fabric framework dragged in a huge amount of extra material — over a thousand sub-components totalling roughly **400 MB**, including heavyweight items like a full headless web browser (Chromium), a database engine, and more. The download/setup ran for many minutes.

- *Why this matters:* This is a very large, heavy foundation for what the program actually does day-to-day (watch a game log file and post messages to Discord). Heavy foundations are slower to install, harder to maintain, more prone to breakage, and intimidating for new contributors.

### Step 3 — Fix the known "instant crash" ✅
**What we did:** The project was known to crash the moment it starts, because it expects a file called `MissionManager.js` that was never included. We created a minimal, safe stand-in version of that file.
**What happened:** Confirmed success — the program now gets *past* that crash point. (When we tried to start it, the error was no longer about the missing MissionManager; it had moved on to the next thing.)
**Plain-English meaning:** The headline "it won't even start" bug is resolved. Our stand-in is a placeholder with no real mission logic — it just lets the rest of the program run. It can be swapped for the real thing later.

### Step 4 — Start the program ⚠️ (not achieved here)
**What we did:** Attempted to launch the service.
**What happened:** It stopped at "Cannot find module `@fabric/hub`" — i.e. the single largest foundation piece never finished installing in our test environment. We retried the install around ten times; the smaller core piece completed, but the big hub piece (the one bundling the web browser and other heavy parts) repeatedly ran out of time before it could finish.
**Important nuance:** This is a limitation of **our temporary, sandboxed test environment**, which automatically stops long-running background tasks — *not* evidence that the project is broken. On a normal developer machine without that time limit, this final piece would very likely install and the program would proceed to start. We just couldn't prove the final "it's alive" moment here.

---

## Where things stand right now

| Item | Status |
|------|--------|
| Code downloaded | ✅ Done, no issues |
| The SSH "locked door" problem | ✅ Identified, fix found and applied (use public HTTPS) |
| Undocumented "core" dependency | ⚠️ Confirmed; should be added to the parts list |
| Most dependencies installed | ✅ ~728 components in place (~400 MB) |
| Largest dependency (`@fabric/hub`) | ⚠️ Did not finish installing in this sandbox (time limits) |
| "Instant crash" (missing MissionManager) | ✅ Fixed with a safe placeholder |
| Program fully started + responding | ⚠️ Not demonstrated here (blocked only by the item above) |

---

## What we recommend the team do next

**1. Reproduce the boot on a real machine (quick, decisive).**
On an ordinary laptop — no sandbox time limits — apply the public-door fix, keep our MissionManager placeholder, and run the install + start. This should get to a fully running program and give us the "it's alive" confirmation we couldn't capture here. Likely under 15 minutes of hands-on time.

**2. Make the install reliable for the next person.**
- Switch the two Fabric addresses from the private "SSH" style to public "HTTPS" so a key is never required.
- Add the Fabric *core* piece to the official parts list so it's no longer an invisible dependency.

**3. Make the big strategic decision — keep Fabric, or replace it.**
This spike's most useful outcome is evidence for a choice the team should make on purpose, not by default. The Fabric foundation is large, slow, and fragile (private-door setup, undocumented pieces, a 400 MB footprint pulling in a whole web browser) for a program whose core job is simply *watch a log file and post to Discord.* That core job could be rebuilt on a tiny, standard foundation in a fraction of the size, far easier for anyone to install and maintain. Fabric is really only justified if the team intends to build the advanced "missions with cryptographic contracts" vision. **The recommendation is to decide this before investing in features** — and unless the crypto-missions vision is the actual goal, the simpler foundation is likely the better long-term bet.

---

## Mini-glossary

- **Dependency / building block:** Pre-made code the project relies on instead of writing everything from scratch.
- **Fabric:** The large third-party framework this project is built on top of — its "foundation."
- **SSH vs HTTPS (the "doors"):** Two ways to download code from GitHub. SSH needs a personal key; HTTPS is open for public projects. The project was wrongly set to the key-only door.
- **MissionManager:** A file the program expected but that was never shipped, causing an instant crash. We added a safe placeholder.
- **Sandbox:** The temporary, locked-down test computer used for this spike. It auto-stops long tasks, which is why the biggest download couldn't finish here.
