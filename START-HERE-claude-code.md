# Start Here: Running this project in Claude Code

A beginner-friendly handoff. No prior coding needed — you'll talk to Claude Code
in plain English, just like in Cowork. The difference: Claude Code works directly
on **your own computer**, so it can install, run, test, and (later) deploy this
project for real.

Goal of your first session: **get the service running on your machine and open it
in your browser.** That's it — no coding, no deploy. ~15 minutes.

---

## Step 1 — Install three things (one-time)

You only do this once. Click each, run the installer with default options:

1. **Node.js (LTS)** — https://nodejs.org → download the "LTS" version.
   *This is what actually runs the project.*
2. **Git for Windows** — https://git-scm.com/downloads/win → default options.
   *Lets Claude Code download and version the code.*
3. **Claude Code** — easiest on Windows is the **desktop app** (graphical, no
   terminal): https://claude.com/download
   *Note: Claude Code needs a Claude **Pro or Max** plan — the free plan won't work.*

You don't need to understand these — they're just the toolbox Claude Code uses.

## Step 2 — Open Claude Code and point it at this project

- Open the Claude Code desktop app and sign in with your Claude account.
- When it asks which folder to work in, you can pick any empty folder (for example
  make a new folder called `Dev`). Claude Code will download the project into it
  in the next step — you don't need the files there first.

## Step 3 — Paste this exact first message

Copy everything in the box and send it as your first message to Claude Code:

```
I'm a non-developer learning the ropes. This project is my GitHub fork:
https://github.com/Neorion/star-citizen-live  (branch: feature/fabric-free-m1)

Please walk me through it one step at a time, explaining each step in plain
English BEFORE you run it:

1. Clone the feature/fabric-free-m1 branch into this folder.
2. Read CONTINUE.md, PROGRESS.md and DECISIONS.md so you understand the project.
3. Run: npm install
4. Run: npm test   (the suite should pass — currently 45 tests)
5. Run: npm start   to start the service.
6. Tell me the exact web address to open in my browser, and explain what I'm
   looking at when I open it.

Keep it beginner-friendly and pause if anything needs my decision.
```

## Step 4 — What you'll see (and what to do)

- Claude Code will **ask permission** before running commands. Read what it says,
  then approve — that's normal and how it keeps you in control.
- It will download the project, run the tests (expect the full suite to **pass** —
  currently 45), and start the service. (No install step is needed — the service
  has zero dependencies.)
- It'll give you a link like **http://localhost:3041/services/star-citizen**.
  Open that in your browser.

## Step 5 — How you know it worked

Your browser shows a small block of text (JSON) with `"status": "STARTED"` and
some counts. **That's the service running live on your computer** — the moment we
couldn't fully reach inside Cowork. 🎉

To stop it later, just tell Claude Code "stop the service" (or close its window).

---

## If something goes wrong

You don't need to debug it yourself — tell Claude Code what you see. Helpful things
to say:
- "That gave an error — here's what it said: …" (paste the message)
- "Run `claude doctor` and tell me if anything's wrong with the setup."
- "`npm` isn't recognized" → it usually means Node.js isn't installed or the
  terminal needs reopening; ask Claude Code to help.

## What to do after it's running

- **Explore:** ask Claude Code to "show me what each file does" or "replay the
  sample log and explain the output."
- **Headline feature (when you have it):** next time you're in Star Citizen
  combat, save your `Game.log` and tell Claude Code "here's a combat log — confirm
  the kill parser works against it." (See PROGRESS.md → M3-combat.)
- **Come back to Cowork** for planning the contracts feature (M5) or the VPS
  deploy (M4) — design it here, build it there. That back-and-forth is the workflow.

> Reference: the project's own `CONTINUE.md` has the plain command list, and
> `DECISIONS.md` explains *why* the project is built the way it is.
