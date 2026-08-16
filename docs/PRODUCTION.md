# Public GoonCitizen relays
Operator runbook for a **public mesh seed** of this tree (`@rsi/star-citizen` /
LiveRelay). The reference host is **`relay.goon.vc`**. Preferred tools: **`nvm`**
and **`pm2`**.

This is not a product ship checklist. Owner names the release cut. Gate before
deploy: `npm test`. Other orgs hosting their own seed (or G00N / PERMAFLEET
members learning the operator path) start at [`DEVELOPERS.md`](../DEVELOPERS.md).
Threat model: [`THREAT-MODEL.md`](THREAT-MODEL.md), [`SECURITY.md`](../SECURITY.md).

## What this host is
A public GoonCitizen relay is **LiveRelay** (`scripts/node.js`) with:

| Plane | Bind | Why |
|-------|------|-----|
| **HTTP dashboard + REST + `/sessions`** | loopback (`127.0.0.1:3041`) behind Caddy or Nginx/TLS | D-011 site login lives on LiveRelay. The proxy terminates HTTPS. |
| **Fabric Peer** | public NIC **`:7777`** (TCP/NOISE) | D-010. `relay.goon.vc:7777` is a default mesh seed next to `hub.fabric.pub:7777`. |

`SC_MODE=server` is required on a public origin: mutating APIs always need a
Schnorr/Bearer session (even from loopback). That matters because Caddy or
Nginx → `127.0.0.1:3041` makes every client look like loopback. Without server
mode, the desktop “unlocked identity” write path would apply to the whole
internet. Do not trust `X-Forwarded-For` for that gate. LiveRelay
`console.warn`s when HTTP is bound off loopback (`functions/httpBindWarning.js`).

Fabric Peer is **on** in server mode unless `SC_FABRIC=0`. (Older docs said
“hosted API, no local Peer” — that was Hub-mounted LiveRelay. A public *seed*
must listen on `:7777`.)

### Two topologies (do not mix on one `:7777`)
1. **This tree (recommended for `relay.goon.vc` after this cut).** Caddy or
   Nginx `https://relay.goon.vc` → LiveRelay `127.0.0.1:3041`. Peer on
   `65.21.231.149:7777`. Site login is LiveRelay `POST /sessions`.
2. **Hub-mounted (historical).** Proxy → Fabric Hub HTTP `:8080`, which may
   embed `/services/star-citizen`. Hub owns `/sessions` *and* the Peer. Do not
   also bind LiveRelay’s Peer to the same `:7777`.

DNS: `relay.goon.vc` → **`65.21.231.149`**. Listen **only** on **`:7777`**.
Historical gossip still advertises `:7778` **and the dedicated NIC IPs**.
LiveRelay rewrites `hub.fabric.pub` / `65.21.231.166` to `:7777` and drops
this host’s own name and `65.21.231.149`. A growing `rsi-error.log` of
`ECONNREFUSED …:7778` is that stale-port storm (historical), not a crash loop.
Rotate the err log after this rewrite is deployed.

On this host the Fabric TCP port plan is:

| Port | Owners |
|-----:|--------|
| **7777** | Hub (`65.21.231.166`) + this relay (`65.21.231.149`) |
| **7778** | Sensemaker (`0.0.0.0` on the same box; `sensemaker.io:7778` is Cloudflare — Fabric TCP is not there) |
| **7779** | Reserved |

`FABRIC_PORT` wins over `settings/local.js` `fabric.port` and over a Store-saved `fabricPort`. `fabric.peers` in `settings/local.js` seeds the constructor roster (Hub-only on this host — omit self). Boot helper: `functions/fabricRelayBoot.js`.

Live pm2 on meta (2026-08-14, [downstream.agents.md](https://relay.goon.vc/downstream.agents.md)): Hub ~`.166:7777` HTTP loopback `:8080`; RSI ~`.149:7777` HTTP **bare** `.149:3041`; Sensemaker `:7778` / `:3040`. Nginx still fronts `https://relay.goon.vc`. Preferred RSI HTTP remains loopback behind that proxy — the bare NIC bind is what is running today. Applied one-off patches were removed from `/patches/` ([README](https://relay.goon.vc/patches/README.md)). Set `SC_OFFICERS` before treating the public register as locked down.

## Node: pin 24.15.0 with nvm
`.nvmrc` / `package.json` `engines` is **Node.js 24.15.0**. A default alias of
Node 12 (or anything else) will 502 or crash the process.

```bash
# one-time
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.3/install.sh | bash
# new shells: nvm is on PATH
cd /opt/star-citizen-live   # or wherever this clone lives
nvm install
nvm use
node -v   # must print v24.15.0
```

Pin the shell default so `pm2 resurrect` after reboot does not pick up Node 12:

```bash
nvm alias default 24.15.0
```

Install deps **without wiping the lockfile**:

```bash
npm i --allow-git=all
```

`.npmrc` sets `allow-git=all` (npm 12+ `allow-git=root` still fails nested git
deps). **Do not** run `npm run report:install` on the server — that script
truncates `package-lock.json` then reinstalls.

Keep `package.json` on `#feature/rsi`. The lockfile `resolved` SHAs are the
pins that actually install.

## Process: pm2

Templates: [`deploy/ecosystem.config.cjs`](../deploy/ecosystem.config.cjs),
[`deploy/env.relay.goon.vc.example`](../deploy/env.relay.goon.vc.example).

Copy secrets into a gitignored `.env` at the repo root (LiveRelay loads it at
boot) **or** export them in the pm2 process environment. Never commit
`FABRIC_XPRV`, Discord tokens, or `settings/local.js`.

```bash
nvm use 24.15.0
export NVM_DIR="$HOME/.nvm"
# interpreter MUST be the 24.15 binary — pm2 otherwise uses whatever `node`
# was on PATH when the daemon started (often the distro Node).
NODE_BIN="$(nvm which 24.15.0)"
cp deploy/env.relay.goon.vc.example .env
# edit .env: FABRIC_XPRV, SC_OFFICERS, Discord, …

pm2 start deploy/ecosystem.config.cjs --interpreter "$NODE_BIN"
pm2 save
pm2 startup   # once: systemd unit so resurrect survives reboot
```

Useful:

```bash
pm2 status
pm2 logs gooncitizen-relay --lines 200
pm2 restart gooncitizen-relay
pm2 describe gooncitizen-relay   # confirm interpreter / exec cwd
```

After `git pull` + `nvm use` + `npm i --allow-git=all` + `npm test`:

```bash
pm2 restart gooncitizen-relay --update-env
```

`--update-env` picks up `.env` / shell exports changed since the last start.

**Restart storms:** this process does not spawn bitcoind. If you also run Hub
on the same box, do not let pm2 restart Hub faster than an orphaned managed
`bitcoind` releases `stores/bitcoin-regtest`. GoonCitizen’s public relay
should leave `bitcoin.enable` off unless you know you need Hub wallet proxy.

## Environment (minimum)

| Variable | Production value on `relay.goon.vc` |
|----------|-------------------------------------|
| `NODE_ENV` | `production` |
| `SC_MODE` | `server` |
| `PORT` | `3041` |
| `FABRIC_HUB_INTERFACE` | `127.0.0.1` (Caddy / Nginx). Bare HTTP: `65.21.231.149`. |
| `FABRIC_PORT` | `7777` |
| `FABRIC_INTERFACE` | `65.21.231.149` (dedicated NIC) |
| `FABRIC_PUBLIC_HOST` | `relay.goon.vc` (advertise + **self-dial filter**) |
| `SC_FABRIC` | unset or `1`. `0` disables the Peer (not a seed). |
| `FABRIC_XPRV` | operator identity (preferred). Else `FABRIC_SEED` / `FABRIC_MNEMONIC`. |
| `SC_OFFICERS` | comma-separated pubkeys. **Required** — empty allowlist denies officer mutations. |
| `SC_ROSTER` | optional ingest allowlist |
| `SC_SETTINGS_DIR` | default `stores/gooncitizen` |
| `DISCORD_*` | optional bot; never commit |

First boot with an empty Store seeds `hub.fabric.pub:7777` and
`relay.goon.vc:7777`, then **drops self** when `FABRIC_PUBLIC_HOST` matches.
On this host the remaining dial target is **`hub.fabric.pub:7777`**. Do not add
`relay.goon.vc:7777` back to the roster.

`/settings` and `/peers` HTTP are **desktop/local** (`SC_MODE` unset). Public
server mode 404s those routes on purpose (Hub leftover). Configure peers via
the Store on first boot / env, not the public Settings UI.

## TLS reverse proxy (Caddy or Nginx)

Either terminator is fine. Pick **one**. Peer traffic is **not** HTTP — leave
`:7777/tcp` open on the public NIC (firewall + security group). Do not proxy
Fabric AMP through the HTTP front.

If `goon.vc` still fronts a Hub on `:8080`, keep that hostname on Hub. Only
point **`relay.goon.vc`** at LiveRelay `:3041` when this process is the public
GoonCitizen origin. Do not copy Hub nginx examples that `proxy_pass` `:8080`.

### Caddy

Example: [`deploy/Caddyfile.example`](../deploy/Caddyfile.example).

```
relay.goon.vc {
	reverse_proxy 127.0.0.1:3041
}
```

TLS is Let’s Encrypt via Caddy (`systemctl reload caddy` after merge).

### Nginx

Example: [`deploy/nginx-relay.example.conf`](../deploy/nginx-relay.example.conf).
Include from the `http {}` context (the file has a `map` + `upstream`).

```bash
sudo cp deploy/nginx-relay.example.conf /etc/nginx/sites-available/relay.goon.vc
sudo ln -sf /etc/nginx/sites-available/relay.goon.vc /etc/nginx/sites-enabled/
# First load: comment the ssl_certificate lines, or run certbot after a :80-only
# server. Then:
sudo certbot --nginx -d relay.goon.vc
sudo nginx -t && sudo systemctl reload nginx
```

Keep `proxy_set_header Host $host` and `X-Forwarded-Proto` so `POST /sessions`
sees `https://relay.goon.vc`. WebSocket `Upgrade` headers are in the example for
long-lived dashboard sockets; they do not carry Fabric Peer frames.

Optional static files (`/downstream.agents.md`, `/patches/`, `/probes/`) are
served from the nginx/Caddy document root **before** the LiveRelay proxy.
Without those locations, LiveRelay 404s the directory index.

Agent probe JSON (Discord schedule dumps, adversary probes, …) lands in
`reports/probes/` locally. On the public host:

```bash
# after enabling location ^~ /probes/ in nginx (or Caddy handle /probes*)
SC_AGENT_STATIC_ROOT=/var/www/goon.vc/html npm run probes:publish
# → https://relay.goon.vc/probes/index.json
```

Probe writers (`npm run discord:events -- fetch`, adversary probe) also honor
`SC_AGENT_STATIC_ROOT` at write time. Never put bot tokens or seeds in probes.

Idle timeouts in the example are 3600s so a hung proxy does not drop a slow
upload. Tighten if you do not need large `POST …/documents`.

## Identity, officers, backups

- Generate/print env locally: `eval "$(node scripts/fabric-env.js)"` then copy
  **`FABRIC_XPRV`** into the server `.env`. Back the xprv up offline.
- Without an unlocked identity the Peer stays down (HTTP still serves).
- Set `SC_OFFICERS` before opening the mission register to the public.
- Back up `stores/gooncitizen/` (LevelDB register + `history.json` +
  `log-cursors.json`). Stop pm2 or copy a consistent snapshot; do not rsync a
  live LevelDB and expect it to open.

## Verify after start

```bash
# HTTP (loopback — what Caddy / Nginx hits)
curl -sS -D- http://127.0.0.1:3041/services/star-citizen | head
curl -sS -X POST http://127.0.0.1:3041/sessions \
  -H 'Content-Type: application/json' -H 'Accept: application/json' \
  -H 'Origin: https://relay.goon.vc' \
  -d '{"origin":"https://relay.goon.vc"}'

# Public HTTPS
curl -sS https://relay.goon.vc/services/star-citizen
# Unauthenticated writes must fail (the proxy looks like loopback):
curl -sS -o /dev/null -w '%{http_code}\n' -X POST https://relay.goon.vc/services/star-citizen/chat/messages \
  -H 'Content-Type: application/json' -d '{"channel":"global","body":"probe"}'
# expect 401

# Fabric listen on the dedicated NIC
ss -lnt | grep 7777
# or: lsof -nP -iTCP:7777 -sTCP:LISTEN
```

pm2 logs should show `listening on http://127.0.0.1:3041` (bind `127.0.0.1`),
the register store path, and a Fabric Peer — not `SC_OFFICERS empty` as a
silent bootstrap.

Playnet contract (local machine = production publisher with the same
`FABRIC_XPRV` as Hub). Deploy logs posture (`operator` / `adversary` /
`ambiguous`); ambiguous public-host runs from this script still publish as
operator. Adversary probes stay on `scripts/adversary-local-probe.js` (no
`CONTRACT_PUBLISH` / Accept). `--accept` tries Hub-issued
`FABRIC_HUB_ADMIN_TOKEN` / `~/.fabric/hub-admin-token`, then mints from
operator key — **do not** run `--accept` unless you mean to Accept on Hub:

```bash
npm run playnet:deploy-gooncitizen -- --production --check-only
# same-config Accept from local:
# npm run playnet:deploy-gooncitizen -- --production --accept
```

## Git pull / GitHub host keys

`git pull` may prompt to trust GitHub’s host key (ECDSA vs IP). Confirm against
GitHub’s published keys; do not disable `StrictHostKeyChecking` globally.

## What not to do

- `nvm use default` when default is not 24.15.0
- `pm2 start scripts/node.js` without `--interpreter "$(nvm which 24.15.0)"`
- `npm run report:install` (wipes lockfile)
- `SC_MODE=server` **and** `SC_FABRIC=0` on a host advertised as
  `relay.goon.vc:7777`
- Binding HTTP on `0.0.0.0` without Caddy/Nginx *and* without `SC_MODE=server`
- Proxying Fabric `:7777` through Nginx/Caddy, or pointing `relay.goon.vc` at Hub `:8080` while this process also listens on `:7777`
- Dialing `relay.goon.vc:7777` from the relay itself
- Enabling Hub `bitcoin.managed` bitcoind in this same pm2 app
- Committing `.env`, `settings/local.js`, or Discord tokens
