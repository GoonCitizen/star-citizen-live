'use strict';

/**
 * KeyboardEvent.code → OS virtual keys for global PTT hold polling.
 * Windows VK codes; macOS HIToolbox / ANSI key codes.
 */

const WIN = {
  Tab: 0x09,
  Escape: 0x1B,
  Space: 0x20,
  Backquote: 0xC0,
  Minus: 0xBD,
  Equal: 0xBB,
  BracketLeft: 0xDB,
  BracketRight: 0xDD,
  Backslash: 0xDC,
  Semicolon: 0xBA,
  Quote: 0xDE,
  Comma: 0xBC,
  Period: 0xBE,
  Slash: 0xBF
};

const DARWIN = {
  Tab: 48,
  Space: 49,
  Backquote: 50,
  Escape: 53,
  Minus: 27,
  Equal: 24,
  BracketLeft: 33,
  BracketRight: 30,
  Backslash: 42,
  Semicolon: 41,
  Quote: 39,
  Comma: 43,
  Period: 47,
  Slash: 44,
  KeyA: 0,
  KeyS: 1,
  KeyD: 2,
  KeyF: 3,
  KeyH: 4,
  KeyG: 5,
  KeyZ: 6,
  KeyX: 7,
  KeyC: 8,
  KeyV: 9,
  KeyB: 11,
  KeyQ: 12,
  KeyW: 13,
  KeyE: 14,
  KeyR: 15,
  KeyY: 16,
  KeyT: 17,
  Digit1: 18,
  Digit2: 19,
  Digit3: 20,
  Digit4: 21,
  Digit6: 22,
  Digit5: 23,
  Digit9: 25,
  Digit7: 26,
  Digit8: 28,
  Digit0: 29,
  KeyO: 31,
  KeyU: 32,
  KeyI: 34,
  KeyP: 35,
  KeyL: 37,
  KeyJ: 38,
  KeyK: 40,
  KeyN: 45,
  KeyM: 46
};

function letterVk (code) {
  const m = /^Key([A-Z])$/.exec(code);
  if (!m) return null;
  return 0x41 + (m[1].charCodeAt(0) - 65);
}

function digitVk (code) {
  const m = /^Digit([0-9])$/.exec(code);
  if (!m) return null;
  return 0x30 + Number(m[1]);
}

function fnVk (code) {
  const m = /^F([1-9]|1[0-2])$/.exec(code);
  if (!m) return null;
  return 0x70 + Number(m[1]) - 1;
}

/**
 * @param {string} code KeyboardEvent.code
 * @returns {{ win32: number|null, darwin: number|null }}
 */
function osKeysForCode (code) {
  const c = String(code || '');
  let win32 = WIN[c];
  if (win32 == null) win32 = letterVk(c);
  if (win32 == null) win32 = digitVk(c);
  if (win32 == null) win32 = fnVk(c);
  const darwin = Object.prototype.hasOwnProperty.call(DARWIN, c) ? DARWIN[c] : null;
  return {
    win32: win32 == null ? null : win32,
    darwin: darwin == null ? null : darwin
  };
}

/**
 * Poller spec: main key must be down, plus each required modifier group (any of).
 * @param {object} bind sanitized ptt bind
 * @returns {{ win32: object, darwin: object }|null}
 */
function pollSpec (bind) {
  if (!bind || !bind.code) return null;
  const main = osKeysForCode(bind.code);
  if (main.win32 == null && main.darwin == null) return null;
  return {
    win32: {
      main: main.win32,
      shift: bind.shift ? [0x10] : [],
      alt: bind.alt ? [0x12] : [],
      ctrl: bind.ctrl ? [0x11] : [],
      meta: bind.meta ? [0x5B, 0x5C] : []
    },
    darwin: {
      main: main.darwin,
      shift: bind.shift ? [56, 60] : [],
      alt: bind.alt ? [58, 61] : [],
      ctrl: bind.ctrl ? [59, 62] : [],
      meta: bind.meta ? [55, 54] : []
    }
  };
}

module.exports = {
  osKeysForCode,
  pollSpec,
  WIN,
  DARWIN
};
