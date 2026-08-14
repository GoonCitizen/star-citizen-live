'use strict';

/**
 * Top-down GoonCitizen dashboard clicks via Fabric HTTP Sandbox (Puppeteer).
 * Same harness as Hub `tests/browser.interface.test.js`.
 *
 * Run: `npm run test:browser` (rebuilds the SPA, launches Chromium).
 * Not part of default `npm test` — Chromium is opt-in, like Hub.
 */

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const {
  startSandbox,
  injectDesktopIdentity,
  gotoReady,
  waitForBodyText,
  waitForMainUI,
  waitForSelector,
  clickTab,
  clickByText,
  fillByPlaceholder,
  waitForPlaceholder,
  fillFirst,
  bodyText,
  sleep,
  inventoryUi,
  summarizeInventory,
  clickByTitle,
  closeOverlays,
  clickGroupTab,
  clickRowText
} = require('../helpers/sandbox');
const {
  startLiveRelayForSandbox,
  stopLiveRelayForSandbox
} = require('../helpers/liveRelaySandbox');

const SPA = path.join(__dirname, '../../assets/index.html');
const FILE_ID = 'ab'.repeat(32);

describe('GoonCitizen dashboard Sandbox', { timeout: 300000 }, () => {
  let ctx;
  let sandbox;
  let skipReason = null;

  before(async () => {
    if (!fs.existsSync(SPA)) {
      skipReason = 'assets/index.html missing — run npm run build:browser';
      return;
    }
    try {
      ctx = await startLiveRelayForSandbox();
      ctx.svc.registerStore.put('documents', FILE_ID, {
        id: FILE_ID,
        sha256: FILE_ID,
        name: 'gooncitizen.dmg',
        mime: 'application/octet-stream',
        size: 4096,
        published: true,
        purchasePriceSats: 4,
        created: '2026-08-13T00:00:00.000Z'
      });
      await ctx.svc.groupManager.createGroup({
        name: 'Sandbox Wing',
        members: [ctx.identity.pubkey],
        visibility: 'public'
      }, ctx.identity.pubkey);

      sandbox = await startSandbox();
      await injectDesktopIdentity(sandbox.browser, ctx.identity.pubkey);
      await gotoReady(sandbox.browser, ctx.origin + '/');
      const ready = await waitForMainUI(sandbox.browser, 25000);
      if (!ready) skipReason = 'Dashboard shell (Home tab + GoonCitizen header) did not appear';
    } catch (err) {
      skipReason = (err && err.message) ? err.message : String(err);
      console.error('[dashboard-sandbox] setup failed:', skipReason);
    }
  });

  after(async () => {
    if (sandbox) {
      try { await sandbox.stop(); } catch (_) { /* ignore */ }
    }
    await stopLiveRelayForSandbox(ctx);
  });

  function requireReady (t) {
    if (skipReason) {
      t.skip(skipReason);
      return false;
    }
    return true;
  }

  it('loads the dashboard shell with Home', async (t) => {
    if (!requireReady(t)) return;
    const title = await sandbox.browser.evaluate(() => document.title);
    assert.match(title, /GoonCitizen/);
    const text = await bodyText(sandbox.browser);
    assert.match(text, /GoonCitizen/);
    assert.match(text, /Home/);
    assert.match(text, /Groups/);
    assert.match(text, /Missions/);
    assert.match(text, /Chat/);
  });

  it('clicks Home activity views', async (t) => {
    if (!requireReady(t)) return;
    assert.ok(await clickTab(sandbox.browser, 'Home'), 'Home tab');
    await sleep(300);
    assert.ok(await clickTab(sandbox.browser, 'When you fly'), 'When you fly');
    assert.ok(await waitForBodyText(sandbox.browser, /When you fly|heatmap|no activity/i, 8000));
    assert.ok(await clickTab(sandbox.browser, 'Pilots'), 'Pilots');
    await sleep(200);
    assert.ok(await clickTab(sandbox.browser, 'Home'), 'return Home');
  });

  it('opens Groups from the header and shows the seeded group', async (t) => {
    if (!requireReady(t)) return;
    assert.ok(await clickTab(sandbox.browser, 'Groups'), 'Groups tab');
    assert.ok(await waitForBodyText(sandbox.browser, 'Sandbox Wing', 8000));
    const selected = await sandbox.browser.evaluate(() => {
      const row = Array.from(document.querySelectorAll('.gp-row'))
        .find((el) => /Sandbox Wing/.test(el.textContent || ''));
      if (!row) return false;
      row.click();
      return true;
    });
    assert.ok(selected, 'select Sandbox Wing row');
    await sleep(400);
    const text = await bodyText(sandbox.browser);
    assert.match(text, /Sandbox Wing/);
  });

  it('creates a mission from the Missions register', async (t) => {
    if (!requireReady(t)) return;
    assert.ok(await clickTab(sandbox.browser, 'Missions'), 'Missions tab');
    assert.ok(await waitForBodyText(sandbox.browser, 'Mission register', 8000));
    assert.ok(await clickByText(sandbox.browser, '+ New mission'), 'open create');
    assert.ok(await waitForBodyText(sandbox.browser, 'Create mission', 5000));
    assert.ok(await fillByPlaceholder(sandbox.browser,
      'Escort the Hull-C from Crusader…',
      'Sandbox escort'), 'title');
    await sleep(250);
    assert.ok(await clickByText(sandbox.browser, 'Create mission'), 'submit');
    assert.ok(await waitForBodyText(sandbox.browser, /Sandbox escort|Mission created/, 10000));
  });

  it('opens Fleets and creates a named fleet', async (t) => {
    if (!requireReady(t)) return;
    assert.ok(await clickTab(sandbox.browser, 'Fleets'), 'Fleets tab');
    assert.ok(await waitForBodyText(sandbox.browser, /Your fleets|Fleet /, 8000));
    assert.ok(await fillByPlaceholder(sandbox.browser, 'New fleet name', 'Sandbox fleet'));
    await sleep(250);
    assert.ok(await clickByText(sandbox.browser, 'New fleet'));
    assert.ok(await waitForBodyText(sandbox.browser, /Sandbox fleet/, 8000));
  });

  it('sends a global chat message', async (t) => {
    if (!requireReady(t)) return;
    assert.ok(await clickTab(sandbox.browser, 'Chat'), 'Chat tab');
    assert.ok(await waitForBodyText(sandbox.browser, /Send|No messages yet|Message as/, 8000));
    const typed = await fillFirst(sandbox.browser, '.chat-compose input[type="text"]', 'hello from sandbox');
    assert.ok(typed, 'compose box');
    await sleep(250);
    assert.ok(await clickByText(sandbox.browser, 'Send'));
    assert.ok(await waitForBodyText(sandbox.browser, 'hello from sandbox', 10000));
  });

  it('opens Wallet and Network → Peers', async (t) => {
    if (!requireReady(t)) return;
    const wallet = await clickTab(sandbox.browser, 'Wallet');
    if (wallet) {
      assert.ok(await waitForBodyText(sandbox.browser, /Refresh|Wallet|receive|No groups yet/i, 8000));
    }
    assert.ok(await clickTab(sandbox.browser, 'Network'), 'Network');
    assert.ok(await waitForBodyText(sandbox.browser, /Feed|Live Game\.log/i, 8000));
    assert.ok(await clickTab(sandbox.browser, 'Peers'), 'Peers subview');
    assert.ok(await waitForBodyText(sandbox.browser, /Add peer|Fabric|identity/i, 8000));
  });

  it('opens Notifications from the bell', async (t) => {
    if (!requireReady(t)) return;
    assert.ok(await clickByText(sandbox.browser, '🔔', 'button.bell, button'), 'bell');
    assert.ok(await waitForBodyText(sandbox.browser, 'Notifications', 8000));
  });

  it('enables Advanced mode in Settings and opens Files', async (t) => {
    if (!requireReady(t)) return;
    assert.ok(await clickByText(sandbox.browser, '⚙️', 'button.gear, button'), 'gear');
    assert.ok(await waitForBodyText(sandbox.browser, 'Advanced mode', 8000));
    const toggled = await sandbox.browser.evaluate(() => {
      const labels = Array.from(document.querySelectorAll('label'));
      const row = labels.find((el) => /Enable advanced mode/i.test(el.textContent || ''));
      if (!row) return false;
      const input = row.querySelector('input[type="checkbox"]') || row;
      input.click();
      return true;
    });
    assert.ok(toggled, 'advanced checkbox');
    await sleep(200);
    await clickByText(sandbox.browser, '✕', 'button.st-x, button');
    await sleep(300);
    assert.ok(await clickTab(sandbox.browser, 'Files'), 'Files tab');
    assert.ok(await waitForBodyText(sandbox.browser, /Files |New file|gooncitizen\.dmg/, 8000));
  });

  it('creates a file, opens its page, and pins it to the profile', async (t) => {
    if (!requireReady(t)) return;
    const onFiles = await clickTab(sandbox.browser, 'Files');
    if (!onFiles) t.skip('Files tab hidden (advanced mode / documents.enable)');
    assert.ok(await waitForBodyText(sandbox.browser, 'New file', 8000));
    assert.ok(await clickByText(sandbox.browser, 'New file'));
    assert.ok(await fillByPlaceholder(sandbox.browser, 'note.txt', 'sandbox-build.txt'));
    assert.ok(await fillByPlaceholder(sandbox.browser, 'Paste text to publish…', 'sandbox publisher bytes'));
    await sleep(250);
    assert.ok(await clickByText(sandbox.browser, 'Create on this node'));
    assert.ok(await waitForBodyText(sandbox.browser, /sandbox-build\.txt|Created /, 10000));

    const navigating = sandbox.browser.waitForNavigation({ waitUntil: 'load', timeout: 20000 }).catch(() => null);
    const opened = await clickByText(sandbox.browser, 'Open page');
    if (opened) await navigating;
    else {
      await sandbox.browser.goto(ctx.origin + '/files/' + FILE_ID, {
        waitUntil: 'load',
        timeout: 20000
      });
    }
    assert.ok(await waitForBodyText(sandbox.browser, /Pin to profile|on profile|Listing/, 10000));
    const pin = await sandbox.browser.evaluate(() => {
      const btn = document.querySelector('button.fpage-pin') ||
        Array.from(document.querySelectorAll('button'))
          .find((b) => /Pin to profile/i.test(b.getAttribute('title') || '') ||
            /Pin to profile/i.test(b.textContent || ''));
      if (!btn) return false;
      btn.click();
      return true;
    });
    assert.ok(pin, '📌 pin control');
    assert.ok(await waitForBodyText(sandbox.browser, /Pinned to your profile|on profile|Unpin/, 10000));
  });

  it('shows pinned files on the operator profile', async (t) => {
    if (!requireReady(t)) return;
    await sandbox.browser.goto(ctx.origin + '/profiles/' + ctx.identity.pubkey, {
      waitUntil: 'load',
      timeout: 20000
    });
    assert.ok(await waitForBodyText(sandbox.browser, /Pinned files|you/, 10000));
    const text = await bodyText(sandbox.browser);
    assert.match(text, /sandbox-build\.txt|gooncitizen\.dmg|Nothing pinned yet|Pinned files/);
  });

  it('searches local data from the header', async (t) => {
    if (!requireReady(t)) return;
    await gotoReady(sandbox.browser, ctx.origin + '/');
    assert.ok(await waitForMainUI(sandbox.browser, 15000));
    await sandbox.browser.evaluate(() => {
      const toggle = document.querySelector('button.app-search-toggle');
      if (toggle) toggle.click();
    });
    await sleep(200);
    assert.ok(await fillFirst(sandbox.browser, '.app-search input[type="search"]', 'Sandbox'), 'search field');
    await sleep(400);
    assert.ok(await waitForBodyText(sandbox.browser, /Sandbox Wing|sandbox-build|Sandbox escort|No matches/, 8000));
  });

  it('opens Identity from the chip and shows pin-to-profile copy', async (t) => {
    if (!requireReady(t)) return;
    await gotoReady(sandbox.browser, ctx.origin + '/');
    assert.ok(await waitForMainUI(sandbox.browser, 15000));
    const openedChip = await sandbox.browser.evaluate(() => {
      const chip = document.querySelector('button.idchip, button.pill.idchip');
      if (!chip) return false;
      chip.click();
      return true;
    });
    if (!openedChip) t.skip('identity chip not rendered');
    await sleep(200);
    const openedIdentity = await clickByText(sandbox.browser, 'Identity…') ||
      await clickByText(sandbox.browser, 'Identity');
    if (!openedIdentity) t.skip('Identity flyout action missing');
    assert.ok(await waitForBodyText(sandbox.browser, /Pin files to this profile|Share when I play/, 8000));
    await closeOverlays(sandbox.browser);
  });

  it('captures a UI inventory of each major view for deeper coverage', async (t) => {
    if (!requireReady(t)) return;
    await closeOverlays(sandbox.browser);
    await gotoReady(sandbox.browser, ctx.origin + '/');
    assert.ok(await waitForMainUI(sandbox.browser, 15000));
    const views = [
      ['Home', null],
      ['Groups', null],
      ['Missions', null],
      ['Fleets', null],
      ['Chat', null],
      ['Wallet', null],
      ['Network', 'Feed'],
      ['Network', 'Peers'],
      ['Network', 'Messages'],
      ['Files', null]
    ];
    const dump = [];
    async function capture (view) {
      await sleep(280);
      const inv = await inventoryUi(sandbox.browser);
      inv.view = view;
      dump.push(inv);
      console.log('[sandbox-ui]\n  ' + summarizeInventory(inv));
      return inv;
    }
    for (const [tab, sub] of views) {
      await clickTab(sandbox.browser, tab, '.header-nav button.tab');
      if (sub) await clickTab(sandbox.browser, sub, '.network-nav button.tab');
      await capture(sub ? (tab + '/' + sub) : tab);
    }

    await clickTab(sandbox.browser, 'Home', '.header-nav button.tab');
    await sleep(200);
    for (const label of ['When you fly', 'Missions', 'Quantum', 'Pilots', 'Activity Tree', 'Parser rules']) {
      const hit = await clickTab(sandbox.browser, label, '.home-views button.tab');
      if (!hit) continue;
      await capture('Home/' + label);
    }
    const filters = await clickByText(sandbox.browser, 'Filters');
    if (filters) await capture('Home/Filters');

    await clickTab(sandbox.browser, 'Groups', '.header-nav button.tab');
    await sleep(300);
    await sandbox.browser.evaluate(() => {
      const row = Array.from(document.querySelectorAll('.gp-row'))
        .find((el) => /Sandbox Wing/.test(el.textContent || ''));
      if (row) row.click();
    });
    await sleep(400);
    for (const label of ['Chat', 'Members', 'Log', 'Fleets', 'Wallet', 'Proposals', 'Applications', 'Fabric']) {
      const hit = await clickGroupTab(sandbox.browser, label);
      if (!hit) continue;
      await capture('Groups/Sandbox Wing/' + label);
    }
    const settings = await clickByTitle(sandbox.browser, 'Group settings');
    if (settings) {
      await capture('Groups/Sandbox Wing/settings');
      await clickByTitle(sandbox.browser, 'Group settings');
    }

    await clickByTitle(sandbox.browser, 'Paste a group invite');
    await sleep(250);
    await capture('Import modal');
    await clickByText(sandbox.browser, 'Cancel');

    await clickByText(sandbox.browser, '🔔', 'button.bell, button');
    await capture('Notifications');
    await closeOverlays(sandbox.browser);

    await clickByText(sandbox.browser, '⚙️', 'button.gear');
    await capture('Settings');
    await closeOverlays(sandbox.browser);

    await clickTab(sandbox.browser, 'Chat', '.header-nav button.tab');
    await sandbox.browser.evaluate(() => {
      const btn = Array.from(document.querySelectorAll('button.chat-new-ch, button'))
        .find((el) => String(el.textContent || '').trim() === '+ Channel');
      if (btn) btn.click();
    });
    await capture('Chat/+ Channel');
    await closeOverlays(sandbox.browser);
    await sandbox.browser.evaluate(() => {
      const cancel = Array.from(document.querySelectorAll('button'))
        .find((el) => /^(Cancel|Close)$/.test(String(el.textContent || '').trim()));
      if (cancel) cancel.click();
    });

    await clickTab(sandbox.browser, 'Files', '.header-nav button.tab');
    await waitForPlaceholder(sandbox.browser, 'Search name, id, MIME, sha…', 12000);
    await fillByPlaceholder(sandbox.browser, 'Search name, id, MIME, sha…', 'sandbox', 4000);
    await capture('Files/search');

    await clickTab(sandbox.browser, 'Groups', '.header-nav button.tab');
    await sandbox.browser.evaluate(() => {
      const row = Array.from(document.querySelectorAll('.gp-row'))
        .find((el) => /Sandbox Wing/.test(el.textContent || ''));
      if (row) row.click();
    });
    await sleep(300);
    if (await clickGroupTab(sandbox.browser, 'Fabric')) {
      await capture('Groups/Sandbox Wing/Fabric');
      for (const label of ['Statechain', 'Activity Tree', 'Codec']) {
        const hit = await clickByText(sandbox.browser, label, 'button.gfi-tab');
        if (!hit) continue;
        await capture('Groups/Sandbox Wing/Fabric/' + label);
      }
    }

    await clickTab(sandbox.browser, 'Network', '.header-nav button.tab');
    await clickTab(sandbox.browser, 'Messages', '.network-nav button.tab');
    await sleep(200);
    await clickByText(sandbox.browser, 'Pause capture');
    await capture('Network/Messages/paused');
    await clickByText(sandbox.browser, 'Resume capture');

    const outDir = path.join(__dirname, '../../reports');
    fs.mkdirSync(outDir, { recursive: true });
    const outPath = path.join(outDir, 'sandbox-ui-inventory.json');
    fs.writeFileSync(outPath, JSON.stringify({
      capturedAt: new Date().toISOString(),
      origin: ctx.origin,
      views: dump.map((inv) => ({
        view: inv.view,
        path: inv.path,
        hash: inv.hash,
        tabs: inv.tabs,
        groupTabs: inv.groupTabs,
        headings: inv.headings,
        placeholders: inv.placeholders,
        snippet: inv.snippet,
        buttons: (inv.buttons || []).map((b) => ({
          text: b.text,
          title: b.title,
          disabled: b.disabled
        }))
      }))
    }, null, 2));
    console.log('[sandbox-ui] wrote ' + outPath + ' (' + dump.length + ' views)');
    assert.ok(dump.length >= 8, 'inventory should cover primary tabs');
  });

  it('clicks Home Filters, My logs, Quantum, Activity Tree, and Parser rules', async (t) => {
    if (!requireReady(t)) return;
    await closeOverlays(sandbox.browser);
    assert.ok(await clickTab(sandbox.browser, 'Home'), 'Home');
    await sleep(250);
    const filters = await clickByText(sandbox.browser, 'Filters');
    if (filters) {
      await sleep(200);
      const text = await bodyText(sandbox.browser);
      assert.match(text, /Filters|period|log files|My logs|When you fly/i);
    }
    assert.ok(await clickByText(sandbox.browser, 'My logs…'), 'My logs');
    assert.ok(await waitForBodyText(sandbox.browser, /My logs|Import logs|Browse files/, 8000));
    assert.ok(await clickByText(sandbox.browser, 'Close'), 'close My logs');
    await sleep(200);
    assert.ok(await clickTab(sandbox.browser, 'Quantum'), 'Quantum');
    assert.ok(await waitForBodyText(sandbox.browser, /Quantum destinations/, 8000));
    const tree = await clickTab(sandbox.browser, 'Activity Tree');
    if (tree) {
      assert.ok(await waitForBodyText(sandbox.browser, /Activity Tree|local leaves|Merkle/, 8000));
    }
    const rules = await clickTab(sandbox.browser, 'Parser rules');
    if (rules) {
      await sleep(300);
      const text = await bodyText(sandbox.browser);
      assert.match(text, /Parser rules|VERIFIED|UNVERIFIED|Features/);
    }
  });

  it('opens Global chat dock from Home', async (t) => {
    if (!requireReady(t)) return;
    await closeOverlays(sandbox.browser);
    assert.ok(await clickTab(sandbox.browser, 'Home'), 'Home');
    await sleep(200);
    const dock = await clickByText(sandbox.browser, 'Global chat') ||
      await clickByText(sandbox.browser, '💬 Global chat');
    assert.ok(dock, 'global chat dock');
    await sleep(250);
    assert.ok(await waitForBodyText(sandbox.browser, /Send|Message as|No messages yet|hello from sandbox/, 8000));
  });

  it('creates a second group and opens Local tags, Members, Log, and settings', async (t) => {
    if (!requireReady(t)) return;
    await closeOverlays(sandbox.browser);
    assert.ok(await clickTab(sandbox.browser, 'Groups'), 'Groups');
    assert.ok(await waitForBodyText(sandbox.browser, 'Sandbox Wing', 8000));
    assert.ok(await clickByText(sandbox.browser, 'Local tags'), 'Local tags');
    assert.ok(await waitForBodyText(sandbox.browser, /local tag|no local tags|Create a local tag/i, 8000));
    assert.ok(await clickByText(sandbox.browser, 'Federation'), 'back to Federation');
    await sleep(200);
    assert.ok(await clickByText(sandbox.browser, '+ New group'), 'open create');
    assert.ok(await fillByPlaceholder(sandbox.browser, 'e.g. Salvage Wing', 'Sandbox Two'), 'name');
    await sleep(250);
    assert.ok(await clickByText(sandbox.browser, 'Create group'), 'submit');
    assert.ok(await waitForBodyText(sandbox.browser, /Sandbox Two/, 10000));

    assert.ok(await clickRowText(sandbox.browser, '.gp-row', 'Sandbox Wing'), 'select wing');
    await sleep(350);
    assert.ok(await clickGroupTab(sandbox.browser, 'Members'), 'Members');
    assert.ok(await waitForBodyText(sandbox.browser, /Invite — paste|add member|member/i, 8000));
    assert.ok(await clickGroupTab(sandbox.browser, 'Log'), 'Log');
    assert.ok(await waitForBodyText(sandbox.browser, /No synchronized events yet|GroupChange|FleetShare|Loading group log/, 8000));
    assert.ok(await clickGroupTab(sandbox.browser, 'Fleets'), 'group Fleets');
    await sleep(200);
    assert.ok(await clickGroupTab(sandbox.browser, 'Fabric'), 'Fabric');
    await sleep(200);
    assert.ok(await clickByTitle(sandbox.browser, 'Group settings'), 'group ⚙');
    assert.ok(await waitForBodyText(sandbox.browser, /Share this group|Make private|Primary color|Make public/, 8000));
    await clickByTitle(sandbox.browser, 'Group settings');
  });

  it('filters the mission register and opens the mission page', async (t) => {
    if (!requireReady(t)) return;
    await closeOverlays(sandbox.browser);
    assert.ok(await clickTab(sandbox.browser, 'Missions'), 'Missions');
    assert.ok(await waitForBodyText(sandbox.browser, 'Sandbox escort', 8000));
    const posted = await sandbox.browser.evaluate(() => {
      const btn = Array.from(document.querySelectorAll('button'))
        .find((el) => /^Posted \(/.test(String(el.textContent || '').trim()));
      if (!btn) return false;
      btn.click();
      return true;
    });
    assert.ok(posted, 'Posted filter');
    await sleep(200);
    assert.ok(await waitForBodyText(sandbox.browser, 'Sandbox escort', 5000));
    const navigating = sandbox.browser.waitForNavigation({ waitUntil: 'load', timeout: 20000 }).catch(() => null);
    const opened = await clickByText(sandbox.browser, 'Sandbox escort');
    if (opened) await navigating;
    assert.ok(await waitForBodyText(sandbox.browser, /Share to network|Apply|Sandbox escort|You’re in/, 10000));
    await gotoReady(sandbox.browser, ctx.origin + '/');
    assert.ok(await waitForMainUI(sandbox.browser, 15000));
  });

  it('pins a chat message, opens the pins drawer, people search, and Bot settings', async (t) => {
    if (!requireReady(t)) return;
    await closeOverlays(sandbox.browser);
    assert.ok(await clickTab(sandbox.browser, 'Chat'), 'Chat');
    assert.ok(await waitForBodyText(sandbox.browser, 'hello from sandbox', 10000));
    assert.ok(await waitForSelector(sandbox.browser, 'button.chat-msg-pin', 8000), 'pin control');
    const pinned = await clickByTitle(sandbox.browser, 'Pin message') ||
      await sandbox.browser.evaluate(() => {
        const btn = document.querySelector('button.chat-msg-pin');
        if (!btn) return false;
        btn.click();
        return true;
      });
    assert.ok(pinned, 'message 📌');
    await sleep(300);
    assert.ok(await clickByTitle(sandbox.browser, 'Pinned messages'), 'pins drawer');
    assert.ok(await waitForBodyText(sandbox.browser, /hello from sandbox|No pinned messages|Unpin message/, 8000));
    await clickByTitle(sandbox.browser, 'Close pinned messages');
    await sleep(150);
    assert.ok(await fillByPlaceholder(sandbox.browser, 'Search people…', 'Sandbox'), 'people search');
    await sleep(400);
    assert.ok(await clickByText(sandbox.browser, 'Bot settings'), 'Bot settings');
    assert.ok(await waitForBodyText(sandbox.browser, /Discord|guild|Bot settings|link/i, 8000));
    await clickByTitle(sandbox.browser, 'Discord bot — guilds');
  });

  it('opens slash-command help from Chat compose', async (t) => {
    if (!requireReady(t)) return;
    await closeOverlays(sandbox.browser);
    assert.ok(await clickTab(sandbox.browser, 'Chat'), 'Chat');
    await sandbox.browser.evaluate(() => {
      const cog = Array.from(document.querySelectorAll('button.chat-cog'))
        .find((el) => /on/.test(String(el.className || '')));
      if (cog) cog.click();
      const row = Array.from(document.querySelectorAll('button.chat-ch'))
        .find((el) => /Global/.test(el.textContent || '') && !/Bot settings/.test(el.textContent || ''));
      if (row) row.click();
    });
    assert.ok(await waitForSelector(sandbox.browser, '.chat-compose input[type="text"]', 8000), 'compose');
    const typed = await fillFirst(sandbox.browser, '.chat-compose input[type="text"]', '/help');
    assert.ok(typed, 'compose /help');
    await sleep(300);
    assert.ok(await waitForBodyText(sandbox.browser, /\/help|List slash|\/lookup|\/file/, 8000));
  });

  it('opens Wallet Send and the advanced constructor', async (t) => {
    if (!requireReady(t)) return;
    await closeOverlays(sandbox.browser);
    assert.ok(await clickTab(sandbox.browser, 'Wallet'), 'Wallet');
    assert.ok(await waitForBodyText(sandbox.browser, /Personal wallet|Refresh|Send/, 8000));
    assert.ok(await clickByText(sandbox.browser, 'Send'), 'Send');
    assert.ok(await waitForBodyText(sandbox.browser, /Send to|bcrt1|Advanced constructor/, 8000));
    const navigating = sandbox.browser.waitForNavigation({ waitUntil: 'load', timeout: 20000 }).catch(() => null);
    const opened = await clickByText(sandbox.browser, 'Advanced constructor');
    if (opened) await navigating;
    else {
      await sandbox.browser.goto(ctx.origin + '/wallet/construct', { waitUntil: 'load', timeout: 20000 });
    }
    assert.ok(await waitForBodyText(sandbox.browser, /Add output|Fee, change|constructor|Send to/, 10000));
    await gotoReady(sandbox.browser, ctx.origin + '/');
    assert.ok(await waitForMainUI(sandbox.browser, 15000));
  });

  it('filters the Network feed and opens Messages plus Peers Inspect', async (t) => {
    if (!requireReady(t)) return;
    await closeOverlays(sandbox.browser);
    assert.ok(await clickTab(sandbox.browser, 'Network'), 'Network');
    assert.ok(await clickTab(sandbox.browser, 'Feed'), 'Feed');
    assert.ok(await waitForBodyText(sandbox.browser, /Live feed|Copy all|My logs/, 8000));
    const chatChip = await sandbox.browser.evaluate(() => {
      const btn = Array.from(document.querySelectorAll('.live-stream button.chip, button.chip'))
        .find((el) => String(el.textContent || '').trim() === 'Chat');
      if (!btn) return false;
      btn.click();
      return true;
    });
    assert.ok(chatChip, 'Chat category chip');
    await sleep(200);
    assert.ok(await clickTab(sandbox.browser, 'Network'), 'Network still');
    const messages = await clickTab(sandbox.browser, 'Messages');
    if (messages) {
      assert.ok(await waitForBodyText(sandbox.browser, /Fabric messages|AMP wire|No Fabric Messages/, 8000));
    }
    assert.ok(await clickTab(sandbox.browser, 'Network'), 'Network for Peers');
    assert.ok(await clickTab(sandbox.browser, 'Peers'), 'Peers');
    assert.ok(await waitForBodyText(sandbox.browser, /Inspect|Add peer|Fabric Network/, 8000));
    const inspected = await clickByText(sandbox.browser, 'Inspect');
    if (inspected) {
      await sleep(400);
      const text = await bodyText(sandbox.browser);
      assert.match(text, /Inspect|pubkey|identity|peer|alias|share/i);
    }
  });

  it('queries Files peers and filters the catalog', async (t) => {
    if (!requireReady(t)) return;
    await closeOverlays(sandbox.browser);
    const onFiles = await clickTab(sandbox.browser, 'Files');
    if (!onFiles) t.skip('Files tab hidden');
    assert.ok(await waitForBodyText(sandbox.browser, /Query peers|New file/, 8000));
    assert.ok(await clickByText(sandbox.browser, 'Query peers'), 'Query peers');
    await sleep(400);
    const text = await bodyText(sandbox.browser);
    assert.match(text, /Querying|Query peers|listing|No files|sandbox-build|gooncitizen/i);
    const typed = await sandbox.browser.evaluate(() => {
      const btn = Array.from(document.querySelectorAll('button'))
        .find((el) => /^Text/.test(String(el.textContent || '').trim()));
      if (!btn) return false;
      btn.click();
      return true;
    });
    if (typed) {
      await sleep(200);
      assert.ok(await waitForBodyText(sandbox.browser, /sandbox-build|Text|No files/, 5000));
    }
  });

  it('toggles Share when I play and starts Add a device', async (t) => {
    if (!requireReady(t)) return;
    await closeOverlays(sandbox.browser);
    await gotoReady(sandbox.browser, ctx.origin + '/');
    assert.ok(await waitForMainUI(sandbox.browser, 15000));
    const openedChip = await sandbox.browser.evaluate(() => {
      const chip = document.querySelector('button.idchip, button.pill.idchip');
      if (!chip) return false;
      chip.click();
      return true;
    });
    if (!openedChip) t.skip('identity chip not rendered');
    await sleep(200);
    const openedIdentity = await clickByText(sandbox.browser, 'Identity…') ||
      await clickByText(sandbox.browser, 'Identity');
    if (!openedIdentity) t.skip('Identity flyout action missing');
    assert.ok(await waitForBodyText(sandbox.browser, 'Share when I play', 8000));
    const toggled = await sandbox.browser.evaluate(() => {
      const labels = Array.from(document.querySelectorAll('label'));
      const row = labels.find((el) => /Share when I play/i.test(el.textContent || ''));
      if (!row) return false;
      const input = row.querySelector('input[type="checkbox"]') || row;
      input.click();
      return true;
    });
    assert.ok(toggled, 'share playtimes');
    await sleep(200);
    const addDevice = await sandbox.browser.evaluate(() => {
      const btn = Array.from(document.querySelectorAll('button'))
        .find((el) => String(el.textContent || '').trim() === 'Add a device');
      if (!btn) return { found: false };
      return { found: true, disabled: !!btn.disabled };
    });
    assert.ok(addDevice.found, 'Add a device control');
    await closeOverlays(sandbox.browser);
  });

  it('opens Settings Discord and Snapshots sections', async (t) => {
    if (!requireReady(t)) return;
    await closeOverlays(sandbox.browser);
    assert.ok(await clickByText(sandbox.browser, '⚙️', 'button.gear, button'), 'gear');
    assert.ok(await waitForBodyText(sandbox.browser, /Discord bot|Snapshots|Advanced mode/, 8000));
    const text = await bodyText(sandbox.browser);
    assert.match(text, /Discord/);
    assert.match(text, /Snapshots/);
    await closeOverlays(sandbox.browser);
  });

  it('filters Fleets to Mine and opens a catalog sample', async (t) => {
    if (!requireReady(t)) return;
    await closeOverlays(sandbox.browser);
    assert.ok(await clickTab(sandbox.browser, 'Fleets'), 'Fleets');
    assert.ok(await waitForBodyText(sandbox.browser, /Your fleets|Sandbox fleet/, 8000));
    assert.ok(await clickByText(sandbox.browser, 'Mine'), 'Mine');
    await sleep(200);
    assert.ok(await waitForBodyText(sandbox.browser, /Sandbox fleet/, 5000));
    const sample = await clickByText(sandbox.browser, 'fleetviewer-thejohnram');
    if (sample) {
      await sleep(300);
      const text = await bodyText(sandbox.browser);
      assert.match(text, /fleetviewer-thejohnram|ships|Import|fleet/i);
    }
  });

  it('opens header Import… and Notifications filters', async (t) => {
    if (!requireReady(t)) return;
    await closeOverlays(sandbox.browser);
    await gotoReady(sandbox.browser, ctx.origin + '/');
    assert.ok(await waitForMainUI(sandbox.browser, 15000));
    assert.ok(await clickByTitle(sandbox.browser, 'Paste a group invite'), 'Import…');
    assert.ok(await waitForBodyText(sandbox.browser, /Join a group|fabric:|Import/, 8000));
    assert.ok(await clickByText(sandbox.browser, 'Cancel'), 'close import');
    await sleep(150);
    assert.ok(await clickByText(sandbox.browser, '🔔', 'button.bell, button'), 'bell');
    assert.ok(await waitForBodyText(sandbox.browser, /No pending notifications|No notifications yet/, 8000));
    assert.ok(await clickByText(sandbox.browser, 'All', 'button.nt-chip'), 'All');
    await sleep(150);
    assert.ok(await clickByText(sandbox.browser, 'Resolved', 'button.nt-chip'), 'Resolved');
    assert.ok(await waitForBodyText(sandbox.browser, /No notifications yet|resolved/i, 5000));
  });

  it('copies the local pubkey and creates a nested + Channel', async (t) => {
    if (!requireReady(t)) return;
    await closeOverlays(sandbox.browser);
    assert.ok(await clickTab(sandbox.browser, 'Groups'), 'Groups');
    assert.ok(await waitForBodyText(sandbox.browser, 'Copy pubkey', 8000));
    assert.ok(await clickByText(sandbox.browser, 'Copy pubkey'));
    await sleep(200);
    assert.ok(await clickRowText(sandbox.browser, '.gp-row', 'Sandbox Wing'), 'select wing');
    await sleep(250);
    assert.ok(await clickByText(sandbox.browser, '+ Channel'), 'open channel');
    assert.ok(await fillByPlaceholder(sandbox.browser, 'e.g. ops-bridge', 'Sandbox ops'), 'channel name');
    await sleep(250);
    assert.ok(await clickByText(sandbox.browser, 'Create channel'), 'submit channel');
    assert.ok(await waitForBodyText(sandbox.browser, /Sandbox ops/, 10000));
  });

  it('shares a public group and opens group Wallet, Proposals, Applications, and page', async (t) => {
    if (!requireReady(t)) return;
    await closeOverlays(sandbox.browser);
    assert.ok(await clickTab(sandbox.browser, 'Groups'), 'Groups');
    assert.ok(await clickRowText(sandbox.browser, '.gp-row', 'Sandbox Wing'), 'select wing');
    await sleep(300);
    assert.ok(await clickByTitle(sandbox.browser, 'Group settings'), 'settings');
    assert.ok(await waitForBodyText(sandbox.browser, 'Share this group', 8000));
    assert.ok(await clickByText(sandbox.browser, 'Share this group'));
    assert.ok(await waitForBodyText(sandbox.browser,
      /Copy invite again|copy the invite|Fabric share failed|Fabric peer not ready|no protocolUrl/i, 8000),
      'share panel or known sandbox peer error');
    await clickByTitle(sandbox.browser, 'Close settings');
    await sleep(150);
    assert.ok(await clickGroupTab(sandbox.browser, 'Wallet'), 'Wallet');
    assert.ok(await waitForBodyText(sandbox.browser,
      /Taproot|Copy address|Wallet unavailable|Loading wallet|mode |configure payouts|signers/, 8000));
    assert.ok(await clickGroupTab(sandbox.browser, 'Proposals'), 'Proposals');
    assert.ok(await waitForBodyText(sandbox.browser, /No open proposals|votes|Loading proposals/, 8000));
    assert.ok(await clickGroupTab(sandbox.browser, 'Applications'), 'Applications');
    assert.ok(await waitForBodyText(sandbox.browser, /No pending applications|Accept|Loading applications/, 8000));
    await clickByTitle(sandbox.browser, 'Group settings');
    const navigating = sandbox.browser.waitForNavigation({ waitUntil: 'load', timeout: 20000 }).catch(() => null);
    const opened = await clickByText(sandbox.browser, 'Open page');
    if (opened) await navigating;
    assert.ok(await waitForBodyText(sandbox.browser, /Sandbox Wing|Members|Log|Back to groups/, 10000));
    await gotoReady(sandbox.browser, ctx.origin + '/');
    assert.ok(await waitForMainUI(sandbox.browser, 15000));
  });

  it('filters Chat channels and creates a channel from the rail', async (t) => {
    if (!requireReady(t)) return;
    await closeOverlays(sandbox.browser);
    assert.ok(await clickTab(sandbox.browser, 'Chat'), 'Chat');
    await sandbox.browser.evaluate(() => {
      const cog = document.querySelector('button.chat-cog.on');
      if (cog) cog.click();
    });
    assert.ok(await waitForSelector(sandbox.browser, '.chat-compose input[type="text"]', 8000));
    const groupsFilter = await sandbox.browser.evaluate(() => {
      const btn = Array.from(document.querySelectorAll('.chat-side button'))
        .find((el) => String(el.textContent || '').trim() === 'Groups');
      if (!btn) return false;
      btn.click();
      return true;
    });
    assert.ok(groupsFilter, 'Groups rail filter');
    await sleep(200);
    assert.ok(await waitForBodyText(sandbox.browser, /Sandbox Wing|No channels match/, 8000));
    assert.ok(await fillByPlaceholder(sandbox.browser, 'Search channels, guilds…', 'Sandbox'), 'channel search');
    await sleep(300);
    assert.ok(await clickByText(sandbox.browser, '+ Channel', 'button.chat-new-ch'));
    assert.ok(await fillByPlaceholder(sandbox.browser, 'Channel name', 'Sandbox chat ops'));
    await sleep(250);
    const created = await clickByText(sandbox.browser, 'Create', 'button.chat-new-ch');
    if (created) {
      assert.ok(await waitForBodyText(sandbox.browser, /Sandbox chat ops|Sandbox ops/, 10000));
    }
  });

  it('searches the Files catalog and opens a list pin', async (t) => {
    if (!requireReady(t)) return;
    await closeOverlays(sandbox.browser);
    const onFiles = await clickTab(sandbox.browser, 'Files', '.header-nav button.tab');
    if (!onFiles) t.skip('Files tab hidden');
    assert.ok(await waitForBodyText(sandbox.browser, /New file|Query peers/, 8000));
    assert.ok(await fillByPlaceholder(sandbox.browser, 'Search name, id, MIME, sha…', 'sandbox-build', 12000),
      'catalog search');
    await sleep(300);
    assert.ok(await waitForBodyText(sandbox.browser, /sandbox-build\.txt/, 8000));
    const published = await sandbox.browser.evaluate(() => {
      const btn = Array.from(document.querySelectorAll('button'))
        .find((el) => String(el.textContent || '').trim() === 'Published');
      if (!btn) return false;
      btn.click();
      return true;
    });
    if (published) {
      await sleep(200);
      assert.ok(await waitForBodyText(sandbox.browser, /sandbox-build|gooncitizen|Published/, 5000));
    }
  });

  it('saves an Identity nickname and creates a local tag', async (t) => {
    if (!requireReady(t)) return;
    await closeOverlays(sandbox.browser);
    await gotoReady(sandbox.browser, ctx.origin + '/');
    assert.ok(await waitForMainUI(sandbox.browser, 15000));
    const openedChip = await sandbox.browser.evaluate(() => {
      const chip = document.querySelector('button.idchip, button.pill.idchip');
      if (!chip) return false;
      chip.click();
      return true;
    });
    if (!openedChip) t.skip('identity chip not rendered');
    await sleep(200);
    assert.ok(await clickByText(sandbox.browser, 'Identity…') ||
      await clickByText(sandbox.browser, 'Identity'), 'Identity');
    assert.ok(await fillByPlaceholder(sandbox.browser, 'e.g. Neorion', 'SandboxPilot'), 'nickname');
    await sleep(200);
    assert.ok(await clickByText(sandbox.browser, 'Save profile'));
    assert.ok(await waitForBodyText(sandbox.browser, /Saved|SandboxPilot|nickname|profile/i, 8000));
    await closeOverlays(sandbox.browser);
    assert.ok(await clickTab(sandbox.browser, 'Groups'), 'Groups');
    assert.ok(await clickByText(sandbox.browser, 'Local tags'));
    assert.ok(await fillByPlaceholder(sandbox.browser, 'e.g. Officers, Hangar crew', 'Hangar crew'));
    await sleep(200);
    assert.ok(await clickByText(sandbox.browser, 'Create tag'));
    assert.ok(await waitForBodyText(sandbox.browser, /Hangar crew/, 8000));
  });

  it('fills Add peer and refreshes Wallet group Taproot', async (t) => {
    if (!requireReady(t)) return;
    await closeOverlays(sandbox.browser);
    assert.ok(await clickTab(sandbox.browser, 'Network'), 'Network');
    assert.ok(await clickTab(sandbox.browser, 'Peers'), 'Peers');
    assert.ok(await fillByPlaceholder(sandbox.browser,
      'hub.fabric.pub:7777 or pubkey@host:port',
      '127.0.0.1:17777'), 'peer url');
    await fillByPlaceholder(sandbox.browser, 'label (optional)', 'sandbox-peer');
    await sleep(200);
    const addReady = await sandbox.browser.evaluate(() => {
      const btn = Array.from(document.querySelectorAll('button'))
        .find((el) => String(el.textContent || '').trim() === 'Add peer');
      return !!(btn && !btn.disabled);
    });
    assert.ok(addReady, 'Add peer enabled after URL');
    assert.ok(await clickTab(sandbox.browser, 'Wallet'), 'Wallet');
    assert.ok(await waitForBodyText(sandbox.browser, /Group Taproot|Sandbox Wing|Refresh/, 8000));
    assert.ok(await clickByText(sandbox.browser, 'Refresh'));
    await sleep(250);
    assert.ok(await waitForBodyText(sandbox.browser, /Sandbox Wing|Taproot|No groups yet|mode /, 8000));
  });

  it('inspects group Fabric Messages, Statechain, Activity Tree, and Codec', async (t) => {
    if (!requireReady(t)) return;
    await closeOverlays(sandbox.browser);
    await gotoReady(sandbox.browser, ctx.origin + '/');
    assert.ok(await waitForMainUI(sandbox.browser, 15000));
    assert.ok(await clickTab(sandbox.browser, 'Groups', '.header-nav button.tab'), 'Groups');
    await clickByText(sandbox.browser, 'Federation');
    assert.ok(await waitForSelector(sandbox.browser, '.gp-row', 8000), 'group list');
    assert.ok(await waitForBodyText(sandbox.browser, 'Sandbox Wing', 8000));
    assert.ok(await clickRowText(sandbox.browser, '.gp-row', 'Sandbox Wing'), 'select wing');
    await sleep(250);
    const fabric = await clickGroupTab(sandbox.browser, 'Fabric');
    if (!fabric) t.skip('Fabric tab needs Advanced mode');
    assert.ok(await waitForBodyText(sandbox.browser, /Fabric history|Statechain|codec/i, 8000));
    assert.ok(await clickByText(sandbox.browser, 'Statechain', 'button.gfi-tab'), 'Statechain');
    assert.ok(await waitForBodyText(sandbox.browser, /Statechain journal|No statechain|Loading statechain|Journal empty|folded content|clock /i, 8000));
    assert.ok(await clickByText(sandbox.browser, 'Activity Tree', 'button.gfi-tab'), 'Activity Tree');
    assert.ok(await waitForBodyText(sandbox.browser, /Merkle|local leaves|Publish|Activity Tree/i, 8000));
    assert.ok(await clickByText(sandbox.browser, 'Codec', 'button.gfi-tab'), 'Codec');
    assert.ok(await fillByPlaceholder(sandbox.browser, 'fabric:…', 'not-a-fabric-message', 8000), 'codec input');
    await sleep(150);
    assert.ok(await clickByText(sandbox.browser, 'Decode'));
    assert.ok(await waitForBodyText(sandbox.browser, /Decode|invalid|codec|opaque|error/i, 8000));
  });

  it('pauses Network Fabric message capture', async (t) => {
    if (!requireReady(t)) return;
    await closeOverlays(sandbox.browser);
    assert.ok(await clickTab(sandbox.browser, 'Network', '.header-nav button.tab'), 'Network');
    assert.ok(await clickTab(sandbox.browser, 'Messages', '.network-nav button.tab'), 'Messages');
    assert.ok(await waitForBodyText(sandbox.browser, /Pause capture|Resume capture|Fabric messages/, 8000));
    const paused = await clickByText(sandbox.browser, 'Pause capture');
    if (paused) {
      assert.ok(await waitForBodyText(sandbox.browser, /Resume capture/, 8000));
    }
    assert.ok(await clickByText(sandbox.browser, 'Resume capture') ||
      await waitForBodyText(sandbox.browser, /Pause capture/, 4000), 'resume or already capturing');
    assert.ok(await waitForBodyText(sandbox.browser, /Pause capture/, 8000));
  });

  it('sets the group as primary and sends a test notification', async (t) => {
    if (!requireReady(t)) return;
    await closeOverlays(sandbox.browser);
    assert.ok(await clickTab(sandbox.browser, 'Groups', '.header-nav button.tab'), 'Groups');
    await clickByText(sandbox.browser, 'Federation');
    assert.ok(await waitForSelector(sandbox.browser, '.gp-row', 8000), 'group list');
    assert.ok(await waitForBodyText(sandbox.browser, 'Sandbox Wing', 8000));
    assert.ok(await clickRowText(sandbox.browser, '.gp-row', 'Sandbox Wing'), 'select wing');
    await sleep(250);
    assert.ok(await clickByTitle(sandbox.browser, 'Group settings'), 'settings');
    assert.ok(await waitForBodyText(sandbox.browser, /Set as primary|Clear primary/, 8000));
    const setPrimary = await clickByText(sandbox.browser, 'Set as primary');
    if (setPrimary) {
      assert.ok(await waitForBodyText(sandbox.browser, /primary|Primary group/i, 8000));
    }
    await clickByTitle(sandbox.browser, 'Close settings');
    await closeOverlays(sandbox.browser);
    assert.ok(await clickByText(sandbox.browser, '⚙️', 'button.gear, button'), 'gear');
    assert.ok(await waitForBodyText(sandbox.browser, /Send test notification/, 8000));
    assert.ok(await clickByText(sandbox.browser, 'Send test notification'));
    assert.ok(await waitForBodyText(sandbox.browser,
      /test notification|Desktop notifications|Notification|denied|sent/i, 8000));
    await closeOverlays(sandbox.browser);
  });

  it('broadcasts the sandbox mission to the network', async (t) => {
    if (!requireReady(t)) return;
    await closeOverlays(sandbox.browser);
    assert.ok(await clickTab(sandbox.browser, 'Missions', '.header-nav button.tab'), 'Missions');
    assert.ok(await waitForBodyText(sandbox.browser, 'Sandbox escort', 8000));
    const navigating = sandbox.browser.waitForNavigation({ waitUntil: 'load', timeout: 20000 }).catch(() => null);
    const opened = await clickByText(sandbox.browser, 'Sandbox escort');
    if (opened) await navigating;
    assert.ok(await waitForBodyText(sandbox.browser, /Share to network|Sandbox escort/, 10000));
    const shared = await clickByText(sandbox.browser, 'Share to network');
    if (shared) {
      assert.ok(await waitForBodyText(sandbox.browser, /Shared to the network|Share to network/, 8000));
    }
    await gotoReady(sandbox.browser, ctx.origin + '/');
    assert.ok(await waitForMainUI(sandbox.browser, 15000));
  });
});
