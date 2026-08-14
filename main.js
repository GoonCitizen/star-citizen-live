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

const { app, BrowserWindow, Tray, Menu, nativeImage, ipcMain, shell, Notification, dialog } = electron;
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
const { FABRIC_PROTOCOL, parseFabricLoginUrl } = require('./functions/fabricProtocolLogin');
const { parseFabricDeviceLinkUrl } = require('./functions/fabricDeviceLinkProtocol');
const {
  fetchPendingLoginSession,
  completeClientSignedLogin
} = require('./functions/fabricLoginClient');
const {
  fetchPendingDeviceLink,
  completeDeviceLinkAsResponder
} = require('./functions/fabricDeviceLinkClient');
const { applyFabricEnvConfig, loadRepoDotEnv } = require('./functions/fabricEnvIdentity');
const { applyGoonCitizenEnvAliases } = require('./functions/goonCitizenEnvAliases');

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
/** Pending fabric://login prompt for the renderer (or queued before window ready). */
let pendingFabricLoginPrompt = null;
/** In-flight login prompts keyed by sessionId (message retained for sign). */
const fabricLoginBySession = new Map();
/** Pending opaque fabric: group share prompt. */
let pendingGroupSharePrompt = null;

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

/**
 * Always-on-top, click-through HUD for the primary group's members + ships.
 * Positioned top-right of the primary display (Windows-first; works elsewhere).
 */
function createOverlayWindow (port) {
  if (overlayWindow && !overlayWindow.isDestroyed()) return overlayWindow;
  const { screen } = electron;
  const display = screen.getPrimaryDisplay();
  const work = display.workArea || display.bounds;
  const width = 300;
  const height = 420;
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
      loadEnvPublishingIdentity();
      applyIdentityToService();

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

function deliverFabricLoginPrompt (payload) {
  if (!payload) return;
  pendingFabricLoginPrompt = payload;
  fabricLoginBySession.set(String(payload.sessionId), payload);
  showMainWindow();
  const w = mainWindow && !mainWindow.isDestroyed() ? mainWindow : null;
  if (w && w.webContents) {
    const send = () => {
      if (!mainWindow || mainWindow.isDestroyed()) return;
      mainWindow.webContents.send('fabric-login-prompt', payload);
    };
    // Avoid dropping the IPC if the dashboard has not finished loading yet.
    if (w.webContents.isLoadingMainFrame && w.webContents.isLoadingMainFrame()) {
      w.webContents.once('did-finish-load', send);
    } else {
      send();
    }
  }
}

/**
 * Persist a mutual device-link peer on the Fabric Store (non-secret metadata).
 */
function mergeLinkedDeviceLocal (entry) {
  if (!appStore || !entry || !entry.peerFabricId) return;
  try {
    const { mergeLinkedDevice } = require('./functions/linkedDevices');
    const cur = settingsStore.loadSettings(appStore);
    const list = mergeLinkedDevice(cur.linkedDevices, entry);
    settingsStore.putSetting(appStore, 'linkedDevices', list);
  } catch (e) {
    console.warn('[ELECTRON]', '[WARNING]', 'linkedDevices persist:', e && e.message ? e.message : e);
  }
}

/**
 * Handle fabric://login, fabric://link, or opaque fabric: group shares.
 */
async function handleFabricProtocolUrl (urlStr) {
  const linkParsed = parseFabricDeviceLinkUrl(urlStr);
  if (linkParsed.ok) {
    await handleFabricDeviceLinkUrl(linkParsed);
    return;
  }
  const parsed = parseFabricLoginUrl(urlStr);
  if (parsed.ok) {
    const { sessionId, hubBase } = parsed;
    try {
      const pending = await fetchPendingLoginSession(hubBase, sessionId);
      if (!pending.ok) {
        console.error('[ELECTRON]', '[ERROR]', 'fabric login session:', pending.error);
        deliverFabricLoginPrompt({
          kind: 'login',
          sessionId,
          hubBase,
          origin: hubBase,
          message: '',
          nonce: '',
          identityLocked: !unlockedIdentity,
          error: pending.error
        });
        return;
      }
      deliverFabricLoginPrompt({
        kind: 'login',
        sessionId,
        hubBase,
        origin: pending.origin || hubBase,
        message: pending.message,
        nonce: pending.nonce || '',
        identityLocked: !unlockedIdentity
      });
      console.log('[ELECTRON]', '[STATUS]', 'fabric login prompt delivered:', sessionId.slice(0, 12) + '…');
    } catch (e) {
      console.error('[ELECTRON]', '[ERROR]', 'fabric login:', e && e.message ? e.message : e);
    }
    return;
  }

  // Opaque AMP Message: fabric:<hex|base64>
  try {
    const {
      parseOpaqueFabricMessage,
      classifyGroupShareMessage
    } = require('./functions/groupShareMessage');
    const opaque = parseOpaqueFabricMessage(urlStr);
    if (opaque.ok) {
      const classified = classifyGroupShareMessage(opaque.message);
      if (classified.kind === 'GroupOffer' || classified.kind === 'FederationContractInvite' || classified.kind === 'GroupPublish') {
        deliverGroupSharePrompt({
          kind: classified.kind,
          protocolUrl: urlStr.startsWith('fabric:') ? urlStr.trim() : ('fabric:' + opaque.hex),
          messageHex: opaque.hex,
          messageBase64: opaque.base64 || null,
          contractId: classified.contractId,
          groupId: classified.groupId,
          offer: classified.kind === 'GroupOffer' ? classified.object : null,
          invite: classified.kind === 'FederationContractInvite' ? classified.object : null,
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

  console.warn('[ELECTRON]', '[WARNING]', 'fabric: url ignored:', parsed.error || linkParsed.error);
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

/**
 * Responder path: fabric://link?sessionId=…&hub=…
 */
async function handleFabricDeviceLinkUrl (parsed) {
  const { sessionId, hubBase } = parsed;
  try {
    const pending = await fetchPendingDeviceLink(hubBase, sessionId);
    if (!pending.ok) {
      console.error('[ELECTRON]', '[ERROR]', 'fabric device-link session:', pending.error);
      deliverFabricLoginPrompt({
        kind: 'device-link',
        sessionId,
        hubBase,
        origin: hubBase,
        label: '',
        initiator: null,
        identityLocked: !unlockedIdentity,
        error: pending.error
      });
      return;
    }
    if (pending.status !== 'pending') {
      deliverFabricLoginPrompt({
        kind: 'device-link',
        sessionId,
        hubBase,
        origin: pending.origin || hubBase,
        label: pending.label || '',
        initiator: pending.initiator || null,
        identityLocked: !unlockedIdentity,
        error: pending.status === 'linked'
          ? 'This link is already complete.'
          : `Device link status is ${pending.status || 'unknown'} — expected pending.`
      });
      return;
    }
    deliverFabricLoginPrompt({
      kind: 'device-link',
      sessionId,
      hubBase,
      origin: pending.origin || hubBase,
      label: pending.label || '',
      nonce: pending.nonce || '',
      initiator: pending.initiator || null,
      identityLocked: !unlockedIdentity
    });
    console.log('[ELECTRON]', '[STATUS]', 'fabric device-link prompt delivered:', sessionId.slice(0, 12) + '…');
  } catch (e) {
    console.error('[ELECTRON]', '[ERROR]', 'fabric device-link:', e && e.message ? e.message : e);
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
    await stopService();
  });
}

ipcMain.handle('fabric-login:pull-pending', () => {
  const p = pendingFabricLoginPrompt;
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

ipcMain.handle('fabric-login:resolve', async (_e, { approve, sessionId } = {}) => {
  const sid = sessionId != null ? String(sessionId).trim() : '';
  const prompt = (sid && fabricLoginBySession.get(sid)) || pendingFabricLoginPrompt;
  if (!prompt || !prompt.sessionId) return { error: 'No pending request.' };
  if (sid && String(prompt.sessionId) !== sid) return { error: 'Session mismatch.' };

  const clearPrompt = () => {
    fabricLoginBySession.delete(String(prompt.sessionId));
    if (pendingFabricLoginPrompt && String(pendingFabricLoginPrompt.sessionId) === String(prompt.sessionId)) {
      pendingFabricLoginPrompt = null;
    }
  };

  if (!approve) {
    clearPrompt();
    return { ok: true, approved: false };
  }

  if (!unlockedIdentity) {
    return { error: 'Identity is locked — unlock it, then try the link again.' };
  }

  if (prompt.kind === 'device-link') {
    if (prompt.error && !prompt.initiator) {
      return { error: prompt.error };
    }
    const result = await completeDeviceLinkAsResponder(
      unlockedIdentity,
      prompt.hubBase,
      {
        sessionId: prompt.sessionId,
        status: 'pending',
        nonce: prompt.nonce,
        label: prompt.label,
        initiator: prompt.initiator
      }
    );
    if (!result.ok) return { error: result.error || 'Device link failed.' };
    const peerPk = (prompt.initiator && prompt.initiator.pubkeyHex) || result.peerPubkeyHex;
    mergeLinkedDeviceLocal({
      kind: 'device-link',
      peerFabricId: result.peerFabricId || (prompt.initiator && prompt.initiator.id),
      peerXpub: result.peerXpub || (prompt.initiator && prompt.initiator.xpub),
      peerPubkey: peerPk,
      nonce: prompt.nonce || null,
      label: result.label || prompt.label || 'Linked device',
      hubOrigin: prompt.origin || prompt.hubBase,
      role: 'responder'
    });
    if (starCitizenService && peerPk && prompt.nonce &&
      typeof starCitizenService.publishLocalIdentityCrossSign === 'function') {
      void starCitizenService.publishLocalIdentityCrossSign({
        peerPubkey: peerPk,
        nonce: prompt.nonce
      }).catch((e) => {
        console.warn('[ELECTRON]', '[WARNING]', 'IdentityCrossSign:', e && e.message ? e.message : e);
      });
    }
    armIdentityAutoLock();
    clearPrompt();
    return { ok: true, approved: true, kind: 'device-link', status: result.status };
  }

  if (!prompt.message) {
    return { error: prompt.error || 'No challenge message to sign.' };
  }

  const result = await completeClientSignedLogin(
    unlockedIdentity,
    prompt.hubBase,
    prompt.sessionId,
    prompt.message
  );
  if (!result.ok) return { error: result.error || 'Sign-in failed.' };

  armIdentityAutoLock();
  clearPrompt();
  return { ok: true, approved: true, identity: result.identity, signer: result.signer };
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
    starCitizenService.setIdentity(envPublishingIdentity || unlockedIdentity);
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

let pendingDeviceLinkOffer = null;

ipcMain.handle('identity:device-link-start', async (_e, { hubBase, label } = {}) => {
  if (!unlockedIdentity) return { error: 'Identity is locked — unlock it, then add a device.' };
  const { startDeviceLinkOffer } = require('./functions/fabricDeviceLinkOffer');
  const res = await startDeviceLinkOffer(unlockedIdentity, {
    hubBase,
    label: label || 'GoonCitizen desktop'
  });
  if (!res.ok) return { error: res.error || 'Could not create device-link offer' };
  pendingDeviceLinkOffer = res;
  armIdentityAutoLock();
  return res;
});

ipcMain.handle('identity:device-link-tick', async () => {
  if (!unlockedIdentity) return { error: 'Identity is locked' };
  if (!pendingDeviceLinkOffer) return { error: 'no pending device-link offer' };
  const { tickDeviceLinkOffer } = require('./functions/fabricDeviceLinkOffer');
  const res = await tickDeviceLinkOffer(unlockedIdentity, pendingDeviceLinkOffer);
  if (!res.ok) return res;
  if (res.status === 'linked') {
    pendingDeviceLinkOffer = null;
    mergeLinkedDeviceLocal({
      kind: 'device-link',
      peerFabricId: res.peerFabricId,
      peerXpub: res.peerXpub,
      peerPubkey: res.peerPubkey,
      nonce: res.nonce,
      label: res.label || 'Linked device',
      hubOrigin: res.hubBase,
      role: 'initiator'
    });
    if (starCitizenService && res.peerPubkey && res.nonce &&
      typeof starCitizenService.publishLocalIdentityCrossSign === 'function') {
      void starCitizenService.publishLocalIdentityCrossSign({
        peerPubkey: res.peerPubkey,
        nonce: res.nonce
      }).catch((e) => {
        console.warn('[ELECTRON]', '[WARNING]', 'IdentityCrossSign:', e && e.message ? e.message : e);
      });
    }
    armIdentityAutoLock();
  }
  return res;
});

ipcMain.handle('identity:device-link-cancel', () => {
  pendingDeviceLinkOffer = null;
  return { ok: true };
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
 * Delivery sync receipt over in-process Fabric (no HTTP).
 * Publishes MessageReceipt CONTRACT_MESSAGE via the local peer.
 */
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

ipcMain.handle('get-group-overlay', () => {
  return {
    groupOverlay: !!(overlayWindow && !overlayWindow.isDestroyed() && overlayWindow.isVisible()),
    primaryGroupId: (starCitizenService && starCitizenService._primaryGroupId) || null,
    platform: process.platform
  };
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
