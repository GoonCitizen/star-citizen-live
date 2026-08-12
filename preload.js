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
  setGroupOverlay: (enabled) => ipcRenderer.invoke('set-group-overlay', enabled),
  getGroupOverlay: () => ipcRenderer.invoke('get-group-overlay'),
  identity: {
    get: () => ipcRenderer.invoke('identity:get'),
    create: (password) => ipcRenderer.invoke('identity:create', { password }),
    restore: (opts) => ipcRenderer.invoke('identity:restore', opts),
    unlock: (password) => ipcRenderer.invoke('identity:unlock', { password }),
    signEnvelope: (payload) => ipcRenderer.invoke('identity:sign-envelope', payload),
    signMessage: (message) => ipcRenderer.invoke('identity:sign-message', { message }),
    lock: () => ipcRenderer.invoke('identity:lock'),
    reveal: (password) => ipcRenderer.invoke('identity:reveal', { password }),
    exportBackup: (password) => ipcRenderer.invoke('identity:export-backup', { password }),
    importBackup: (backup, password, replace) => ipcRenderer.invoke('identity:import-backup', { backup, password, replace }),
    setAutoLock: (minutes) => ipcRenderer.invoke('identity:set-autolock', { minutes }),
    forget: (confirm) => ipcRenderer.invoke('identity:forget', { confirm: !!confirm }),
    onChanged: (handler) => {
      const listener = (_e, summary) => handler(summary);
      ipcRenderer.on('identity:changed', listener);
      return () => ipcRenderer.removeListener('identity:changed', listener);
    }
  },
  /** Fabric mesh publish helpers (prefer over HTTP when available). */
  fabric: {
    deliveryReceipt: (opts) => ipcRenderer.invoke('fabric:delivery-receipt', opts || {})
  },
  notify: (payload) => ipcRenderer.invoke('notify:show', payload || {}),
  onNotifyAction: (handler) => {
    const listener = (_e, data) => handler(data);
    ipcRenderer.on('notify:action', listener);
    return () => ipcRenderer.removeListener('notify:action', listener);
  },
  onNotifyClick: (handler) => {
    const listener = (_e, data) => handler(data);
    ipcRenderer.on('notify:click', listener);
    return () => ipcRenderer.removeListener('notify:click', listener);
  },
  /** Client-signed Fabric site login (`fabric://login`) — approve/reject in the renderer. */
  fabricLogin: {
    onPrompt: (handler) => {
      const listener = (_e, payload) => handler(payload);
      ipcRenderer.on('fabric-login-prompt', listener);
      return () => ipcRenderer.removeListener('fabric-login-prompt', listener);
    },
    pullPending: () => ipcRenderer.invoke('fabric-login:pull-pending'),
    resolve: (opts) => ipcRenderer.invoke('fabric-login:resolve', opts || {})
  },
  /** Opaque fabric:<hex> GroupOffer / FederationContractInvite. */
  groupShare: {
    onPrompt: (handler) => {
      const listener = (_e, payload) => handler(payload);
      ipcRenderer.on('fabric-group-share-prompt', listener);
      return () => ipcRenderer.removeListener('fabric-group-share-prompt', listener);
    },
    pullPending: () => ipcRenderer.invoke('fabric-group-share:pull-pending'),
    resolve: (opts) => ipcRenderer.invoke('fabric-group-share:resolve', opts || {})
  },
  /** Native OS pickers for importing log folders/files / selecting Game.log. */
  dialog: {
    openDirectory: () => ipcRenderer.invoke('dialog:openDirectory'),
    openLogFiles: () => ipcRenderer.invoke('dialog:openLogFiles'),
    openLogFile: () => ipcRenderer.invoke('dialog:openLogFile'),
    openFleetJson: () => ipcRenderer.invoke('dialog:openFleetJson')
  },
  platform: process.platform,
  versions: {
    node: process.versions.node,
    chrome: process.versions.chrome,
    electron: process.versions.electron
  }
});
