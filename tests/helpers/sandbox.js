'use strict';

/**
 * Puppeteer helpers matching Hub `tests/browser.interface.test.js`.
 * Uses `@fabric/http/types/sandbox` so GoonCitizen click tests share the
 * same Chromium harness as Hub / fabric-http.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const DEFAULT_GOTO = { waitUntil: 'load', timeout: 30000 };

function sleep (ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function loadSandboxType () {
  try {
    return require('@fabric/http/types/sandbox');
  } catch (err) {
    err.code = 'SANDBOX_UNAVAILABLE';
    throw err;
  }
}

/**
 * Puppeteer in this workspace may point at an empty Cursor cache. Prefer a
 * real Chrome for Testing (or system Chrome) so Sandbox can launch.
 * @returns {string|null}
 */
function resolveChromeExecutable () {
  const envPath = process.env.PUPPETEER_EXECUTABLE_PATH || process.env.CHROME_PATH;
  if (envPath && fs.existsSync(envPath)) return envPath;
  try {
    const puppeteer = require('puppeteer');
    const hinted = typeof puppeteer.executablePath === 'function'
      ? puppeteer.executablePath()
      : null;
    if (hinted && fs.existsSync(hinted)) return hinted;
  } catch (_) { /* not installed */ }
  const homeCache = path.join(os.homedir(), '.cache', 'puppeteer', 'chrome');
  if (fs.existsSync(homeCache)) {
    const versions = fs.readdirSync(homeCache).filter((n) => n.startsWith('mac_arm-') || n.startsWith('mac-') || n.startsWith('linux') || n.startsWith('win'));
    versions.sort().reverse();
    const prefer = versions.filter((n) => n.includes('145.0.7632.77')).concat(versions);
    for (const ver of prefer) {
      const candidates = [
        path.join(homeCache, ver, 'chrome-mac-arm64', 'Google Chrome for Testing.app', 'Contents', 'MacOS', 'Google Chrome for Testing'),
        path.join(homeCache, ver, 'chrome-mac-x64', 'Google Chrome for Testing.app', 'Contents', 'MacOS', 'Google Chrome for Testing'),
        path.join(homeCache, ver, 'chrome-linux64', 'chrome'),
        path.join(homeCache, ver, 'chrome-win64', 'chrome.exe')
      ];
      const hit = candidates.find((p) => fs.existsSync(p));
      if (hit) return hit;
    }
  }
  const macChrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
  if (fs.existsSync(macChrome)) return macChrome;
  return null;
}

/**
 * Launch Fabric HTTP Sandbox (headless Chromium). Caller must stop().
 * Extra Chromium flags keep CI / agent sandboxes from failing setuid.
 * @param {object} [opts]
 * @returns {Promise<object>} Sandbox instance (`browser` is the Puppeteer page)
 */
async function startSandbox (opts = {}) {
  const Sandbox = loadSandboxType();
  const executablePath = resolveChromeExecutable();
  if (!executablePath) {
    const err = new Error('Chrome not found for Fabric HTTP Sandbox (install Puppeteer Chrome or Google Chrome)');
    err.code = 'SANDBOX_UNAVAILABLE';
    throw err;
  }
  const sandbox = new Sandbox({
    browser: {
      headless: true,
      slowMo: 0,
      executablePath,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu'
      ],
      viewport: { width: 1280, height: 900 }
    }
  });
  await sandbox.start();
  if (opts.diagnostics !== false) attachBrowserClientDiagnostics(sandbox.browser);
  return sandbox;
}

function attachBrowserClientDiagnostics (page) {
  if (!page || page._gcSandboxDiag) return;
  page._gcSandboxDiag = true;
  page.on('pageerror', (err) => {
    console.error('[browser:pageerror]', (err && err.message) || String(err));
  });
  page.on('requestfailed', (req) => {
    const f = (typeof req.failure === 'function') ? req.failure() : null;
    const url = typeof req.url === 'function' ? req.url() : '';
    if (/favicon|hot-update/.test(url)) return;
    console.error('[browser:requestfailed]', url, f && f.errorText ? f.errorText : '');
  });
}

/**
 * Pretend the dashboard is Desktop so Onboarding unlocks and Chat/Groups
 * enable compose. Signing is stubbed — LiveRelay local mode uses setIdentity.
 * Call before the first `goto`.
 * @param {object} page Puppeteer page
 * @param {string} pubkey
 */
async function injectDesktopIdentity (page, pubkey) {
  await page.evaluateOnNewDocument((pk) => {
    const summary = { exists: true, unlocked: true, pubkey: pk };
    window.electronAPI = {
      identity: {
        get: async () => Object.assign({}, summary),
        onChanged: (cb) => {
          queueMicrotask(() => cb(Object.assign({}, summary)));
          return () => {};
        },
        signEnvelope: async () => ({ error: 'sandbox: signing not available' }),
        signMessage: async () => ({ error: 'sandbox: signing not available' })
      }
    };
  }, pubkey);
}

async function gotoReady (page, url, opts = {}) {
  await page.goto(url, Object.assign({}, DEFAULT_GOTO, opts));
}

async function waitForBodyText (page, needle, timeoutMs = 12000) {
  const started = Date.now();
  const match = needle instanceof RegExp ? needle : null;
  const text = match ? null : String(needle);
  while (Date.now() - started < timeoutMs) {
    try {
      const body = await page.evaluate(() =>
        (document.body && document.body.innerText) ? document.body.innerText : '');
      if (match ? match.test(body) : body.includes(text)) return true;
    } catch (err) {
      const msg = (err && err.message) ? err.message : String(err);
      if (!/Execution context was destroyed|Target closed|Session closed|detached Frame/i.test(msg)) {
        throw err;
      }
    }
    await sleep(200);
  }
  return false;
}

async function waitForSelector (page, selector, timeoutMs = 12000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const found = await page.evaluate((sel) => !!document.querySelector(sel), selector);
    if (found) return true;
    await sleep(200);
  }
  return false;
}

async function waitForMainUI (page, timeoutMs = 20000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const found = await page.evaluate(() => {
      const home = Array.from(document.querySelectorAll('button.tab'))
        .find((el) => String(el.textContent || '').trim() === 'Home');
      const title = document.querySelector('header h1');
      return !!(home && title && /GoonCitizen/i.test(title.textContent || ''));
    });
    if (found) return true;
    await sleep(250);
  }
  return false;
}

/**
 * Click a header / home / network `button.tab` by exact label.
 * @returns {Promise<boolean>}
 */
async function clickTab (page, label, root = 'button.tab') {
  return page.evaluate((target, sel) => {
    const btn = Array.from(document.querySelectorAll(sel))
      .find((el) => String(el.textContent || '').replace(/\s+/g, ' ').trim() === target);
    if (!btn) return false;
    btn.click();
    return true;
  }, label, root);
}

/**
 * Click the first button/link/label whose visible text includes `text`.
 * Prefer exact match.
 * @returns {Promise<boolean>}
 */
async function clickByText (page, text, selector = 'button, a, label, summary') {
  return page.evaluate((target, sel) => {
    const want = String(target || '').trim();
    const els = Array.from(document.querySelectorAll(sel));
    const exact = els.find((el) => String(el.textContent || '').replace(/\s+/g, ' ').trim() === want);
    const partial = els.find((el) => String(el.textContent || '').replace(/\s+/g, ' ').includes(want));
    const el = exact || partial;
    if (!el) return false;
    el.click();
    return true;
  }, text, selector);
}

async function waitForPlaceholder (page, placeholder, timeoutMs = 12000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const found = await page.evaluate((ph) => {
      return Array.from(document.querySelectorAll('input, textarea'))
        .some((n) => String(n.getAttribute('placeholder') || '') === ph);
    }, placeholder);
    if (found) return true;
    await sleep(200);
  }
  return false;
}

async function fillByPlaceholder (page, placeholder, value, timeoutMs = 0) {
  if (timeoutMs > 0) {
    const ready = await waitForPlaceholder(page, placeholder, timeoutMs);
    if (!ready) return false;
  }
  return page.evaluate((ph, val) => {
    const el = Array.from(document.querySelectorAll('input, textarea'))
      .find((n) => String(n.getAttribute('placeholder') || '') === ph);
    if (!el) return false;
    el.focus();
    const proto = el.tagName === 'TEXTAREA' ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
    const desc = Object.getOwnPropertyDescriptor(proto, 'value');
    if (desc && desc.set) desc.set.call(el, val);
    else el.value = val;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  }, placeholder, value);
}

async function fillFirst (page, selector, value) {
  return page.evaluate((sel, val) => {
    const el = document.querySelector(sel);
    if (!el) return false;
    el.focus();
    const proto = el.tagName === 'TEXTAREA' ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
    const desc = Object.getOwnPropertyDescriptor(proto, 'value');
    if (desc && desc.set) desc.set.call(el, val);
    else el.value = val;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  }, selector, value);
}

async function bodyText (page) {
  return page.evaluate(() =>
    (document.body && document.body.innerText) ? document.body.innerText : '');
}

async function currentHash (page) {
  return page.evaluate(() => String(window.location.hash || ''));
}

/**
 * Snapshot of visible tabs, headings, buttons, and placeholders.
 * Used to plan deeper click coverage from a real dashboard render.
 * @returns {Promise<object>}
 */
async function inventoryUi (page) {
  return page.evaluate(() => {
    const label = (el) => String(el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 100);
    const tabs = Array.from(document.querySelectorAll('button.tab'))
      .map(label).filter(Boolean);
    const gpTabs = Array.from(document.querySelectorAll('button.gp-tab'))
      .map(label).filter(Boolean);
    const buttons = Array.from(document.querySelectorAll('button')).map((el) => {
      const text = label(el);
      const title = String(el.getAttribute('title') || el.getAttribute('aria-label') || '');
      return {
        text,
        title: title.slice(0, 80),
        disabled: !!el.disabled,
        className: String(el.className || '').replace(/\s+/g, ' ').trim().slice(0, 48)
      };
    }).filter((b) => b.text || b.title);
    const headings = Array.from(document.querySelectorAll('h1, h2, h3'))
      .map(label).filter(Boolean);
    const placeholders = Array.from(document.querySelectorAll('input, textarea'))
      .map((el) => el.getAttribute('placeholder'))
      .filter(Boolean);
    const links = Array.from(document.querySelectorAll('a')).map((el) => ({
      text: label(el),
      href: String(el.getAttribute('href') || '').slice(0, 120)
    })).filter((a) => a.text || a.href);
    const snippet = String((document.body && document.body.innerText) || '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 480);
    return {
      path: String(window.location.pathname || ''),
      hash: String(window.location.hash || ''),
      title: document.title,
      snippet,
      tabs: Array.from(new Set(tabs)),
      groupTabs: gpTabs,
      headings,
      placeholders,
      buttons,
      links: links.slice(0, 40)
    };
  });
}

function summarizeInventory (inv) {
  if (!inv) return '';
  const btn = (inv.buttons || [])
    .filter((b) => !b.disabled && (b.text || b.title))
    .map((b) => b.text || b.title)
    .slice(0, 36);
  const parts = [
    (inv.path || '/') + (inv.hash || ''),
    'tabs[' + (inv.tabs || []).join(' | ') + ']',
    inv.groupTabs && inv.groupTabs.length ? ('groupTabs[' + inv.groupTabs.join(' | ') + ']') : null,
    'h[' + (inv.headings || []).slice(0, 8).join(' · ') + ']',
    'ph[' + (inv.placeholders || []).join(' | ') + ']',
    'btn[' + btn.join(' | ') + ']',
    inv.snippet ? ('txt[' + inv.snippet.slice(0, 220) + ']') : null
  ].filter(Boolean);
  return parts.join('\n  ');
}

async function clickByTitle (page, title, selector = 'button, a, summary') {
  return page.evaluate((want, sel) => {
    const target = String(want || '').trim();
    const els = Array.from(document.querySelectorAll(sel));
    const el = els.find((n) => {
      const t = String(n.getAttribute('title') || n.getAttribute('aria-label') || '').trim();
      return t === target || t.includes(target);
    });
    if (!el) return false;
    el.click();
    return true;
  }, title, selector);
}

async function closeOverlays (page) {
  for (let i = 0; i < 5; i++) {
    const closed = await page.evaluate(() => {
      const btn = Array.from(document.querySelectorAll('button')).find((el) => {
        const title = String(el.getAttribute('title') || '');
        const text = String(el.textContent || '').trim();
        const cls = String(el.className || '');
        return title === 'Close' || title === 'Close settings' || cls.split(/\s+/).includes('st-x') || text === '✕';
      });
      if (!btn) return false;
      btn.click();
      return true;
    });
    if (!closed) break;
    await sleep(120);
  }
}

async function clickGroupTab (page, label) {
  return page.evaluate((want) => {
    const btn = Array.from(document.querySelectorAll('button.gp-tab'))
      .find((el) => String(el.textContent || '').replace(/\s+/g, ' ').trim().startsWith(want));
    if (!btn) return false;
    btn.click();
    return true;
  }, label);
}

async function clickRowText (page, selector, needle) {
  return page.evaluate((sel, n) => {
    const row = Array.from(document.querySelectorAll(sel))
      .find((el) => String(el.textContent || '').includes(n));
    if (!row) return false;
    row.click();
    return true;
  }, selector, needle);
}

module.exports = {
  DEFAULT_GOTO,
  sleep,
  loadSandboxType,
  resolveChromeExecutable,
  startSandbox,
  attachBrowserClientDiagnostics,
  injectDesktopIdentity,
  gotoReady,
  waitForBodyText,
  waitForSelector,
  waitForMainUI,
  clickTab,
  clickByText,
  clickByTitle,
  closeOverlays,
  clickGroupTab,
  clickRowText,
  fillByPlaceholder,
  waitForPlaceholder,
  fillFirst,
  bodyText,
  currentHash,
  inventoryUi,
  summarizeInventory
};
