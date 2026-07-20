'use strict';

// Electron main process — GoonCitizen desktop app.
// Starts the live log relay, tray icon, and login-item auto-start.

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

const { app, BrowserWindow, Tray, Menu, nativeImage, ipcMain, shell } = electron;
const path = require('path');
const fs = require('fs');
const http = require('http');

const { BRAND_NAME } = require('./constants');
const LiveRelay = require('./services/LiveRelay');
const { resolveLogFile } = require('./functions/locate');
const identityLib = require('./functions/identity');
const identityStore = require('./functions/identityStore');
const settingsStore = require('./functions/settingsStore');

let settings = {};
try {
  settings = require('./settings/local');
} catch (error) {
  console.warn('[ELECTRON]', '[WARNING]', 'settings/local.js not found, using defaults');
  settings = {};
}

let mainWindow = null;
let tray = null;
let starCitizenService = null;
let activePort = null;
/** When true, closing the window quits instead of hiding to tray. */
let isQuitting = false;
/** Decrypted identity, held in main-process memory only while unlocked. */
let unlockedIdentity = null;

const startHidden = process.argv.includes('--hidden') ||
  process.argv.includes('--open-as-hidden');

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    showMainWindow();
  });
}

function servicePort () {
  return Number(process.env.PORT) || settings.http?.port || settings.port || 3041;
}

/** Map settings/local.js + persisted userData settings (+ env) into LiveRelay options. */
function buildRelaySettings (port) {
  // Persisted operator settings (edited via the dashboard's Settings modal).
  // Priority: env > persisted settings.json (userData) > settings/local.js > auto.
  const persisted = settingsStore.loadSettings(app.getPath('userData'));
  const explicit = process.env.SC_LOGFILE || persisted.logfile || settings.logfile || null;
  const channel = process.env.SC_CHANNEL || persisted.channel || settings.channel || null;
  const resolved = resolveLogFile({ explicit, channel });

  const discordIn = settings.discord || {};
  const webhook = process.env.DISCORD_WEBHOOK_URL || persisted.discordWebhook || discordIn.webhook || null;

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
    }, settings.missions || {}),
    uplink: Object.assign({
      enable: !!(process.env.SC_UPLINK_URL || settings.uplink?.url),
      url: process.env.SC_UPLINK_URL || settings.uplink?.url || null
    }, settings.uplink || {}),
    settingsDir: app.getPath('userData')
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

function resolveAppIcon () {
  const iconPng = path.join(__dirname, 'assets', 'icon.png');
  const iconIco = path.join(__dirname, 'assets', 'icon.ico');
  if (process.platform === 'win32' && fs.existsSync(iconIco)) return iconIco;
  if (fs.existsSync(iconPng)) return iconPng;
  return undefined;
}

function resolveTrayImage () {
  const assets = path.join(__dirname, 'assets');
  if (process.platform === 'darwin') {
    const template2x = path.join(assets, 'trayTemplate@2x.png');
    const template = path.join(assets, 'trayTemplate.png');
    const file = fs.existsSync(template2x) ? template2x
      : (fs.existsSync(template) ? template : path.join(assets, 'tray.png'));
    if (!fs.existsSync(file)) return nativeImage.createEmpty();
    const img = nativeImage.createFromPath(file);
    img.setTemplateImage(true);
    return img;
  }
  const trayPng = path.join(assets, 'tray.png');
  const iconPng = path.join(assets, 'icon.png');
  const file = fs.existsSync(trayPng) ? trayPng : iconPng;
  if (!fs.existsSync(file)) return nativeImage.createEmpty();
  return nativeImage.createFromPath(file);
}

function showMainWindow () {
  if (!mainWindow) {
    if (activePort != null) createWindow(activePort);
    return;
  }
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
  if (process.platform === 'darwin' && app.dock) app.dock.show();
}

function hideMainWindow () {
  if (!mainWindow) return;
  mainWindow.hide();
  if (process.platform === 'darwin' && app.dock) app.dock.hide();
}

function quitApp () {
  isQuitting = true;
  app.quit();
}

function openAtLoginEnabled () {
  try {
    return !!app.getLoginItemSettings().openAtLogin;
  } catch (_) {
    return false;
  }
}

/** Enable launch at OS login for installed builds (and opt-in via settings). */
function configureAutoLaunch () {
  const persisted = settingsStore.loadSettings(app.getPath('userData'));
  const forceOff = process.env.SC_OPEN_AT_LOGIN === '0' || persisted.openAtLogin === false || settings.openAtLogin === false;
  const forceOn = process.env.SC_OPEN_AT_LOGIN === '1' || persisted.openAtLogin === true || settings.openAtLogin === true;
  const enable = forceOn || (!forceOff && app.isPackaged);

  try {
    app.setLoginItemSettings({
      openAtLogin: enable,
      openAsHidden: true,
      path: process.execPath,
      args: enable ? ['--hidden'] : []
    });
    console.log('[ELECTRON]', '[STATUS]', `Open at login: ${enable ? 'on' : 'off'}`);
  } catch (error) {
    console.warn('[ELECTRON]', '[WARNING]', 'Could not set login item:', error.message || error);
  }
}

function setOpenAtLogin (enabled) {
  try {
    app.setLoginItemSettings({
      openAtLogin: !!enabled,
      openAsHidden: true,
      path: process.execPath,
      args: enabled ? ['--hidden'] : []
    });
  } catch (error) {
    console.warn('[ELECTRON]', '[WARNING]', 'Could not update login item:', error.message || error);
  }
  rebuildTrayMenu();
}

function rebuildTrayMenu () {
  if (!tray) return;
  const atLogin = openAtLoginEnabled();
  const menu = Menu.buildFromTemplate([
    {
      label: `Show ${BRAND_NAME}`,
      click: () => showMainWindow()
    },
    {
      label: 'Open at Login',
      type: 'checkbox',
      checked: atLogin,
      click: (item) => setOpenAtLogin(item.checked)
    },
    { type: 'separator' },
    {
      label: 'Quit',
      click: () => quitApp()
    }
  ]);
  tray.setContextMenu(menu);
}

function createTray () {
  if (tray) return;
  const image = resolveTrayImage();
  tray = new Tray(image.isEmpty() ? nativeImage.createEmpty() : image);
  tray.setToolTip(BRAND_NAME);
  rebuildTrayMenu();

  tray.on('click', () => {
    if (mainWindow && mainWindow.isVisible()) {
      hideMainWindow();
    } else {
      showMainWindow();
    }
  });

  tray.on('double-click', () => showMainWindow());
}

function createWindow (port) {
  const icon = resolveAppIcon();

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
    if (!startHidden) {
      mainWindow.show();
      if (isDev) mainWindow.focus();
    } else {
      console.log('[ELECTRON]', '[STATUS]', 'Started hidden (tray only)');
      if (process.platform === 'darwin' && app.dock) app.dock.hide();
    }
  });

  // If the page never becomes ready, still show unless we intentionally hid.
  setTimeout(() => {
    if (mainWindow && !mainWindow.isVisible() && !startHidden) {
      mainWindow.show();
    }
  }, 2500);

  mainWindow.webContents.on('did-fail-load', (_e, code, desc, url) => {
    console.error('[ELECTRON]', '[ERROR]', `did-fail-load ${code} ${desc} (${url})`);
  });

  // Close → tray (keep relay running). Quit only via tray menu / Cmd+Q.
  mainWindow.on('close', (event) => {
    if (!isQuitting) {
      event.preventDefault();
      hideMainWindow();
    }
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

if (gotLock) {
  app.whenReady().then(async () => {
    try {
      configureAutoLaunch();
      createTray();
      await startService();
      applyIdentityToService();
      createWindow(activePort || servicePort());
    } catch (error) {
      console.error('[ELECTRON]', '[ERROR]', 'Startup failed:', error);
      isQuitting = true;
      app.quit();
      return;
    }

    app.on('activate', () => {
      showMainWindow();
    });
  });

  // Keep running in the tray when the window is closed.
  app.on('window-all-closed', (event) => {
    if (!isQuitting) {
      // Electron may still emit this; do not quit — tray owns lifetime.
      if (typeof event.preventDefault === 'function') event.preventDefault();
    }
  });

  app.on('before-quit', async () => {
    isQuitting = true;
    if (tray) {
      tray.destroy();
      tray = null;
    }
    await stopService();
  });
}

// --- Identity (first-run onboarding) -------------------------------------

function identityDir () {
  return app.getPath('userData');
}

/** Push the unlocked identity into the running relay for uplink signing. */
function applyIdentityToService () {
  if (starCitizenService && typeof starCitizenService.setIdentity === 'function') {
    starCitizenService.setIdentity(unlockedIdentity);
  }
}

function identitySummary () {
  const blob = identityStore.loadEncrypted(identityDir());
  return {
    exists: !!blob,
    pubkey: blob ? blob.pubkey : null,
    xpub: blob ? blob.xpub : null,
    createdAt: blob ? blob.createdAt : null,
    unlocked: !!unlockedIdentity
  };
}

ipcMain.handle('identity:get', () => identitySummary());

ipcMain.handle('identity:create', (_e, { password } = {}) => {
  if (identityStore.hasIdentity(identityDir())) {
    return { error: 'An identity already exists. Restore or forget it first.' };
  }
  try {
    const identity = identityLib.createIdentity();
    const blob = identityLib.encryptIdentity(identity, password);
    identityStore.saveEncrypted(identityDir(), blob);
    unlockedIdentity = identity;
    applyIdentityToService();
    // Mnemonic is returned exactly once so the UI can show the backup step.
    return { pubkey: identity.pubkey, mnemonic: identity.mnemonic };
  } catch (error) {
    return { error: error.message || String(error) };
  }
});

ipcMain.handle('identity:restore', (_e, { mnemonic, xprv, password } = {}) => {
  try {
    const identity = identityLib.restoreIdentity(xprv ? { xprv } : { mnemonic });
    const blob = identityLib.encryptIdentity(identity, password);
    identityStore.saveEncrypted(identityDir(), blob);
    unlockedIdentity = identity;
    applyIdentityToService();
    return { pubkey: identity.pubkey };
  } catch (error) {
    return { error: error.message || String(error) };
  }
});

ipcMain.handle('identity:unlock', (_e, { password } = {}) => {
  const blob = identityStore.loadEncrypted(identityDir());
  if (!blob) return { error: 'No identity found.' };
  try {
    unlockedIdentity = identityLib.decryptIdentity(blob, password);
    applyIdentityToService();
    return { pubkey: unlockedIdentity.pubkey };
  } catch (error) {
    return { error: error.message || String(error) };
  }
});

ipcMain.handle('identity:sign-envelope', (_e, payload) => {
  if (!unlockedIdentity) return { error: 'Identity is locked.' };
  try {
    return identityLib.signEnvelope(unlockedIdentity, payload);
  } catch (error) {
    return { error: error.message || String(error) };
  }
});

ipcMain.handle('identity:lock', () => {
  unlockedIdentity = null;
  applyIdentityToService();
  return { unlocked: false };
});

ipcMain.handle('identity:forget', () => {
  unlockedIdentity = null;
  applyIdentityToService();
  const removed = identityStore.removeIdentity(identityDir());
  return { removed };
});

// --- Service status --------------------------------------------------------

ipcMain.handle('get-service-status', () => {
  if (starCitizenService) {
    return {
      status: starCitizenService.status || 'UNKNOWN',
      port: activePort || starCitizenService.settings?.port || servicePort(),
      channel: starCitizenService.channel || null,
      brand: BRAND_NAME,
      openAtLogin: openAtLoginEnabled()
    };
  }
  return { status: 'STOPPED', port: null, brand: BRAND_NAME, openAtLogin: openAtLoginEnabled() };
});

ipcMain.handle('set-open-at-login', (_e, enabled) => {
  setOpenAtLogin(!!enabled);
  return { openAtLogin: openAtLoginEnabled() };
});

ipcMain.handle('restart-service', async () => {
  await stopService();
  await startService();
  applyIdentityToService();
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
