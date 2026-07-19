'use strict';

// Electron main process — G00N Citizen desktop app.
// Starts the live log relay and opens the same dashboard as `npm start`.

const electron = require('electron');
if (!electron || typeof electron !== 'object' || !electron.app) {
  console.error(
    '[ELECTRON]', '[ERROR]',
    'require("electron") did not return the Electron API.',
    'Unset ELECTRON_RUN_AS_NODE (this environment had it set) and launch with:',
    '  npm run start:desktop'
  );
  process.exit(1);
}

const { app, BrowserWindow, ipcMain, shell } = electron;
const path = require('path');
const fs = require('fs');
const http = require('http');

const { BRAND_NAME } = require('./constants');
const LiveRelay = require('./services/LiveRelay');
const { resolveLogFile } = require('./functions/locate');

let settings = {};
try {
  settings = require('./settings/local');
} catch (error) {
  console.warn('[ELECTRON]', '[WARNING]', 'settings/local.js not found, using defaults');
  settings = {};
}

let mainWindow = null;
let starCitizenService = null;
let activePort = null;

function servicePort () {
  return Number(process.env.PORT) || settings.http?.port || settings.port || 3041;
}

/** Map settings/local.js (+ env) into LiveRelay constructor options. */
function buildRelaySettings (port) {
  const explicit = process.env.SC_LOGFILE || settings.logfile || null;
  const channel = process.env.SC_CHANNEL || settings.channel || null;
  const resolved = resolveLogFile({ explicit, channel });

  const discordIn = settings.discord || {};
  const webhook = process.env.DISCORD_WEBHOOK_URL || discordIn.webhook || null;

  return {
    port,
    logfile: resolved.file,
    channel: resolved.channel || channel || null,
    seed: process.env.SC_SEED != null ? process.env.SC_SEED : (settings.seed !== undefined ? settings.seed : resolved.file),
    discord: {
      enable: !!(discordIn.enable && webhook),
      webhook,
      announceKills: discordIn.announceKills !== false,
      announcePlayerJoins: discordIn.announcePlayerJoins !== false,
      announceActivities: !!discordIn.announceActivities,
      announceMissions: !!discordIn.announceMissions,
      announceCombat: !!discordIn.announceCombat,
      announceIncaps: !!discordIn.announceIncaps
    },
    missions: Object.assign({
      enable: true,
      dir: process.env.SC_REGISTER_DIR || settings.missions?.dir || null,
      officers: process.env.SC_OFFICERS
        ? process.env.SC_OFFICERS.split(',').map((s) => s.trim()).filter(Boolean)
        : (Array.isArray(settings.missions?.officers) ? settings.missions.officers.map(String) : [])
    }, settings.missions || {})
  };
}

function waitForHttp (port, { timeoutMs = 10000, intervalMs = 100 } = {}) {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const tick = () => {
      const req = http.get({ host: '127.0.0.1', port, path: '/', timeout: 500 }, (res) => {
        res.resume();
        resolve();
      });
      req.on('error', () => {
        if (Date.now() - started > timeoutMs) {
          reject(new Error(`Dashboard did not become ready on port ${port}`));
        } else {
          setTimeout(tick, intervalMs);
        }
      });
      req.on('timeout', () => {
        req.destroy();
      });
    };
    tick();
  });
}

function createWindow (port) {
  const iconPng = path.join(__dirname, 'assets', 'icon.png');
  const iconIco = path.join(__dirname, 'assets', 'icon.ico');
  const icon = process.platform === 'win32' && fs.existsSync(iconIco)
    ? iconIco
    : (fs.existsSync(iconPng) ? iconPng : undefined);

  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    title: BRAND_NAME,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
      webSecurity: true
    },
    icon,
    show: false
  });

  const isDev = process.argv.includes('--dev');
  const dashboardUrl = `http://127.0.0.1:${port}/`;

  mainWindow.loadURL(dashboardUrl).catch((err) => {
    console.error('[ELECTRON]', '[ERROR]', 'Failed to load dashboard:', err);
  });

  if (isDev) {
    mainWindow.webContents.openDevTools();
  }

  mainWindow.once('ready-to-show', () => {
    mainWindow.setTitle(BRAND_NAME);
    mainWindow.show();
    if (isDev) mainWindow.focus();
  });

  // If the page never becomes ready, still show the window so errors are visible.
  setTimeout(() => {
    if (mainWindow && !mainWindow.isVisible()) {
      mainWindow.show();
    }
  }, 2500);

  mainWindow.webContents.on('did-fail-load', (_e, code, desc, url) => {
    console.error('[ELECTRON]', '[ERROR]', `did-fail-load ${code} ${desc} (${url})`);
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  mainWindow.webContents.on('will-navigate', (event, navigationUrl) => {
    try {
      const parsedUrl = new URL(navigationUrl);
      const ok = parsedUrl.origin === `http://127.0.0.1:${port}` ||
        parsedUrl.origin === `http://localhost:${port}` ||
        parsedUrl.protocol.startsWith('file:');
      if (!ok) event.preventDefault();
    } catch (_) {
      event.preventDefault();
    }
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });
}

async function startService () {
  const preferred = servicePort();
  const candidates = [preferred, preferred + 1, preferred + 2, 0];

  console.log('[ELECTRON]', '[STATUS]', `Starting ${BRAND_NAME} relay...`);

  let lastError = null;
  for (const port of candidates) {
    try {
      const opts = buildRelaySettings(port);
      if (opts.logfile) {
        console.log('[ELECTRON]', '[STATUS]', `Game.log: ${opts.channel || '?'} (${opts.logfile})`);
      } else {
        console.log('[ELECTRON]', '[STATUS]', 'No Game.log found — set SC_LOGFILE or install path detection');
      }

      starCitizenService = new LiveRelay(opts);
      await starCitizenService.start();

      // If we requested port 0, read the OS-assigned port from the server.
      const bound = starCitizenService.server && starCitizenService.server.address();
      activePort = (bound && bound.port) || opts.port || preferred;

      await waitForHttp(activePort);
      console.log('[ELECTRON]', '[STATUS]', `${BRAND_NAME} listening on http://127.0.0.1:${activePort}/`);
      return starCitizenService;
    } catch (error) {
      lastError = error;
      const msg = String(error && error.message || error);
      const busy = /EADDRINUSE|address already in use/i.test(msg);
      if (starCitizenService) {
        try { await starCitizenService.stop(); } catch (_) { /* ignore */ }
        starCitizenService = null;
      }
      if (busy && port !== 0) {
        console.warn('[ELECTRON]', '[WARNING]', `Port ${port} busy, trying next...`);
        continue;
      }
      break;
    }
  }

  console.error('[ELECTRON]', '[ERROR]', 'Failed to start relay:', lastError);
  throw lastError || new Error('Failed to start relay');
}

async function stopService () {
  if (starCitizenService) {
    try {
      console.log('[ELECTRON]', '[STATUS]', 'Stopping relay...');
      await starCitizenService.stop();
      starCitizenService = null;
      activePort = null;
      console.log('[ELECTRON]', '[STATUS]', 'Relay stopped');
    } catch (error) {
      console.error('[ELECTRON]', '[ERROR]', 'Error stopping service:', error);
    }
  }
}

app.whenReady().then(async () => {
  try {
    await startService();
    createWindow(activePort || servicePort());
  } catch (error) {
    console.error('[ELECTRON]', '[ERROR]', 'Startup failed:', error);
    app.quit();
    return;
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow(activePort || servicePort());
    }
  });
});

app.on('window-all-closed', async () => {
  await stopService();
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', async () => {
  await stopService();
});

ipcMain.handle('get-service-status', () => {
  if (starCitizenService) {
    return {
      status: starCitizenService.status || 'UNKNOWN',
      port: activePort || starCitizenService.settings?.port || servicePort(),
      channel: starCitizenService.channel || null,
      brand: BRAND_NAME
    };
  }
  return { status: 'STOPPED', port: null, brand: BRAND_NAME };
});

ipcMain.handle('restart-service', async () => {
  await stopService();
  await startService();
  if (mainWindow && activePort) {
    await mainWindow.loadURL(`http://127.0.0.1:${activePort}/`);
  }
  return { success: true, port: activePort };
});

process.on('uncaughtException', (error) => {
  console.error('[ELECTRON]', '[ERROR]', 'Uncaught exception:', error);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('[ELECTRON]', '[ERROR]', 'Unhandled rejection at:', promise, 'reason:', reason);
});
