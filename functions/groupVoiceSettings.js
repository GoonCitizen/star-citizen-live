'use strict';

/**
 * Operator voice settings. Persist as Fabric Store key `voice` (not genesis).
 * Default talk mode is push-to-talk; default bind is Shift+Tab.
 */

const DEFAULT_PTT_BIND = Object.freeze({
  shift: true,
  alt: false,
  ctrl: false,
  meta: false,
  code: 'Tab'
});

const DEFAULT_VOICE = Object.freeze({
  mode: 'ptt',
  pttKey: DEFAULT_PTT_BIND,
  vadSensitivity: 0.12,
  muted: false,
  deafened: false,
  inputDeviceId: null,
  outputDeviceId: null
});

const MODIFIER_CODES = new Set([
  'ShiftLeft', 'ShiftRight', 'ControlLeft', 'ControlRight',
  'AltLeft', 'AltRight', 'MetaLeft', 'MetaRight', 'OSLeft', 'OSRight'
]);

/**
 * @param {string} raw
 * @returns {string}
 */
function normalizeCode (raw) {
  const s = String(raw || '').trim();
  if (!s) return DEFAULT_PTT_BIND.code;
  if (s === '`' || /^(backtick|grave|backquote)$/i.test(s)) return 'Backquote';
  if (/^tab$/i.test(s)) return 'Tab';
  if (/^(esc|escape)$/i.test(s)) return 'Escape';
  if (/^(space|spacebar)$/i.test(s)) return 'Space';
  if (/^[a-z]$/i.test(s)) return 'Key' + s.toUpperCase();
  if (/^[0-9]$/.test(s)) return 'Digit' + s;
  if (/^Key[A-Z]$/.test(s) || /^Digit[0-9]$/.test(s) || /^F([1-9]|1[0-2])$/.test(s)) return s;
  return s;
}

/**
 * Human key name (no modifiers).
 * @param {string} code
 * @returns {string}
 */
function keyLabel (code) {
  const c = normalizeCode(code);
  if (c === 'Backquote') return 'Backtick';
  if (c === 'Escape') return 'Esc';
  const letter = /^Key([A-Z])$/.exec(c);
  if (letter) return letter[1];
  const digit = /^Digit([0-9])$/.exec(c);
  if (digit) return digit[1];
  return c;
}

/**
 * Electron globalShortcut key token for a KeyboardEvent.code.
 * @param {string} code
 * @returns {string}
 */
function electronKey (code) {
  const c = normalizeCode(code);
  if (c === 'Backquote') return '`';
  if (c === 'Escape') return 'Esc';
  const letter = /^Key([A-Z])$/.exec(c);
  if (letter) return letter[1];
  const digit = /^Digit([0-9])$/.exec(c);
  if (digit) return digit[1];
  if (c === 'Minus') return '-';
  if (c === 'Equal') return '=';
  if (c === 'Comma') return ',';
  if (c === 'Period') return '.';
  if (c === 'Slash') return '/';
  if (c === 'Backslash') return '\\';
  if (c === 'Semicolon') return ';';
  if (c === 'Quote') return '\'';
  if (c === 'BracketLeft') return '[';
  if (c === 'BracketRight') return ']';
  return c;
}

/**
 * @param {*} raw
 * @returns {{ shift: boolean, alt: boolean, ctrl: boolean, meta: boolean, code: string }}
 */
function sanitizePttBind (raw) {
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    const code = normalizeCode(raw.code || raw.key || '');
    return {
      shift: raw.shift === true,
      alt: raw.alt === true,
      ctrl: raw.ctrl === true || raw.control === true,
      meta: raw.meta === true,
      code
    };
  }
  const s = String(raw || '').trim();
  if (!s) return Object.assign({}, DEFAULT_PTT_BIND);
  const parts = s.split('+').map((p) => p.trim()).filter(Boolean);
  const bind = {
    shift: false,
    alt: false,
    ctrl: false,
    meta: false,
    code: DEFAULT_PTT_BIND.code
  };
  let sawKey = false;
  for (const part of parts) {
    const lower = part.toLowerCase();
    if (lower === 'shift') bind.shift = true;
    else if (lower === 'alt' || lower === 'option') bind.alt = true;
    else if (lower === 'ctrl' || lower === 'control') bind.ctrl = true;
    else if (lower === 'meta' || lower === 'cmd' || lower === 'super' || lower === 'win') bind.meta = true;
    else {
      bind.code = normalizeCode(part);
      sawKey = true;
    }
  }
  if (!sawKey) bind.code = DEFAULT_PTT_BIND.code;
  if (!bind.shift && !bind.alt && !bind.ctrl && !bind.meta && bind.code === 'Backquote') {
    bind.shift = true;
  }
  return bind;
}

/**
 * @param {*} raw
 * @returns {object}
 */
function sanitizeVoiceSettings (raw) {
  const src = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const mode = String(src.mode || '').toLowerCase() === 'vad' ? 'vad' : 'ptt';
  let vad = Number(src.vadSensitivity);
  if (!Number.isFinite(vad)) vad = DEFAULT_VOICE.vadSensitivity;
  vad = Math.min(1, Math.max(0.02, vad));
  const inputDeviceId = src.inputDeviceId == null || src.inputDeviceId === ''
    ? null
    : String(src.inputDeviceId).slice(0, 128);
  const outputDeviceId = src.outputDeviceId == null || src.outputDeviceId === ''
    ? null
    : String(src.outputDeviceId).slice(0, 128);
  return {
    mode,
    pttKey: sanitizePttBind(src.pttKey || src.pttBind),
    vadSensitivity: vad,
    muted: src.muted === true,
    deafened: src.deafened === true,
    inputDeviceId,
    outputDeviceId
  };
}

function defaultVoiceSettings () {
  return sanitizeVoiceSettings(null);
}

/**
 * Human label for Settings / the active-voice panel.
 * @param {object} [bind]
 * @returns {string}
 */
function pttBindLabel (bind) {
  const b = sanitizePttBind(bind);
  const mods = [];
  if (b.ctrl) mods.push('Ctrl');
  if (b.alt) mods.push('Alt');
  if (b.shift) mods.push('Shift');
  if (b.meta) mods.push('Meta');
  return (mods.length ? mods.join('+') + '+' : '') + keyLabel(b.code);
}

/**
 * Electron globalShortcut accelerator (press fires once; hold uses OS key-state poll).
 * @param {object} [bind]
 * @returns {string}
 */
function electronAccelerator (bind) {
  const b = sanitizePttBind(bind);
  const mods = [];
  if (b.ctrl) mods.push('Control');
  if (b.alt) mods.push('Alt');
  if (b.shift) mods.push('Shift');
  if (b.meta) mods.push('Super');
  return mods.concat([electronKey(b.code)]).join('+');
}

/**
 * @param {KeyboardEvent|object} ev
 * @returns {{ shift: boolean, alt: boolean, ctrl: boolean, meta: boolean, code: string }|null}
 */
function bindFromKeyboardEvent (ev) {
  if (!ev || typeof ev !== 'object') return null;
  const code = String(ev.code || '');
  if (!code || MODIFIER_CODES.has(code)) return null;
  return sanitizePttBind({
    shift: !!ev.shiftKey,
    alt: !!ev.altKey,
    ctrl: !!ev.ctrlKey,
    meta: !!ev.metaKey,
    code
  });
}

/**
 * @param {KeyboardEvent|object} ev
 * @param {object} [bind]
 * @returns {boolean}
 */
function matchesPttKey (ev, bind) {
  if (!ev || typeof ev !== 'object') return false;
  const b = sanitizePttBind(bind);
  if (!!ev.shiftKey !== b.shift) return false;
  if (!!ev.altKey !== b.alt) return false;
  if (!!ev.ctrlKey !== b.ctrl) return false;
  if (!!ev.metaKey !== b.meta) return false;
  const code = String(ev.code || '');
  const key = String(ev.key || '');
  if (b.code === 'Backquote') {
    return code === 'Backquote' || key === '`' || key === '~';
  }
  if (b.code === 'Tab') {
    return code === 'Tab' || key === 'Tab';
  }
  if (b.code === 'Space') {
    return code === 'Space' || key === ' ' || key === 'Spacebar';
  }
  if (b.code === 'Escape') {
    return code === 'Escape' || key === 'Escape' || key === 'Esc';
  }
  return code === b.code || key === b.code || key === keyLabel(b.code);
}

/**
 * True when a keyup means the PTT combo is no longer fully held.
 * @param {KeyboardEvent|object} ev
 * @param {object} [bind]
 * @returns {boolean}
 */
function pttComboReleased (ev, bind) {
  if (!ev || typeof ev !== 'object') return false;
  const b = sanitizePttBind(bind);
  const code = String(ev.code || '');
  const key = String(ev.key || '');
  if (matchesPttKey(Object.assign({}, ev, {
    shiftKey: b.shift,
    altKey: b.alt,
    ctrlKey: b.ctrl,
    metaKey: b.meta
  }), b) && (code === b.code || key === keyLabel(b.code) || key === 'Tab' && b.code === 'Tab')) {
    return true;
  }
  if (b.shift && (key === 'Shift' || code === 'ShiftLeft' || code === 'ShiftRight')) return true;
  if (b.alt && (key === 'Alt' || key === 'Option' || code === 'AltLeft' || code === 'AltRight')) return true;
  if (b.ctrl && (key === 'Control' || code === 'ControlLeft' || code === 'ControlRight')) return true;
  if (b.meta && (key === 'Meta' || key === 'OS' || code === 'MetaLeft' || code === 'MetaRight' ||
      code === 'OSLeft' || code === 'OSRight')) return true;
  return false;
}

/**
 * Push the current bind into Electron (global capture). Safe in the browser.
 * @param {object} [settings]
 */
function applyElectronPttBind (settings) {
  if (typeof window === 'undefined') return;
  const api = window.electronAPI && window.electronAPI.voice;
  if (!api || typeof api.setPttBind !== 'function') return;
  const s = sanitizeVoiceSettings(settings);
  api.setPttBind({
    enabled: s.mode === 'ptt',
    pttKey: s.pttKey
  }).catch(() => {});
}

module.exports = {
  DEFAULT_PTT_BIND,
  DEFAULT_VOICE,
  MODIFIER_CODES,
  normalizeCode,
  keyLabel,
  electronKey,
  sanitizePttBind,
  sanitizeVoiceSettings,
  defaultVoiceSettings,
  pttBindLabel,
  electronAccelerator,
  bindFromKeyboardEvent,
  matchesPttKey,
  pttComboReleased,
  applyElectronPttBind
};
