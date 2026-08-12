'use strict';

/**
 * Group primary brand color — CSS accent theming for the selected primary group.
 */

const HEX_RE = /^#([0-9a-fA-F]{6})$/;
const DEFAULT_ACCENT = '#3b82f6';

/**
 * @param {*} value
 * @returns {string|null} `#rrggbb` lowercase, or null to clear
 */
function sanitizePrimaryColor (value) {
  if (value === undefined || value === null || value === '') return null;
  let s = String(value).trim();
  if (/^[0-9a-fA-F]{6}$/.test(s)) s = '#' + s;
  if (!HEX_RE.test(s)) return null;
  return '#' + s.slice(1).toLowerCase();
}

/**
 * @param {string} hex `#rrggbb`
 * @param {number} [alpha]
 * @returns {string} `rgba(r,g,b,a)`
 */
function hexToRgba (hex, alpha = 1) {
  const clean = sanitizePrimaryColor(hex) || DEFAULT_ACCENT;
  const n = parseInt(clean.slice(1), 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  const a = Number.isFinite(alpha) ? Math.min(1, Math.max(0, alpha)) : 1;
  return `rgba(${r},${g},${b},${a})`;
}

/**
 * Apply (or clear) document CSS variables for the primary group accent.
 * Safe in browser only; no-ops when `document` is missing.
 * @param {string|null|undefined} hex
 */
function applyDocumentTheme (hex) {
  if (typeof document === 'undefined' || !document.documentElement) return;
  const root = document.documentElement;
  const color = sanitizePrimaryColor(hex);
  if (!color) {
    root.style.removeProperty('--accent');
    root.style.removeProperty('--accent-soft');
    root.style.removeProperty('--accent-soft-strong');
    root.style.removeProperty('--accent-ink');
    root.removeAttribute('data-group-theme');
    return;
  }
  root.style.setProperty('--accent', color);
  root.style.setProperty('--accent-soft', hexToRgba(color, 0.15));
  root.style.setProperty('--accent-soft-strong', hexToRgba(color, 0.18));
  root.style.setProperty('--accent-ink', '#ffffff');
  root.setAttribute('data-group-theme', color);
}

module.exports = {
  DEFAULT_ACCENT,
  HEX_RE,
  sanitizePrimaryColor,
  hexToRgba,
  applyDocumentTheme
};
