# Electron Desktop Application Build Guide
This project includes Electron support for building a Windows desktop application with installer.

## Prerequisites

1. Install dependencies (requires **Electron ≥ 43** for macOS 26 / Apple Silicon):
   ```bash
   npm install
   ```
   If `node_modules/electron/dist` is missing after install, run:
   ```bash
   node node_modules/electron/install.js
   ```

2. (Optional) Create `settings/local.js` from `settings/example.js` and configure your settings.

## Development

Run the desktop app (relay + **same** dashboard as `npm start`):

```bash
npm run start:desktop:dev
```

Or run the relay only (browser at http://localhost:3041/):

```bash
npm start
```

Legacy alias:

```bash
npm run electron:dev
```

This will:
- Start the live relay on port 3041 (or the next free port if busy)
- Open the Electron window with DevTools (dev mode)
- Load the dashboard from the local relay (`GET /`) — `assets/dashboard.html`

**Note:** Some environments set `ELECTRON_RUN_AS_NODE=1`, which breaks Electron
(`require('electron')` returns a path string). `npm run start:desktop` goes through
`scripts/electron.js`, which clears that flag on every platform.

## Production installers

### Windows (NSIS)

```bash
npm run build:installer:win
```

Output: `dist/Star Citizen Live Setup x.x.x.exe`

### Debian (.deb)

Build on Linux (or a Linux CI runner):

```bash
npm run build:installer:deb
```

Output: `dist/star-citizen-live_x.x.x_amd64.deb` (name may vary by electron-builder version)

### Both platforms

```bash
npm run build:installers
```

Each target runs `npm run build:browser` first (copies `assets/dashboard.html` → `assets/index.html`).

## Building Windows Installer (legacy script name)

```bash
npm run build:win:installer
```

Same as `build:installer:win`.

## Output

The Windows installer will be created in:
- `dist/Star Citizen Live Setup x.x.x.exe` - NSIS installer

## Installer Features

The Windows installer includes:
- Custom installation directory selection
- Desktop shortcut creation
- Start menu shortcut creation
- Uninstaller support

## Application Structure

- `main.js` — Electron main process (starts `services/LiveRelay.js`, opens dashboard window)
- `preload.js` — Preload script for secure IPC communication
- `services/LiveRelay.js` — Fabric-free relay (REST + live dashboard at `/`)
- `assets/dashboard.html` — Dashboard UI served by the relay and loaded in Electron

## Troubleshooting

### `exited with signal SIGSEGV` / `SIGTRAP`
Electron **28** (and other pre-Tahoe builds) crash during Chromium init on
**macOS 26 (Tahoe) arm64**. This project pins **Electron 43+**. Fix:

```bash
npm install
node node_modules/electron/install.js   # if dist/ is missing
npm run start:desktop
```

### `app.whenReady is not a function`
Your shell has `ELECTRON_RUN_AS_NODE=1`. Use `npm run start:desktop` (via
`scripts/electron.js`), which clears that flag.

### Service fails to start
- Check that port 3041 (or your configured port) is not in use — the desktop
  app will try the next free port automatically
- Verify `settings/local.js` exists and is properly configured

### Window doesn't load
- Check the console for errors
- Verify the service started successfully (`G00N CITIZEN listening on http://127.0.0.1:…`)
- In development mode, ensure the build completed: `npm run build:browser`

### Build fails
- Ensure all dependencies are installed: `npm install`
- Check that Node.js version is compatible (see `.nvmrc` if present)
- On Windows, you may need to install build tools: `npm install --global windows-build-tools`

## Adding Icons

To add application icons:
1. Create `assets/icon.png` (512x512) for macOS/Linux
2. Create `assets/icon.ico` (256x256) for Windows
3. Update `package.json` build config if using different paths

