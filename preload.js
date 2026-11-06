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
    create: (password, opts) => ipcRenderer.invoke('identity:create', Object.assign({}, opts || {}, { password })),
    restore: (opts) => ipcRenderer.invoke('identity:restore', opts),
    unlock: (password) => ipcRenderer.invoke('identity:unlock', { password }),
    selectAccount: (pair) => ipcRenderer.invoke('identity:select-account', pair || {}),
    signEnvelope: (payload) => ipcRenderer.invoke('identity:sign-envelope', payload),
    lock: () => ipcRenderer.invoke('identity:lock'),
    exportBackup: (password) => ipcRenderer.invoke('identity:export-backup', { password }),
    importBackup: (backup, password, replace) => ipcRenderer.invoke('identity:import-backup', { backup, password, replace }),
    setAutoLock: (minutes) => ipcRenderer.invoke('identity:set-autolock', { minutes }),
    forget: (confirm) => ipcRenderer.invoke('identity:forget', { confirm: !!confirm }),
    openProtocolUrl: (url) => ipcRenderer.invoke('identity:open-protocol-url', url),
    signInToRelay: (origin) => ipcRenderer.invoke('identity:sign-in-relay', { origin }),
    /** Peer session (Passport v3): sign in to the relay by its key; the session stays in the main process. */
    signInToRelayPeer: (origin) => ipcRenderer.invoke('identity:sign-in-relay-peer', { origin }),
    /** `X-Fabric-Request` for one request to a relay signed in with `signInToRelayPeer`. */
    authorizeRelayRequest: (request) => ipcRenderer.invoke('identity:authorize-relay-request', request || {}),
    onChanged: (handler) => {
      const listener = (_e, summary) => handler(summary);
      ipcRenderer.on('identity:changed', listener);
      return () => ipcRenderer.removeListener('identity:changed', listener);
    }
  },
  /** Fabric mesh publish helpers (prefer over HTTP when available). */
  fabric: {
    deliveryReceipt: (opts) => ipcRenderer.invoke('fabric:delivery-receipt', opts || {}),
    identityCluster: (opts) => ipcRenderer.invoke('fabric:identity-cluster', opts || {}),
    presenceStatus: () => ipcRenderer.invoke('fabric:presence-status'),
    presenceRoster: () => ipcRenderer.invoke('fabric:presence-roster'),
    setPresence: (patch) => ipcRenderer.invoke('fabric:presence-set', patch || {}),
    setPresenceShip: (opts) => ipcRenderer.invoke('fabric:presence-ship', opts || {})
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
  /** A signer invitation (`fabric:` link offer) opened in this app — shown on Linked signers. */
  delegationInvitation: {
    onInvitation: (handler) => {
      const listener = (_e, payload) => handler(payload);
      ipcRenderer.on('delegation-invitation', listener);
      return () => ipcRenderer.removeListener('delegation-invitation', listener);
    },
    pullPending: () => ipcRenderer.invoke('delegation-invitation:pull-pending')
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
  /** Group voice PTT — OS key-state poll so hold works while the game is focused. */
  voice: {
    setPttBind: (bind) => ipcRenderer.invoke('voice:set-ptt-bind', bind || {}),
    onPtt: (handler) => {
      const listener = (_e, held) => handler(held);
      ipcRenderer.on('voice:ptt', listener);
      return () => ipcRenderer.removeListener('voice:ptt', listener);
    }
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
