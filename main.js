'use strict';

// Electron
const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');

// Settings
let settings = {};
try {
  settings = require('./settings/local');
} catch (error) {
  console.warn('[ELECTRON]', '[WARNING]', 'settings/local.js not found, using defaults');
  settings = {
    http: {
      port: 3041
    }
  };
}

// Services
const StarCitizen = require('./services/StarCitizen');

// Global references
let mainWindow = null;
let starCitizenService = null;

/**
 * Create the main application window
 */
function createWindow() {
  // Create the browser window
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
      webSecurity: true
    },
    icon: path.join(__dirname, 'assets', 'icon.png'),
    show: false // Don't show until ready
  });

  // Load the application
  const isDev = process.argv.includes('--dev');

  if (isDev) {
    // In development, load from local server
    mainWindow.loadURL(`http://localhost:${settings.http?.port || 3041}`);
    // Open DevTools in development
    mainWindow.webContents.openDevTools();
  } else {
    // In production, try to load from built HTML or local server
    const indexPath = path.join(__dirname, 'assets', 'index.html');
    const fs = require('fs');

    if (fs.existsSync(indexPath)) {
      mainWindow.loadFile(indexPath);
    } else {
      // Fallback to local server
      mainWindow.loadURL(`http://localhost:${settings.http?.port || 3041}`);
    }
  }

  // Show window when ready
  mainWindow.once('ready-to-show', () => {
    mainWindow.show();

    // Focus the window
    if (isDev) {
      mainWindow.focus();
    }
  });

  // Handle window closed
  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  // Handle navigation
  mainWindow.webContents.on('will-navigate', (event, navigationUrl) => {
    const parsedUrl = new URL(navigationUrl);

    // Prevent navigation to external URLs
    if (parsedUrl.origin !== `http://localhost:${settings.http?.port || 3041}` &&
        !parsedUrl.protocol.startsWith('file:')) {
      event.preventDefault();
    }
  });

  // Handle external links
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    require('electron').shell.openExternal(url);
    return { action: 'deny' };
  });
}

/**
 * Start the Star Citizen service
 */
async function startService() {
  try {
    console.log('[ELECTRON]', '[STATUS]', 'Starting Star Citizen service...');

    starCitizenService = new StarCitizen(settings);
    await starCitizenService.start();

    console.log('[ELECTRON]', '[STATUS]', 'Star Citizen service started');
    console.log('[ELECTRON]', '[STATUS]', `Service running on port ${starCitizenService.settings.http?.port || 3041}`);

    return starCitizenService;
  } catch (error) {
    console.error('[ELECTRON]', '[ERROR]', 'Failed to start Star Citizen service:', error);
    throw error;
  }
}

/**
 * Stop the Star Citizen service
 */
async function stopService() {
  if (starCitizenService) {
    try {
      console.log('[ELECTRON]', '[STATUS]', 'Stopping Star Citizen service...');
      await starCitizenService.stop();
      starCitizenService = null;
      console.log('[ELECTRON]', '[STATUS]', 'Star Citizen service stopped');
    } catch (error) {
      console.error('[ELECTRON]', '[ERROR]', 'Error stopping service:', error);
    }
  }
}

// App event handlers
app.whenReady().then(async () => {
  // Start the service first
  await startService();

  // Wait a moment for the server to be ready
  await new Promise(resolve => setTimeout(resolve, 1000));

  // Create the window
  createWindow();

  app.on('activate', () => {
    // On macOS, re-create window when dock icon is clicked
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', async () => {
  // Stop the service when all windows are closed
  await stopService();

  // On macOS, keep app running even when all windows are closed
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', async () => {
  // Stop the service before quitting
  await stopService();
});

// Handle IPC messages from renderer
ipcMain.handle('get-service-status', () => {
  if (starCitizenService) {
    return {
      status: starCitizenService.settings.state?.status || 'UNKNOWN',
      port: starCitizenService.settings.http?.port || 3041
    };
  }
  return { status: 'STOPPED', port: null };
});

ipcMain.handle('restart-service', async () => {
  await stopService();
  await startService();
  return { success: true };
});

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
  console.error('[ELECTRON]', '[ERROR]', 'Uncaught exception:', error);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('[ELECTRON]', '[ERROR]', 'Unhandled rejection at:', promise, 'reason:', reason);
});
