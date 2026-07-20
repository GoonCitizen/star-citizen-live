'use strict';

// Preload script for Electron
// This runs in a context that has access to Node.js APIs
// but is isolated from the renderer process

const { contextBridge, ipcRenderer } = require('electron');

// Expose protected methods that allow the renderer process to use
// the ipcRenderer without exposing the entire object
contextBridge.exposeInMainWorld('electronAPI', {
  getServiceStatus: () => ipcRenderer.invoke('get-service-status'),
  restartService: () => ipcRenderer.invoke('restart-service'),
  setOpenAtLogin: (enabled) => ipcRenderer.invoke('set-open-at-login', enabled),
  identity: {
    get: () => ipcRenderer.invoke('identity:get'),
    create: (password) => ipcRenderer.invoke('identity:create', { password }),
    restore: (opts) => ipcRenderer.invoke('identity:restore', opts),
    unlock: (password) => ipcRenderer.invoke('identity:unlock', { password }),
    signEnvelope: (payload) => ipcRenderer.invoke('identity:sign-envelope', payload),
    lock: () => ipcRenderer.invoke('identity:lock'),
    forget: () => ipcRenderer.invoke('identity:forget')
  },
  platform: process.platform,
  versions: {
    node: process.versions.node,
    chrome: process.versions.chrome,
    electron: process.versions.electron
  }
});
