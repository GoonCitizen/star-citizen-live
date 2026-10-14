'use strict';

/**
 * Preload for the always-on-top primary-group overlay.
 * The HUD is click-through except the top-right on/off control.
 */

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('overlayAPI', {
  setEnabled: (enabled) => ipcRenderer.invoke('set-group-overlay', !!enabled),
  setIgnoreMouse: (ignore) => ipcRenderer.send('overlay:ignore-mouse', ignore !== false)
});
