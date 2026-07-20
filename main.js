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

const { app, BrowserWindow, Tray, Menu, nativeImage, ipcMain, shell, Notification } = electron;
const path = require('path');
const fs = require('fs');
const http = require('http');

const { BRAND_NAME } = require('./constants');
const LiveRelay = require('./services/LiveRelay');
const { resolveLogFile } = require('./functions/locate');
const identityLib = require('./functions/identity');
const identityStore = require('./functions/identityStore');
const settingsStore = require('./functions/settingsStore');
const { storeRoot, registerPath } = require('./functions/storePaths');

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
  // Windows toast notifications need a stable AppUserModelID.
  if (process.platform === 'win32' && app.setAppUserModelId) {
    app.setAppUserModelId('vc.goon.desktop');
  }
  app.on('second-instance', () => {
    showMainWindow();
  });
}

function servicePort () {
  return Number(process.env.PORT) || settings.http?.port || settings.port || 3041;
}

// The app's Fabric Store — ALL internal storage (settings, missions, groups).
// Opened once at startup; injected into LiveRelay; used by IPC handlers.
let appStore = null;

/** Open (or re-open) the shared Fabric Store under the Hub-style named root. */
async function openAppStore () {
  const appStoreRoot = storeRoot(path.join(app.getPath('userData'), 'stores'));
  // One-time migrate of the old flat userData/settings.json into the store root,
  // where types/Store imports it into the `settings` collection and retires it.
  try {
    const legacy = path.join(app.getPath('userData'), 'settings.json');
    const next = path.join(appStoreRoot, 'settings.json');
    if (fs.existsSync(legacy) && !fs.existsSync(next)) fs.renameSync(legacy, next);
  } catch (_) { /* best effort */ }
  if (!appStore) {
    const { Store } = require('./types/Store');
    appStore = new Store({ path: process.env.SC_REGISTER_DIR || registerPath(appStoreRoot) });
  }
  await appStore.start(); // idempotent; re-opens after a service restart
  return { appStoreRoot, store: appStore };
}

/** Map settings/local.js + Fabric Store settings (+ env) into LiveRelay options. */
function buildRelaySettings (port) {
  const appStoreRoot = storeRoot(path.join(app.getPath('userData'), 'stores'));
  // Priority: env > Fabric Store settings > settings/local.js > auto.
  const persisted = settingsStore.loadSettings(appStore);
  const explicit = process.env.SC_LOGFILE || persisted.logfile || settings.logfile || null;
  const channel = process.env.SC_CHANNEL || persisted.channel || settings.channel || null;
  const resolved = resolveLogFile({ explicit, channel });

  const discordIn = settings.discord || {};
  const webhook = process.env.DISCORD_WEBHOOK_URL || persisted.discordWebhook || discordIn.webhook || null;

  return {
    port,
    logfile: resolved.file,
    channel: resolved.channel || channel || null,
    seed: process.env.SC_SEED != null
      ? process.env.SC_SEED
      : (settings.seed !== undefined
        ? settings.seed
        : (resolved.file && fs.existsSync(resolved.file) ? resolved.file : null)),
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
      officers: process.env.SC_OFFICERS
        ? process.env.SC_OFFICERS.split(',').map((s) => s.trim()).filter(Boolean)
        : (Array.isArray(settings.missions?.officers) ? settings.missions.officers.map(String) : [])
    }, settings.missions || {}),
    uplink: Object.assign({
      enable: !!(process.env.SC_UPLINK_URL || settings.uplink?.url),
      url: process.env.SC_UPLINK_URL || settings.uplink?.url || null
    }, settings.uplink || {}),
    // Wallet: ledger mode unless settings/local.js supplies a bitcoind rpc.
    payouts: Object.assign({ enable: true, ledger: true, network: 'regtest' }, settings.payouts || {}),
    settingsDir: appStoreRoot,
    store: appStore // shared, already-started Fabric Store
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
  const persisted = settingsStore.loadSettings(appStore); // {} until the store opens
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
    autoHideMenuBar: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
      webSecurity: true
    },
    icon,
    show: false
  });

  // No File/Edit/View window menu — the dashboard chrome is the toolbar.
  mainWindow.setMenuBarVisibility(false);
  if (typeof mainWindow.removeMenu === 'function') mainWindow.removeMenu();

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
    mainWindow.setMenuBarVisibility(false);
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
  await openAppStore(); // Fabric Store first — settings live there

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
      // Hide the native application / window menu bar (File, Edit, View…).
      Menu.setApplicationMenu(null);
      await openAppStore(); // settings come from the Fabric Store
      configureAutoLaunch();
      createTray();
      await startService();
      applyIdentityToService();
      applySnapshotCaptureToService();
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

// --- Identity (first-run onboarding + Hub-style key safety) ---------------
//
// Safety model brought forward from hub.fabric.pub's IdentityManager:
//  - the plaintext key lives only in main-process memory while unlocked
//  - auto-lock clears it after an idle timeout (configurable, default 30 min)
//  - seed reveal and backup export re-verify the password first
//  - forget requires an explicit confirmation flag
//  - every lock-state change is broadcast so the UI never drifts

const IDENTITY_AUTOLOCK_DEFAULT_MINUTES = 30;
let identityAutoLockTimer = null;

function identityDir () {
  return app.getPath('userData');
}

function identityAutoLockMinutes () {
  const persisted = settingsStore.loadSettings(appStore);
  const v = persisted.identityAutoLockMinutes;
  if (v === 0) return 0;
  const n = Math.floor(Number(v));
  if (!Number.isFinite(n) || n <= 0) return IDENTITY_AUTOLOCK_DEFAULT_MINUTES;
  return Math.min(24 * 60, n);
}

/** Push the unlocked identity into the running relay for uplink signing. */
function applyIdentityToService () {
  if (starCitizenService && typeof starCitizenService.setIdentity === 'function') {
    starCitizenService.setIdentity(unlockedIdentity);
  }
}

// --- Snapshots (periodic reduced-size screen captures) ---------------------

const SNAPSHOT_TARGET_WIDTH = 640; // small enough for cheap storage, big enough for OCR/analysis
const SNAPSHOT_JPEG_QUALITY = 60;

/**
 * Wire the platform capture function into the relay's SnapshotManager.
 * Captures the primary display via screenshot-desktop, downscales with
 * Electron's nativeImage, and hands back a JPEG buffer + dimensions.
 * The manager itself decides *when* to capture (opt-in setting + interval).
 */
function applySnapshotCaptureToService () {
  if (!starCitizenService || typeof starCitizenService.setSnapshotCapture !== 'function') return;
  let screenshot = null;
  try {
    screenshot = require('screenshot-desktop');
  } catch (error) {
    console.warn('[ELECTRON]', '[WARNING]', 'screenshot-desktop unavailable — snapshots disabled:', error.message);
    return;
  }
  starCitizenService.setSnapshotCapture(async () => {
    const png = await screenshot({ format: 'png' });
    let image = nativeImage.createFromBuffer(png);
    if (image.isEmpty()) throw new Error('screen capture produced an empty image');
    if (image.getSize().width > SNAPSHOT_TARGET_WIDTH) {
      image = image.resize({ width: SNAPSHOT_TARGET_WIDTH });
    }
    const { width, height } = image.getSize();
    return { buffer: image.toJPEG(SNAPSHOT_JPEG_QUALITY), width, height };
  });
}

/** Notify the renderer that lock state changed (header chip, modals). */
function broadcastIdentityChanged () {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('identity:changed', identitySummary());
  }
}

function lockIdentity () {
  unlockedIdentity = null;
  if (identityAutoLockTimer) { clearTimeout(identityAutoLockTimer); identityAutoLockTimer = null; }
  applyIdentityToService();
  broadcastIdentityChanged();
}

/** (Re)start the idle auto-lock countdown; called on unlock and each signing use. */
function armIdentityAutoLock () {
  if (identityAutoLockTimer) { clearTimeout(identityAutoLockTimer); identityAutoLockTimer = null; }
  const minutes = identityAutoLockMinutes();
  if (!minutes || !unlockedIdentity) return;
  identityAutoLockTimer = setTimeout(() => {
    console.log('[IDENTITY] auto-lock after', minutes, 'min idle');
    lockIdentity();
  }, minutes * 60 * 1000);
}

function setUnlockedIdentity (identity) {
  unlockedIdentity = identity;
  applyIdentityToService();
  armIdentityAutoLock();
  broadcastIdentityChanged();
}

function identitySummary () {
  const blob = identityStore.loadEncrypted(identityDir());
  return {
    exists: !!blob,
    pubkey: blob ? blob.pubkey : null,
    xpub: blob ? blob.xpub : null,
    createdAt: blob ? blob.createdAt : null,
    unlocked: !!unlockedIdentity,
    autoLockMinutes: identityAutoLockMinutes()
  };
}

ipcMain.handle('identity:get', () => identitySummary());

ipcMain.handle('identity:create', (_e, { password } = {}) => {
  if (identityStore.hasIdentity(identityDir())) {
    return { error: 'An identity already exists. Restore or forget it first.' };
  }
  if (!password || password.length < 8) return { error: 'Password must be at least 8 characters.' };
  try {
    const identity = identityLib.createIdentity();
    const blob = identityLib.encryptIdentity(identity, password);
    identityStore.saveEncrypted(identityDir(), blob);
    setUnlockedIdentity(identity);
    // Mnemonic is returned exactly once so the UI can show the backup step.
    return { pubkey: identity.pubkey, mnemonic: identity.mnemonic };
  } catch (error) {
    return { error: error.message || String(error) };
  }
});

ipcMain.handle('identity:restore', (_e, { mnemonic, xprv, password } = {}) => {
  if (!password || password.length < 8) return { error: 'Password must be at least 8 characters.' };
  try {
    const identity = identityLib.restoreIdentity(xprv ? { xprv } : { mnemonic });
    const blob = identityLib.encryptIdentity(identity, password);
    identityStore.saveEncrypted(identityDir(), blob);
    setUnlockedIdentity(identity);
    return { pubkey: identity.pubkey };
  } catch (error) {
    return { error: error.message || String(error) };
  }
});

ipcMain.handle('identity:unlock', (_e, { password } = {}) => {
  const blob = identityStore.loadEncrypted(identityDir());
  if (!blob) return { error: 'No identity found.' };
  try {
    const identity = identityLib.decryptIdentity(blob, password);
    setUnlockedIdentity(identity);
    return { pubkey: identity.pubkey };
  } catch (error) {
    return { error: error.message || String(error) };
  }
});

ipcMain.handle('identity:sign-envelope', (_e, payload) => {
  if (!unlockedIdentity) return { error: 'Identity is locked.' };
  try {
    const envelope = identityLib.signEnvelope(unlockedIdentity, payload);
    armIdentityAutoLock(); // signing is activity — reset the idle countdown
    return envelope;
  } catch (error) {
    return { error: error.message || String(error) };
  }
});

// Raw BIP340 Schnorr over message bytes — used for k-of-n authority
// acceptances (mission completion approval / group decisions), where every
// signer signs the same canonical message.
ipcMain.handle('identity:sign-message', (_e, { message } = {}) => {
  if (!unlockedIdentity) return { error: 'Identity is locked.' };
  if (typeof message !== 'string' || !message.length) return { error: 'message string required' };
  try {
    const key = identityLib.keyFromIdentity(unlockedIdentity);
    const signature = Buffer.from(key.signSchnorr(Buffer.from(message))).toString('hex');
    armIdentityAutoLock();
    return { pubkey: key.pubkey, signature };
  } catch (error) {
    return { error: error.message || String(error) };
  }
});

ipcMain.handle('identity:lock', () => {
  lockIdentity();
  return { unlocked: false };
});

// Reveal the recovery phrase / xprv — always re-verifies the password, even
// while unlocked, so a walk-up attacker at an unlocked app cannot exfiltrate
// the seed (mirrors the Hub's reveal discipline).
ipcMain.handle('identity:reveal', (_e, { password } = {}) => {
  const blob = identityStore.loadEncrypted(identityDir());
  if (!blob) return { error: 'No identity found.' };
  try {
    const identity = identityLib.decryptIdentity(blob, password);
    return { mnemonic: identity.mnemonic, xprv: identity.xprv, pubkey: identity.pubkey };
  } catch (error) {
    return { error: 'Incorrect password.' };
  }
});

// Export the at-rest encrypted blob as a portable backup file. Password is
// re-verified first; the file itself stays sealed with the same password.
ipcMain.handle('identity:export-backup', (_e, { password } = {}) => {
  const blob = identityStore.loadEncrypted(identityDir());
  if (!blob) return { error: 'No identity found.' };
  try {
    identityLib.decryptIdentity(blob, password); // verify only
  } catch (error) {
    return { error: 'Incorrect password.' };
  }
  return {
    filename: `gooncitizen-identity-${(blob.pubkey || 'backup').slice(0, 8)}.enc.json`,
    backup: Object.assign({ type: 'gooncitizen-identity-backup' }, blob)
  };
});

// Import a backup file (the encrypted blob format above). Requires the
// backup's password; refuses to overwrite an existing identity unless
// `replace` is set.
ipcMain.handle('identity:import-backup', (_e, { backup, password, replace } = {}) => {
  if (!backup || !backup.ciphertext) return { error: 'Not a GoonCitizen identity backup file.' };
  if (identityStore.hasIdentity(identityDir()) && !replace) {
    return { error: 'An identity already exists. Check "replace" to overwrite it.' };
  }
  try {
    const identity = identityLib.decryptIdentity(backup, password);
    const { type, ...blob } = backup;
    identityStore.saveEncrypted(identityDir(), blob);
    setUnlockedIdentity(identity);
    return { pubkey: identity.pubkey };
  } catch (error) {
    return { error: 'Could not decrypt backup (wrong password or corrupted file).' };
  }
});

ipcMain.handle('identity:set-autolock', (_e, { minutes } = {}) => {
  const n = Math.floor(Number(minutes));
  if (!Number.isFinite(n) || n < 0) return { error: 'minutes must be a non-negative number' };
  try {
    if (!appStore) return { error: 'Store not ready yet — try again in a moment.' };
    settingsStore.putSetting(appStore, 'identityAutoLockMinutes', Math.min(24 * 60, n));
    armIdentityAutoLock();
    return identitySummary();
  } catch (error) {
    return { error: error.message || String(error) };
  }
});

ipcMain.handle('identity:forget', (_e, { confirm } = {}) => {
  if (!confirm) return { error: 'Confirmation required to forget the identity.' };
  lockIdentity();
  const removed = identityStore.removeIdentity(identityDir());
  broadcastIdentityChanged();
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

ipcMain.handle('notify:show', (_e, { title, body, id, kind, actions } = {}) => {
  if (!Notification || !Notification.isSupported()) return { ok: false, reason: 'unsupported' };
  const actionList = Array.isArray(actions) ? actions.slice(0, 2) : [];
  const opts = {
    title: String(title || BRAND_NAME),
    body: String(body || ''),
    silent: false
  };
  // Action buttons are reliably supported on macOS; other platforms still get
  // click-to-focus. The dashboard always shows in-app Accept / Ignore too.
  if (process.platform === 'darwin' && actionList.length) {
    opts.actions = actionList.map((a) => ({ type: 'button', text: String(a.text || a.id || 'OK') }));
  }
  const n = new Notification(opts);
  const payload = { id: id || null, kind: kind || null };
  n.on('click', () => {
    showMainWindow();
    if (mainWindow) {
      mainWindow.focus();
      mainWindow.webContents.send('notify:click', payload);
    }
  });
  n.on('action', (_event, index) => {
    const action = actionList[index] || {};
    showMainWindow();
    if (mainWindow) {
      mainWindow.focus();
      mainWindow.webContents.send('notify:action', {
        id: id || null,
        kind: kind || null,
        index,
        action: action.id || action.text || null
      });
    }
  });
  n.show();
  return { ok: true, actions: process.platform === 'darwin' && actionList.length > 0 };
});

ipcMain.handle('restart-service', async () => {
  await stopService();
  await startService();
  applyIdentityToService();
  applySnapshotCaptureToService();
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
