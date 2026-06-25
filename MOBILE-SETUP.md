# Mobile Setup — working on this project from a second computer (e.g. MacBook)

This project syncs between computers through **GitHub**. One machine *pushes*
(uploads) changes; the other *pulls* (downloads) them. As long as you do that,
all your machines stay in sync.

> **Golden rule:** _pull before you start, push before you walk away._

---

## One-time setup on a new machine

### 1. Install Node.js (the engine that runs the project + Claude Code)

- Easiest: download the **LTS** installer from <https://nodejs.org> and run it.
- macOS with Homebrew, alternatively: `brew install node`

Confirm it worked:

```bash
node --version && npm --version
```

### 2. Install Claude Code (the `claude` command-line assistant)

```bash
npm install -g @anthropic-ai/claude-code
```

### 3. Clone this repo and install dependencies

```bash
git clone -b feature/fabric-free-m1 https://github.com/Neorion/star-citizen-live.git
cd star-citizen-live
npm install
```

### 4. Launch Claude inside the project

```bash
claude
```

The first run walks you through signing in with your Anthropic account, right
in the terminal. After that, Claude has full access to the project.

---

## Everyday rhythm (on whichever machine you use)

```bash
git pull        # FIRST — grab the latest before you start
# ...do your work / chat with Claude...
git add .
git commit -m "what I changed"
git push        # LAST — send it up before you walk away
```

---

## Picking up a session (parity across devices & tools)

Whichever machine or AI tool you use, get to the same state the same way:

1. `git pull` — grab the latest.
2. Read, in order, to get current: **`AGENTS.md`** (the rules + project context;
   Codex reads this automatically), **`PROGRESS.md`** (top entries = where we are),
   **`REVIEW.md`** (any open review / cross-agent exchange), **`BACKLOG.md`**
   (parked ideas). `DECISIONS.md` (D-001…D-006) holds the *why*.

Because all durable state lives in these committed files (plus Claude's memory),
a fresh session — on any device — resumes with no loss. Nothing important lives
only in a chat window.

## Starting an OpenAI Codex review

1. Open the repo in **Codex** (point it at this project / branch).
2. Codex reads **`AGENTS.md`** automatically — §10 sets the rules: *the owner
   decides all development; agents propose, never merge to `main`, never build
   unprompted.*
3. The review scope and the collaboration log live in **`REVIEW.md`**. Codex
   writes findings under *Codex findings* (and/or as PR comments) on a branch.
4. Pull that branch; Claude responds under *Claude responses*; **you** approve or
   decline each item under *Owner decisions* — the only section that authorises work.

---

## Honest notes for this project

- **Live game-log watching only works on the Windows gaming PC**, because Star
  Citizen and its `Game.log` only exist there. On a MacBook you can still do all
  the coding, run `npm test` (the test suite needs no game), and replay a saved
  log with `npm run replay /path/to/Game.log`.
- **What syncs vs. what doesn't:** code and docs sync through GitHub.
  `node_modules/`, your `Game.log`, and secrets are deliberately *not* uploaded —
  you run `npm install` on each machine, and keep secrets local.
- **Secrets footgun:** `settings/local.js` and `settings/auth.txt` are currently
  *tracked* by Git, so `.gitignore` does **not** protect them. They only contain
  placeholders today (safe). Before pasting a **real** Discord webhook into
  `settings/local.js`, stop tracking them first so it can't be pushed by accident:

  ```bash
  git rm --cached settings/local.js settings/auth.txt
  git commit -m "stop tracking local secret config"
  ```

  The files stay on your disk; Git just stops uploading them.

---

## Useful project commands (recap)

```bash
npm start                        # run the service -> http://localhost:3041/services/star-citizen
npm test                         # run the full test suite (node --test, no setup needed)
npm run replay /path/to/Game.log # replay a saved log and tally detected events
```
