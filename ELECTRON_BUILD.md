# Electron Desktop Application Build Guide

This project includes Electron support for building a Windows desktop application with installer.

## Prerequisites

1. Install dependencies:
   ```bash
   npm install
   ```

2. (Optional) Create `settings/local.js` from `settings/example.js` and configure your settings.

## Development

Run the Electron app in development mode:

```bash
npm run electron:dev
```

This will:
- Start the Star Citizen service on port 3041 (or configured port)
- Open the Electron window with DevTools
- Load the UI from the local server

## Building Windows Installer

### Build the Windows Installer

```bash
npm run build:win:installer
```

This will:
1. Build the browser bundle (`npm run build:browser`)
2. Create a Windows NSIS installer in the `dist/` directory

### Build All Platforms

```bash
npm run build:electron
```

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

- `main.js` - Electron main process (starts service and creates window)
- `preload.js` - Preload script for secure IPC communication
- The Star Citizen service runs as a local HTTP server
- The Electron window loads the UI from the local server or built HTML

## Troubleshooting

### Service fails to start
- Check that port 3041 (or your configured port) is not in use
- Verify `settings/local.js` exists and is properly configured

### Window doesn't load
- Check the console for errors
- Verify the service started successfully
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

