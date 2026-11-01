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

const { app, BrowserWindow, Tray, Menu, nativeImage, ipcMain, shell, Notification, dialog, globalShortcut } = electron;
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
const { signInToRelay } = require('./functions/fabricLoginClient');
const { assertAllowedFabricHub } = require('./functions/fabricHubAllowlist');
const { delegationInvitationFromUrl } = require('./functions/qrScanLink');

/** URL scheme for opaque fabric: frames (shares, signer invitations). */
const FABRIC_PROTOCOL = 'fabric';
const { applyFabricEnvConfig, loadRepoDotEnv } = require('./functions/fabricEnvIdentity');
const { applyGoonCitizenEnvAliases } = require('./functions/goonCitizenEnvAliases');
const voicePttGlobal = require('./functions/voicePttGlobal');
const groupVoiceSettings = require('./functions/groupVoiceSettings');

let settings = {};
try {
  settings = require('./settings/local');
} catch (error) {
  console.warn('[ELECTRON]', '[WARNING]', 'settings/local.js not found, using defaults');
  settings = {};
}

let mainWindow = null;
let overlayWindow = null;
let tray = null;
let starCitizenService = null;
let activePort = null;
/** When true, closing the window quits instead of hiding to tray. */
let isQuitting = false;
/** Decrypted identity, held in main-process memory only while unlocked. */
let unlockedIdentity = null;
/** Signer invitation (`fabric:` link offer) waiting for the Linked signers page. */
let pendingDelegationInvitation = null;
/** Pending opaque fabric: group share prompt. */
let pendingGroupSharePrompt = null;

let startHiddenCached = null;
/** Tray-only start: `--hidden` (Windows / Linux login items) or a macOS login launch. */
function startHidden () {
  if (startHiddenCached === null) {
    let openedAtLogin = false;
    try {
      openedAtLogin = !!app.getLoginItemSettings().wasOpenedAtLogin;
    } catch (_) {}
    startHiddenCached = process.argv.includes('--hidden') ||
      process.argv.includes('--open-as-hidden') ||
      openedAtLogin;
  }
  return startHiddenCached;
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  // Windows toast notifications need a stable AppUserModelID.
  if (process.platform === 'win32' && app.setAppUserModelId) {
    app.setAppUserModelId('vc.goon.desktop');
  }
  app.on('second-instance', (_event, argv) => {
    showMainWindow();
    const fabricArg = (argv || []).find((a) => typeof a === 'string' && a.startsWith('fabric:'));
    if (fabricArg) void handleFabricProtocolUrl(fabricArg);
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
  const discord = (() => {
    try {
      const discordConfig = require('./functions/discordConfig');
      return discordConfig.resolveDiscordConfig({
        localDiscord: discordIn,
        persisted,
        settingsDir: appStoreRoot,
        env: process.env
      });
    } catch (_) {
      const webhook = process.env.DISCORD_WEBHOOK_URL || discordIn.webhook || null;
      return {
        enable: !!(discordIn.enable && (webhook || discordIn.token || process.env.DISCORD_BOT_TOKEN)),
        webhook,
        token: process.env.DISCORD_BOT_TOKEN || discordIn.token || null,
        channel: process.env.DISCORD_CHANNEL_ID || discordIn.channel || null,
        app: Object.assign({ id: null, secret: null }, discordIn.app || {}),
        announceKills: discordIn.announceKills !== false,
        announcePlayerJoins: discordIn.announcePlayerJoins !== false,
        announceActivities: !!discordIn.announceActivities,
        announceMissions: !!discordIn.announceMissions,
        announceCombat: !!discordIn.announceCombat,
        announceIncaps: !!discordIn.announceIncaps
      };
    }
  })();

  return {
    port,
    logfile: resolved.file,
    channel: resolved.channel || channel || null,
    seed: process.env.SC_SEED != null
      ? process.env.SC_SEED
      : (settings.seed !== undefined
        ? settings.seed
        : (resolved.file && fs.existsSync(resolved.file) ? resolved.file : null)),
    discord,
    missions: Object.assign({
      enable: true,
      officers: process.env.SC_OFFICERS
        ? process.env.SC_OFFICERS.split(',').map((s) => s.trim()).filter(Boolean)
        : (Array.isArray(settings.missions?.officers) ? settings.missions.officers.map(String) : [])
    }, settings.missions || {}),
    uplink: Object.assign({
      intervalMs: Number(settings.uplink?.intervalMs) || 5000
    }, settings.uplink || {}),
    fabric: Object.assign({
      enable: true,
      listen: true,
      port: Number(process.env.FABRIC_PORT || settings.fabric?.port) || 7777,
      peers: Array.isArray(settings.fabric?.peers) ? settings.fabric.peers : null
    }, settings.fabric || {}),
    // Wallet: ledger mode unless settings/local.js supplies a bitcoind rpc.
    payouts: Object.assign({ enable: true, ledger: true, network: 'regtest' }, settings.payouts || {}),
    bitcoin: Object.assign({
      enable: true,
      hub: process.env.SC_BITCOIN_HUB || 'http://127.0.0.1:8080',
      network: process.env.SC_BTC_NETWORK || 'regtest',
      adminToken: process.env.FABRIC_HUB_ADMIN_TOKEN || null,
      adminTokenFile: process.env.FABRIC_HUB_ADMIN_TOKEN_FILE || null
    }, settings.bitcoin || {}, {
      adminToken: process.env.FABRIC_HUB_ADMIN_TOKEN ||
        (settings.bitcoin && settings.bitcoin.adminToken) ||
        null,
      adminTokenFile: process.env.FABRIC_HUB_ADMIN_TOKEN_FILE ||
        (settings.bitcoin && settings.bitcoin.adminTokenFile) ||
        null
    }),
    documents: Object.assign({
      enable: false
    }, settings.documents || {}),
    settingsDir: appStoreRoot,
    // Cumulative Game.log history lives next to the Fabric store (userData),
    // not the repo tree — survives restarts and is the Analyze default.
    historyFile: path.join(appStoreRoot, 'history.json'),
    cursorsFile: path.join(appStoreRoot, 'log-cursors.json'),
    store: appStore, // shared, already-started Fabric Store
    fabricSignApprover: approveFabricSignRequest
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

/**
 * Native confirmation of a pairing code with Passport on this computer.
 * Lives in the main process so no web page — the dashboard included — can approve.
 * @param {object} prompt `{ kind: 'link', code, label, signer, expiresAt }`
 * @returns {Promise<boolean>}
 */
async function approveFabricSignRequest (prompt = {}) {
  const { fabricSignApprovalDialog } = require('./functions/fabricSignApprovalDialog');
  const built = fabricSignApprovalDialog(prompt, BRAND_NAME);
  if (!built) return false;
  const ms = Math.max(1000, Math.min(2 * 60 * 1000, Number(prompt.expiresAt || 0) - Date.now()));
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    const options = Object.assign(built, { signal: controller.signal });
    const parent = mainWindow && !mainWindow.isDestroyed() && mainWindow.isVisible() ? mainWindow : null;
    const { response } = parent
      ? await dialog.showMessageBox(parent, options)
      : await dialog.showMessageBox(options);
    return !controller.signal.aborted && response === 0;
  } catch (_) {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

function hideMainWindow () {
  if (!mainWindow) return;
  mainWindow.hide();
  if (process.platform === 'darwin' && app.dock) app.dock.hide();
}

function quitApp () {
  isQuitting = true;
  destroyOverlayWindow();
  app.quit();
}

function openAtLoginEnabled () {
  try {
    return !!app.getLoginItemSettings().openAtLogin;
  } catch (_) {
    return false;
  }
}

/**
 * Electron 44 dropped `openAsHidden`: macOS login launches are detected with
 * `wasOpenedAtLogin` (see `startHidden`), and `path` is only passed off macOS.
 */
function loginItemSettings (enable) {
  const out = { openAtLogin: enable, args: enable ? ['--hidden'] : [] };
  if (process.platform !== 'darwin') out.path = process.execPath;
  return out;
}

/** Enable launch at OS login for installed builds (and opt-in via settings). */
function configureAutoLaunch () {
  const persisted = settingsStore.loadSettings(appStore); // {} until the store opens
  const forceOff = process.env.SC_OPEN_AT_LOGIN === '0' || persisted.openAtLogin === false || settings.openAtLogin === false;
  const forceOn = process.env.SC_OPEN_AT_LOGIN === '1' || persisted.openAtLogin === true || settings.openAtLogin === true;
  const enable = forceOn || (!forceOff && app.isPackaged);

  try {
    app.setLoginItemSettings(loginItemSettings(enable));
    console.log('[ELECTRON]', '[STATUS]', `Open at login: ${enable ? 'on' : 'off'}`);
  } catch (error) {
    console.warn('[ELECTRON]', '[WARNING]', 'Could not set login item:', error.message || error);
  }
}

function setOpenAtLogin (enabled) {
  try {
    app.setLoginItemSettings(loginItemSettings(!!enabled));
  } catch (error) {
    console.warn('[ELECTRON]', '[WARNING]', 'Could not update login item:', error.message || error);
  }
  rebuildTrayMenu();
}

function rebuildTrayMenu () {
  if (!tray) return;
  const atLogin = openAtLoginEnabled();
  const overlayOn = !!(overlayWindow && !overlayWindow.isDestroyed() && overlayWindow.isVisible());
  const menu = Menu.buildFromTemplate([
    {
      label: `Show ${BRAND_NAME}`,
      click: () => showMainWindow()
    },
    {
      label: 'Primary group overlay',
      type: 'checkbox',
      checked: overlayOn,
      click: (item) => {
        void setGroupOverlayEnabled(item.checked);
      }
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
    if (!startHidden()) {
      mainWindow.show();
      if (isDev) mainWindow.focus();
    } else {
      console.log('[ELECTRON]', '[STATUS]', 'Started hidden (tray only)');
      if (process.platform === 'darwin' && app.dock) app.dock.hide();
    }
  });

  // If the page never becomes ready, still show unless we intentionally hid.
  setTimeout(() => {
    if (mainWindow && !mainWindow.isVisible() && !startHidden()) {
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

/**
 * Always-on-top, click-through HUD for the primary group's members + ships.
 * Positioned top-right of the primary display (Windows-first; works elsewhere).
 */
function createOverlayWindow (port) {
  if (overlayWindow && !overlayWindow.isDestroyed()) return overlayWindow;
  const { screen } = electron;
  const display = screen.getPrimaryDisplay();
  const work = display.workArea || display.bounds;
  const width = 340;
  const height = 520;
  const x = Math.max(work.x, work.x + work.width - width - 16);
  const y = work.y + 16;

  overlayWindow = new BrowserWindow({
    width,
    height,
    x,
    y,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    maximizable: false,
    minimizable: false,
    fullscreenable: false,
    hasShadow: false,
    focusable: false,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload-overlay.js'),
      nodeIntegration: false,
      contextIsolation: true,
      webSecurity: true
    }
  });

  // Let clicks fall through to the game (Windows: forward:true keeps hover).
  try {
    overlayWindow.setIgnoreMouseEvents(true, { forward: true });
  } catch (_) {
    try { overlayWindow.setIgnoreMouseEvents(true); } catch (__) { /* ignore */ }
  }
  if (typeof overlayWindow.setAlwaysOnTop === 'function') {
    // 'screen-saver' level helps stay above fullscreen games on Windows.
    try { overlayWindow.setAlwaysOnTop(true, 'screen-saver'); } catch (_) {
      overlayWindow.setAlwaysOnTop(true);
    }
  }
  if (process.platform === 'darwin' && typeof overlayWindow.setVisibleOnAllWorkspaces === 'function') {
    overlayWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  }

  const url = `http://127.0.0.1:${port}/overlay`;
  overlayWindow.loadURL(url).catch((err) => {
    console.error('[ELECTRON]', '[ERROR]', 'Failed to load group overlay:', err);
  });
  overlayWindow.once('ready-to-show', () => {
    if (overlayWindow && !overlayWindow.isDestroyed()) overlayWindow.showInactive();
  });
  overlayWindow.on('closed', () => {
    overlayWindow = null;
    rebuildTrayMenu();
  });
  return overlayWindow;
}

function destroyOverlayWindow () {
  if (overlayWindow && !overlayWindow.isDestroyed()) {
    try { overlayWindow.close(); } catch (_) { /* ignore */ }
  }
  overlayWindow = null;
}

/**
 * Enable/disable the primary-group overlay and persist `groupOverlay`.
 * @param {boolean} enabled
 */
async function setGroupOverlayEnabled (enabled) {
  const on = enabled === true;
  try {
    if (starCitizenService && starCitizenService.registerStore) {
      settingsStore.putSetting(starCitizenService.registerStore, 'groupOverlay', on);
      starCitizenService._groupOverlay = on;
    }
  } catch (e) {
    console.warn('[ELECTRON]', '[WARNING]', 'persist groupOverlay:', e && e.message ? e.message : e);
  }
  if (on) {
    if (activePort) createOverlayWindow(activePort);
  } else {
    destroyOverlayWindow();
  }
  rebuildTrayMenu();
  return { groupOverlay: on };
}

function syncOverlayFromSettings () {
  const enabled = !!(starCitizenService && starCitizenService._groupOverlay);
  if (enabled && activePort) createOverlayWindow(activePort);
  else destroyOverlayWindow();
  rebuildTrayMenu();
}

function sendVoicePtt (held) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.webContents.send('voice:ptt', !!held);
}

function syncVoicePttFromSettings (override) {
  const settings = override || (starCitizenService && starCitizenService._voiceSettings) ||
    groupVoiceSettings.defaultVoiceSettings();
  const sanitized = groupVoiceSettings.sanitizeVoiceSettings(settings);
  return voicePttGlobal.start({
    enabled: sanitized.mode === 'ptt',
    pttKey: sanitized.pttKey,
    globalShortcut,
    onHeld: sendVoicePtt,
    isRendererFocused: () => !!(mainWindow && !mainWindow.isDestroyed() && mainWindow.isFocused())
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
      loadEnvPublishingIdentity();
      applyIdentityToService();
      applySnapshotCaptureToService();
      const listening = new Promise((resolve) => {
        starCitizenService.once('listening', resolve);
      });
      const startP = starCitizenService.start();
      // Open HTTP (and the window) as soon as the dashboard port is bound —
      // do not wait for Game.log corpus ingest on machines with huge log trees.
      await Promise.race([listening, startP]);
      startP.catch((error) => {
        console.error('[ELECTRON]', '[ERROR]', 'Relay start after listen failed:', error);
      });

      // If we requested port 0, read the OS-assigned port from the server.
      const bound = starCitizenService.server && starCitizenService.server.address();
      activePort = (bound && bound.port) || opts.port || preferred;

      await waitForHttp(activePort);
      const bindHost = (bound && bound.address) || '127.0.0.1';
      const displayHost = (bindHost === '0.0.0.0' || bindHost === '::') ? '127.0.0.1' : bindHost;
      console.log('[ELECTRON]', '[STATUS]', `${BRAND_NAME} listening on http://${displayHost}:${activePort}/ (bind ${bindHost})`);
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

function registerFabricProtocol () {
  try {
    let ok = false;
    if (process.defaultApp) {
      if (process.argv.length >= 2) {
        const mainScript = path.resolve(process.argv[1]);
        ok = app.setAsDefaultProtocolClient(FABRIC_PROTOCOL, process.execPath, [mainScript]);
      } else {
        console.warn('[ELECTRON]', '[WARNING]', 'Cannot register fabric: — missing argv[1]');
      }
    } else {
      ok = app.setAsDefaultProtocolClient(FABRIC_PROTOCOL);
    }
    if (!ok) {
      console.warn('[ELECTRON]', '[WARNING]', 'setAsDefaultProtocolClient(fabric) returned false (another app may own fabric:)');
    } else {
      console.log('[ELECTRON]', '[STATUS]', 'Registered as fabric: protocol handler');
    }
  } catch (e) {
    console.warn('[ELECTRON]', '[WARNING]', 'setAsDefaultProtocolClient:', e && e.message ? e.message : e);
  }
}

function deliverDelegationInvitation (invitation) {
  pendingDelegationInvitation = { invitation, receivedAt: Date.now() };
  showMainWindow();
  const w = mainWindow && !mainWindow.isDestroyed() ? mainWindow : null;
  if (w && w.webContents) {
    const send = () => {
      if (!mainWindow || mainWindow.isDestroyed()) return;
      mainWindow.webContents.send('delegation-invitation', pendingDelegationInvitation);
    };
    if (w.webContents.isLoadingMainFrame && w.webContents.isLoadingMainFrame()) {
      w.webContents.once('did-finish-load', send);
    } else {
      send();
    }
  }
}

/**
 * Handle opaque fabric: frames: a signer invitation, or a group share.
 */
async function handleFabricProtocolUrl (urlStr) {
  const invitation = delegationInvitationFromUrl(urlStr);
  if (invitation) {
    deliverDelegationInvitation(invitation);
    return;
  }
  // Opaque AMP Message: fabric:<frame>
  try {
    const {
      parseOpaqueFabricMessage,
      classifyGroupShareMessage
    } = require('./functions/groupShareMessage');
    const opaque = parseOpaqueFabricMessage(urlStr);
    if (opaque.ok) {
      const classified = classifyGroupShareMessage(opaque.message);
      if (classified.kind === 'GroupOffer' || classified.kind === 'FederationContractInvite' || classified.kind === 'GroupPublish' || classified.kind === 'MissionBroadcast') {
        deliverGroupSharePrompt({
          kind: classified.kind,
          protocolUrl: opaque.protocolUrl,
          messageHex: opaque.hex,
          contractId: classified.contractId,
          groupId: classified.groupId,
          missionId: classified.missionId || null,
          offer: classified.kind === 'GroupOffer' ? classified.object : null,
          invite: classified.kind === 'FederationContractInvite' ? classified.object : null,
          mission: classified.kind === 'MissionBroadcast'
            ? ((classified.object && classified.object.mission) || classified.object)
            : null,
          group: classified.kind === 'GroupOffer' && classified.object && classified.object.meta
            ? { name: classified.object.meta.name, visibility: classified.object.meta.visibility }
            : null,
          identityLocked: !unlockedIdentity
        });
        return;
      }
      console.warn('[ELECTRON]', '[WARNING]', 'fabric: opaque message not a group share:', classified.kind);
      return;
    }
  } catch (e) {
    console.warn('[ELECTRON]', '[WARNING]', 'fabric: opaque parse:', e && e.message ? e.message : e);
  }

  console.warn('[ELECTRON]', '[WARNING]', 'fabric: url ignored');
}

function deliverGroupSharePrompt (payload) {
  if (!payload) return;
  pendingGroupSharePrompt = payload;
  showMainWindow();
  const w = mainWindow && !mainWindow.isDestroyed() ? mainWindow : null;
  if (w && w.webContents) {
    const send = () => {
      if (!mainWindow || mainWindow.isDestroyed()) return;
      mainWindow.webContents.send('fabric-group-share-prompt', payload);
    };
    if (w.webContents.isLoadingMainFrame && w.webContents.isLoadingMainFrame()) {
      w.webContents.once('did-finish-load', send);
    } else {
      send();
    }
  }
}

function drainArgvFabricUrl () {
  const arg = process.argv.find((a) => typeof a === 'string' && a.startsWith('fabric:'));
  if (arg) void handleFabricProtocolUrl(arg);
}

// macOS may deliver open-url before ready.
let earlyFabricUrl = null;
if (gotLock) {
  app.on('open-url', (event, url) => {
    event.preventDefault();
    if (app.isReady()) void handleFabricProtocolUrl(url);
    else earlyFabricUrl = url;
  });
}

if (gotLock) {
  app.whenReady().then(async () => {
    try {
      // Hide the native application / window menu bar (File, Edit, View…).
      Menu.setApplicationMenu(null);
      registerFabricProtocol();
      await openAppStore(); // settings come from the Fabric Store
      configureAutoLaunch();
      createTray();
      await startService();
      applyIdentityToService();
      applySnapshotCaptureToService();
      createWindow(activePort || servicePort());
      syncOverlayFromSettings();
      syncVoicePttFromSettings();
      if (earlyFabricUrl) {
        const u = earlyFabricUrl;
        earlyFabricUrl = null;
        void handleFabricProtocolUrl(u);
      } else {
        drainArgvFabricUrl();
      }
    } catch (error) {
      console.error('[ELECTRON]', '[ERROR]', 'Startup failed:', error);
      isQuitting = true;
      app.quit();
      return;
    }

    app.on('activate', () => {
      registerFabricProtocol();
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
    try { voicePttGlobal.stop(); } catch (_) { /* ignore */ }
    try { globalShortcut.unregisterAll(); } catch (_) { /* ignore */ }
    await stopService();
  });
}

ipcMain.handle('delegation-invitation:pull-pending', () => {
  const p = pendingDelegationInvitation;
  pendingDelegationInvitation = null;
  return p || null;
});

ipcMain.handle('fabric-group-share:pull-pending', () => {
  return pendingGroupSharePrompt || null;
});

ipcMain.handle('fabric-group-share:resolve', async (_e, { dismiss, approve } = {}) => {
  if (dismiss || approve != null) {
    pendingGroupSharePrompt = null;
  }
  return { ok: true };
});

// Passport v2 native sign-in to an allowlisted relay / Hub. The Bearer token
// goes back to the renderer's memory only; nothing stores it.
ipcMain.handle('identity:sign-in-relay', async (_e, { origin } = {}) => {
  if (!unlockedIdentity) return { error: 'Identity is locked — unlock it, then sign in.' };
  const allowed = assertAllowedFabricHub(String(origin || ''));
  if (!allowed.ok) return { error: allowed.error || 'That relay is not allowlisted.' };
  const result = await signInToRelay(unlockedIdentity, allowed.hubBase);
  if (!result.ok) return { error: result.error || 'Sign-in failed.' };
  armIdentityAutoLock();
  return { ok: true, token: result.token, session: result.session };
});

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

/** Env FABRIC_XPRV / FABRIC_SEED — GoonCitizen publishing identity (wins over UI unlock). */
let envPublishingIdentity = null;

function loadEnvPublishingIdentity () {
  loadRepoDotEnv();
  applyGoonCitizenEnvAliases(process.env);
  const { identity, updated, source } = applyFabricEnvConfig(process.env);
  envPublishingIdentity = identity;
  if (identity) {
    console.log('[ELECTRON]', '[STATUS]',
      `Publishing identity from ${source}: ${identity.pubkey.slice(0, 16)}…` +
      (updated ? ' (FABRIC_XPRV stamped)' : ''));
  }
  return identity;
}

/** Push publishing identity into the running relay (env > unlocked UI identity). */
function applyIdentityToService () {
  if (starCitizenService && typeof starCitizenService.setIdentity === 'function') {
    starCitizenService.setIdentity(envPublishingIdentity || unlockedIdentity, {
      unlockedPubkey: unlockedIdentity ? unlockedIdentity.pubkey : null
    });
    if (typeof starCitizenService.setLocalSigner === 'function') {
      starCitizenService.setLocalSigner(unlockedIdentity
        ? (proposal) => require('./functions/groupChangeProposal').signProposalVote(unlockedIdentity, proposal)
        : null);
    }
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
  const vault = identityLib.identityBlobSummary(blob);
  return Object.assign({
    exists: !!blob,
    legacy: !!blob && !vault,
    pubkey: null,
    account: null,
    network: null,
    label: null,
    wallet: null,
    cosigner: null,
    accounts: [],
    createdAt: null
  }, vault || {}, {
    unlocked: !!unlockedIdentity && !!vault,
    autoLockMinutes: identityAutoLockMinutes()
  });
}

ipcMain.handle('identity:get', () => identitySummary());

ipcMain.handle('identity:create', (_e, { password, passphrase, account, network } = {}) => {
  if (identityStore.hasIdentity(identityDir())) {
    return { error: 'An identity already exists. Restore or forget it first.' };
  }
  if (!password || password.length < 8) return { error: 'Password must be at least 8 characters.' };
  try {
    const identity = identityLib.createIdentity({ passphrase, account, network });
    const blob = identityLib.encryptIdentity(identity, password);
    identityStore.saveEncrypted(identityDir(), blob);
    const { mnemonic, ...unlocked } = identity;
    setUnlockedIdentity(unlocked);
    // The seed phrase is returned exactly once so the UI can show the backup step.
    return { pubkey: identity.pubkey, mnemonic };
  } catch (error) {
    return { error: error.message || String(error) };
  }
});

ipcMain.handle('identity:restore', (_e, { mnemonic, passphrase, xprv, password, account, network } = {}) => {
  if (!password || password.length < 8) return { error: 'Password must be at least 8 characters.' };
  if (identityStore.hasIdentity(identityDir())) {
    return { error: 'An identity already exists. Forget it first.' };
  }
  try {
    const identity = identityLib.restoreIdentity(xprv
      ? { xprv, account, network }
      : { mnemonic, passphrase, account, network });
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

ipcMain.handle('identity:lock', () => {
  lockIdentity();
  return { unlocked: false };
});

// Switch account / network. Locked, only pairs already in the vault can be
// picked; unlocked, any pair is derived and cached.
ipcMain.handle('identity:select-account', (_e, { account, network, label } = {}) => {
  const blob = identityStore.loadEncrypted(identityDir());
  if (!blob) return { error: 'No identity found.' };
  try {
    const result = identityLib.selectIdentityAccount(blob, { account, network, label }, unlockedIdentity);
    identityStore.saveEncrypted(identityDir(), result.blob);
    if (result.identity) setUnlockedIdentity(result.identity);
    else broadcastIdentityChanged();
    return identitySummary();
  } catch (error) {
    if (error && error.code === 'FABRIC_ACCOUNT_LOCKED') return { error: 'Unlock to add this account.' };
    return { error: error.message || String(error) };
  }
});

// Export the sealed vault as a portable backup file. Password is re-verified
// first; the file holds only the master xprv sealed with that password.
ipcMain.handle('identity:export-backup', (_e, { password } = {}) => {
  const blob = identityStore.loadEncrypted(identityDir());
  if (!blob) return { error: 'No identity found.' };
  try {
    identityLib.decryptIdentity(blob, password); // verify only
  } catch (error) {
    return { error: error.message === identityLib.LEGACY_BLOB_ERROR ? error.message : 'Incorrect password.' };
  }
  const summary = identityLib.identityBlobSummary(blob);
  return {
    filename: `gooncitizen-identity-${((summary && summary.pubkey) || 'backup').slice(0, 8)}.enc.json`,
    backup: { type: 'gooncitizen-identity-backup', v: 2, createdAt: new Date().toISOString(), vault: blob }
  };
});

// Import a backup file (the sealed vault above). Requires the backup's
// password; refuses to overwrite an existing identity unless `replace` is set.
ipcMain.handle('identity:import-backup', (_e, { backup, password, replace } = {}) => {
  const vault = backup && backup.type === 'gooncitizen-identity-backup' ? backup.vault : backup;
  if (!identityLib.isIdentityVault(vault)) {
    return { error: backup && (backup.ciphertext || (backup.vault == null && backup.version != null))
      ? identityLib.LEGACY_BLOB_ERROR
      : 'Not a GoonCitizen identity backup file.' };
  }
  if (identityStore.hasIdentity(identityDir()) && !replace) {
    return { error: 'An identity already exists. Check "replace" to overwrite it.' };
  }
  try {
    const identity = identityLib.decryptIdentity(vault, password);
    identityStore.saveEncrypted(identityDir(), vault);
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

ipcMain.handle('identity:open-protocol-url', async (_e, url) => {
  const raw = String(url || '').trim();
  if (!raw) return { error: 'empty url' };
  try {
    await handleFabricProtocolUrl(raw);
    return { ok: true };
  } catch (e) {
    return { error: (e && e.message) ? e.message : String(e) };
  }
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

/**
 * Fabric mesh helpers over in-process Peer (no LiveRelay HTTP).
 * Identity cluster snapshot (mutual identity grants) + delivery MessageReceipt.
 */
ipcMain.handle('fabric:identity-cluster', (_e, { pubkey } = {}) => {
  if (!starCitizenService) return { error: 'relay not ready' };
  const pk = pubkey || (starCitizenService._identity && starCitizenService._identity.pubkey) || null;
  const cluster = starCitizenService.identityCluster;
  const snap = cluster && typeof cluster.snapshot === 'function'
    ? cluster.snapshot(pk)
    : { canonical: pk, members: pk ? [pk] : [], edges: [] };
  return { data: snap, transport: 'fabric' };
});

ipcMain.handle('fabric:presence-status', () => {
  if (!starCitizenService || typeof starCitizenService.getPresenceStatus !== 'function') {
    return { error: 'relay not ready' };
  }
  try {
    return { data: starCitizenService.getPresenceStatus(), transport: 'fabric' };
  } catch (e) {
    return { error: e && e.message ? e.message : String(e) };
  }
});

ipcMain.handle('fabric:presence-roster', () => {
  if (!starCitizenService || typeof starCitizenService.getPresenceRoster !== 'function') {
    return { error: 'relay not ready' };
  }
  try {
    return { data: starCitizenService.getPresenceRoster(), transport: 'fabric' };
  } catch (e) {
    return { error: e && e.message ? e.message : String(e) };
  }
});

ipcMain.handle('fabric:presence-set', (_e, patch = {}) => {
  if (!starCitizenService || typeof starCitizenService.setPresenceSettings !== 'function') {
    return { error: 'relay not ready' };
  }
  try {
    return { data: starCitizenService.setPresenceSettings(patch || {}), transport: 'fabric' };
  } catch (e) {
    return { error: e && e.message ? e.message : String(e) };
  }
});

ipcMain.handle('fabric:presence-ship', (_e, opts = {}) => {
  if (!starCitizenService || typeof starCitizenService.setShipOverride !== 'function') {
    return { error: 'relay not ready' };
  }
  try {
    const presence = require('./functions/presence');
    let slug = null;
    if (opts.autodetect === true) slug = null;
    else if (opts.clear === true || presence.isShipClearedSlug(opts.slug)) {
      slug = presence.SHIP_NONE_SLUG;
    } else if (opts.slug !== undefined) slug = opts.slug;
    return { data: starCitizenService.setShipOverride(slug), transport: 'fabric' };
  } catch (e) {
    return { error: e && e.message ? e.message : String(e) };
  }
});

ipcMain.handle('fabric:delivery-receipt', (_e, opts = {}) => {
  if (!starCitizenService || typeof starCitizenService._markDeliveryReceipt !== 'function') {
    return { error: 'relay not ready' };
  }
  const wireHash = opts.wireHash || opts.hash;
  if (!wireHash) return { error: 'wireHash required' };
  try {
    const data = starCitizenService._markDeliveryReceipt(String(wireHash), {
      contractId: opts.contractId || null,
      chatMessageId: opts.chatMessageId || null
    });
    return { data };
  } catch (e) {
    return {
      error: e && e.message ? e.message : String(e),
      code: e && e.code ? e.code : null
    };
  }
});

ipcMain.handle('set-open-at-login', (_e, enabled) => {
  setOpenAtLogin(!!enabled);
  return { openAtLogin: openAtLoginEnabled() };
});

ipcMain.handle('set-group-overlay', async (_e, enabled) => {
  return setGroupOverlayEnabled(!!enabled);
});

ipcMain.on('overlay:ignore-mouse', (event, ignore) => {
  if (!overlayWindow || overlayWindow.isDestroyed()) return;
  if (event.sender !== overlayWindow.webContents) return;
  try {
    if (ignore) overlayWindow.setIgnoreMouseEvents(true, { forward: true });
    else overlayWindow.setIgnoreMouseEvents(false);
  } catch (_) { /* ignore */ }
});

ipcMain.handle('get-group-overlay', () => {
  return {
    groupOverlay: !!(overlayWindow && !overlayWindow.isDestroyed() && overlayWindow.isVisible()),
    primaryGroupId: (starCitizenService && starCitizenService._primaryGroupId) || null,
    platform: process.platform
  };
});

ipcMain.handle('voice:set-ptt-bind', (_e, payload) => {
  const src = payload && typeof payload === 'object' && !Array.isArray(payload)
    ? payload
    : { enabled: true, pttKey: { code: String(payload || 'Shift+Tab') } };
  return syncVoicePttFromSettings({
    mode: src.enabled === false ? 'vad' : 'ptt',
    pttKey: src.pttKey || src
  });
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

// --- Filesystem pickers (Feed log import / Settings Game.log path) ---------

ipcMain.handle('dialog:openDirectory', async () => {
  const win = BrowserWindow.getFocusedWindow() || mainWindow;
  const result = await dialog.showOpenDialog(win || undefined, {
    title: 'Import log folder',
    properties: ['openDirectory', 'multiSelections'],
    message: 'Choose folders that contain Star Citizen Game.log / logbackup files'
  });
  if (result.canceled || !result.filePaths || !result.filePaths.length) {
    return { canceled: true, paths: [] };
  }
  return { canceled: false, paths: result.filePaths };
});

ipcMain.handle('dialog:openLogFiles', async () => {
  const win = BrowserWindow.getFocusedWindow() || mainWindow;
  const result = await dialog.showOpenDialog(win || undefined, {
    title: 'Import log files',
    properties: ['openFile', 'multiSelections'],
    filters: [
      { name: 'Star Citizen logs', extensions: ['log'] },
      { name: 'All files', extensions: ['*'] }
    ],
    message: 'Choose one or more .log files to import'
  });
  if (result.canceled || !result.filePaths || !result.filePaths.length) {
    return { canceled: true, paths: [] };
  }
  return { canceled: false, paths: result.filePaths };
});

ipcMain.handle('dialog:openLogFile', async () => {
  const win = BrowserWindow.getFocusedWindow() || mainWindow;
  const result = await dialog.showOpenDialog(win || undefined, {
    title: 'Select Game.log',
    properties: ['openFile'],
    filters: [
      { name: 'Star Citizen logs', extensions: ['log'] },
      { name: 'All files', extensions: ['*'] }
    ],
    message: 'Choose the live Game.log to tail'
  });
  if (result.canceled || !result.filePaths || !result.filePaths.length) {
    return { canceled: true, path: null };
  }
  return { canceled: false, path: result.filePaths[0] };
});

ipcMain.handle('dialog:openFleetJson', async () => {
  const win = BrowserWindow.getFocusedWindow() || mainWindow;
  const result = await dialog.showOpenDialog(win || undefined, {
    title: 'Import Starjump / FleetViewer export',
    properties: ['openFile'],
    filters: [
      { name: 'Fleet JSON', extensions: ['json'] },
      { name: 'All files', extensions: ['*'] }
    ],
    message: 'Choose a Starjump or FleetViewer JSON export'
  });
  if (result.canceled || !result.filePaths || !result.filePaths.length) {
    return { canceled: true, path: null };
  }
  return { canceled: false, path: result.filePaths[0] };
});

process.on('uncaughtException', (error) => {
  console.error('[ELECTRON]', '[ERROR]', 'Uncaught exception:', error);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('[ELECTRON]', '[ERROR]', 'Unhandled rejection at:', promise, 'reason:', reason);
});
