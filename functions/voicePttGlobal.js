'use strict';

/**
 * Global push-to-talk while another app (the game) is focused.
 * Electron globalShortcut only fires on press, so we poll OS key state:
 * macOS CGEventSourceKeyState (python ctypes), Windows GetAsyncKeyState.
 * Shortcut registration remains a fallback (tap to talk).
 */

const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const groupVoiceSettings = require('./groupVoiceSettings');
const { pollSpec } = require('./voicePttOsKeys');

let child = null;
let shortcutAccel = null;
let lastHeld = false;
let onHeld = null;
let isRendererFocused = null;
let globalShortcut = null;
let generation = 0;
let stopping = false;

function emit (held) {
  const next = !!held;
  if (next === lastHeld) return;
  lastHeld = next;
  if (typeof onHeld === 'function') onHeld(next);
}

function stopChild () {
  if (!child) return;
  try { child.kill(); } catch (_) { /* ignore */ }
  child = null;
}

function stopShortcut () {
  if (!globalShortcut || typeof globalShortcut.unregisterAll !== 'function') return;
  try { globalShortcut.unregisterAll(); } catch (_) { /* ignore */ }
  shortcutAccel = null;
}

function stop () {
  stopping = true;
  generation += 1;
  stopChild();
  stopShortcut();
  lastHeld = false;
}

function csv (codes) {
  return (codes || []).join(',');
}

function attachStdout (proc, bind, gen) {
  let buf = '';
  proc.stdout.on('data', (chunk) => {
    buf += String(chunk);
    let idx;
    while ((idx = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, idx).trim();
      buf = buf.slice(idx + 1);
      if (line === '1') emit(true);
      else if (line === '0') emit(false);
    }
  });
  const fail = () => {
    if (stopping || gen !== generation) return;
    if (child === proc) child = null;
    if (!shortcutAccel) startShortcut(bind);
  };
  proc.on('exit', fail);
  proc.on('error', fail);
}

function materializeScript (name) {
  const src = path.join(__dirname, name);
  const dest = path.join(os.tmpdir(), 'gooncitizen-' + name);
  fs.copyFileSync(src, dest);
  return dest;
}

function startDarwin (spec, bind, gen) {
  const py = process.env.FABRIC_PYTHON || '/usr/bin/python3';
  if (spec.main == null) return false;
  const script = materializeScript('voicePttPollDarwin.py');
  const proc = spawn(py, [
    script,
    String(spec.main),
    csv(spec.shift),
    csv(spec.alt),
    csv(spec.ctrl),
    csv(spec.meta)
  ], { stdio: ['ignore', 'pipe', 'ignore'] });
  child = proc;
  attachStdout(proc, bind, gen);
  return true;
}

function startWin32 (spec, bind, gen) {
  if (spec.main == null) return false;
  const script = materializeScript('voicePttPollWin32.ps1');
  const proc = spawn('powershell.exe', [
    '-NoProfile',
    '-ExecutionPolicy', 'Bypass',
    '-File', script,
    '-Main', String(spec.main),
    '-ShiftKeys', csv(spec.shift),
    '-AltKeys', csv(spec.alt),
    '-CtrlKeys', csv(spec.ctrl),
    '-MetaKeys', csv(spec.meta)
  ], { stdio: ['ignore', 'pipe', 'ignore'] });
  child = proc;
  attachStdout(proc, bind, gen);
  return true;
}

function startShortcut (bind) {
  if (!globalShortcut || typeof globalShortcut.register !== 'function') return false;
  const accel = groupVoiceSettings.electronAccelerator(bind);
  shortcutAccel = accel;
  try { globalShortcut.unregisterAll(); } catch (_) { /* ignore */ }
  try {
    const ok = globalShortcut.register(accel, () => {
      if (child) return;
      if (typeof isRendererFocused === 'function' && isRendererFocused()) return;
      lastHeld = !lastHeld;
      if (typeof onHeld === 'function') onHeld(lastHeld);
    });
    return !!ok;
  } catch (_) {
    shortcutAccel = null;
    return false;
  }
}

/**
 * @param {object} opts
 * @param {boolean} [opts.enabled]
 * @param {object} [opts.pttKey]
 * @param {function(boolean)} opts.onHeld
 * @param {function} [opts.isRendererFocused]
 * @param {object} [opts.globalShortcut] Electron globalShortcut
 * @returns {{ ok: boolean, method: string, accelerator: string }}
 */
function start (opts = {}) {
  onHeld = opts.onHeld || null;
  isRendererFocused = opts.isRendererFocused || null;
  globalShortcut = opts.globalShortcut || globalShortcut;
  stop();
  stopping = false;
  lastHeld = false;
  const enabled = opts.enabled !== false;
  const bind = groupVoiceSettings.sanitizePttBind(opts.pttKey || opts.bind);
  const accelerator = groupVoiceSettings.electronAccelerator(bind);
  if (!enabled) {
    return { ok: true, method: 'off', accelerator };
  }
  const spec = pollSpec(bind);
  const gen = generation;
  let method = 'shortcut';
  try {
    if (process.platform === 'darwin' && spec && spec.darwin.main != null) {
      if (startDarwin(spec.darwin, bind, gen)) method = 'poll';
    } else if (process.platform === 'win32' && spec && spec.win32.main != null) {
      if (startWin32(spec.win32, bind, gen)) method = 'poll';
    }
  } catch (_) {
    method = 'shortcut';
  }
  if (method !== 'poll') {
    startShortcut(bind);
    method = shortcutAccel ? 'shortcut' : 'none';
  }
  return { ok: method !== 'none', method, accelerator };
}

module.exports = {
  start,
  stop
};
