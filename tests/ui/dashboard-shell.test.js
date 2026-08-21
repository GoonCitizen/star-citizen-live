'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

require('../helpers/installReactStub');
const { textOf, findType, findByClass, collect } = require('../helpers/reactTree');
const Dashboard = require('../../components/Dashboard');
const Chat = require('../../components/Chat');

describe('Dashboard shell UI', () => {
  it('exposes Chat CSS, title, and a Chat tab in the shell', () => {
    assert.match(Dashboard.TITLE, /GoonCitizen/);
    assert.match(Dashboard.CSS, /chat/i);
    assert.match(Chat.CSS, /\.chat-plat/);
    assert.match(Chat.CSS, /\.discord-ch/);

    const dash = new Dashboard({});
    dash.state.tab = 'home';
    dash.state.online = true;
    dash.state.status = 'ok';
    const home = dash.render();
    assert.ok(textOf(home).includes('Chat'));

    dash.state.tab = 'chat';
    const chatView = dash.render();
    assert.ok(findType(chatView, Chat).length >= 1);
  });

  it('reserves a bottom chrome band for the shoutbox dock and future voice bar', () => {
    assert.match(Dashboard.CSS, /--chrome-bottom/);
    assert.match(Dashboard.CSS, /--chrome-inset/);
    assert.match(Dashboard.CHROME_CSS, /padding-bottom:\s*var\(--chrome-bottom\)/);
    assert.match(Dashboard.CHROME_CSS, /body\.chat-fill #root/);
    assert.match(Dashboard.CSS, /body\.chat-fill #root\{[^}]*padding-bottom:\s*var\(--chrome-bottom\)/);
  });

  it('keeps the header from overflowing on narrow screens', () => {
    assert.match(Dashboard.CSS, /@media\(max-width:720px\)/);
    assert.match(Dashboard.CSS, /\.ctrl\{[^}]*flex-wrap:wrap/);
    assert.match(Dashboard.CSS, /\.header-nav \.row\.tabs\{[^}]*min-width:0/);
    assert.match(Dashboard.CSS, /\.gear\{/);
    assert.match(Dashboard.CSS, /\.qrscan\{/);
    assert.match(Dashboard.CSS, /\.syncstat\{/);
  });

  it('puts All logs, My logs, Filters, and a logs cog on the Home title row', () => {
    try { localStorage.removeItem('gooncitizen.homeLogScope'); } catch (_) { /* ignore */ }
    const dash = new Dashboard({});
    dash.state.tab = 'home';
    dash.state.online = true;
    dash.state.status = 'ok';
    const tree = dash.render();
    const text = textOf(tree);
    assert.match(text, /cumulative history from your logs/);
    assert.match(text, /All logs/);
    assert.match(text, /My logs/);
    assert.match(text, /Filters/);
    assert.match(text, /Log files and import/);
    assert.match(text, /Missions/);
    assert.match(text, /Quantum/);
    assert.doesNotMatch(text, /When you fly/);
    assert.equal(dash.state.azLogScope, 'all', 'first-time default is all public data');
    const tools = findByClass(tree, 'home-tools')[0];
    assert.ok(tools);
    const buttons = collect(tools, (n) => n && n.$$typeof === 'element' && n.type === 'button');
    assert.ok(buttons.length >= 4);
    assert.match(textOf(buttons[0]), /All logs/);
    assert.match(textOf(buttons[1]), /My logs/);
    assert.match(textOf(buttons[2]), /Filters/);
    const cog = buttons[buttons.length - 1];
    assert.match(String(cog.props.className || ''), /home-logs-gear/);
    assert.equal(cog.props['aria-label'], 'Log files and import');
    assert.match(Dashboard.CSS, /\.panel h2 \.home-tools/);
    assert.match(Dashboard.CSS, /\.panel h2 \.home-tools \.gear/);
  });

  it('defaults Home analytics to all logs and can filter to this node’s corpus', () => {
    try { localStorage.removeItem('gooncitizen.homeLogScope'); } catch (_) { /* ignore */ }
    const dash = new Dashboard({});
    dash.state.tab = 'home';
    dash.state.azLoading = false;
    dash.state.analytics = {
      missions: [
        { ts: '2026-08-01T12:00:00Z', player: 'Me', type: 'Bounty', faction: 'ADF', outcome: 'Complete', source: 'local' },
        { ts: '2026-08-01T13:00:00Z', player: 'Peer', type: 'Bounty', faction: 'ADF', outcome: 'Complete', source: '02ab' },
        { ts: '2026-08-01T14:00:00Z', player: 'Legacy', type: 'Bounty', faction: 'ADF', outcome: 'Complete' }
      ],
      deaths: [],
      sessions: [],
      quantum: [],
      incap: [],
      crimestat: [],
      heatcells: [],
      availableMonths: ['2026-08'],
      players: ['Me', 'Peer', 'Legacy'],
      sources: { fileCount: 1 }
    };
    assert.equal(dash.state.azLogScope, 'all');
    const all = dash.buildAnalyzeModel();
    assert.equal(all.msMain.length, 3);

    dash.setHomeLogScope('mine');
    assert.equal(dash.state.azLogScope, 'mine');
    assert.equal(localStorage.getItem('gooncitizen.homeLogScope'), 'mine');
    const mine = dash.buildAnalyzeModel();
    assert.deepStrictEqual(mine.msMain.map((m) => m.player).sort(), ['Legacy', 'Me']);
    assert.ok(mine.af.some((f) => f[0] === 'azLogScope'));

    dash.setHomeLogScope('all');
    assert.equal(localStorage.getItem('gooncitizen.homeLogScope'), null);
    const reset = dash.buildAnalyzeModel();
    assert.equal(reset.msMain.length, 3);

    dash.state.homeFiltersOpen = true;
    const fly = textOf(dash.render());
    assert.match(fly, /period/);
    assert.match(fly, /All logs/);
    assert.match(fly, /import via the logs cog/);
  });

  it('shows an indexing hint while historySync is running', () => {
    const dash = new Dashboard({});
    dash.state.tab = 'home';
    dash.state.online = true;
    dash.state.status = 'STARTED';
    dash.state.historySync = { status: 'running', fileIndex: 2, files: 40 };
    const text = textOf(dash.render());
    assert.match(text, /Indexing 2\/40 logs/);
  });

  it('does not crash Home when hosted analytics returns 401 JSON', () => {
    const dash = new Dashboard({});
    dash.state.tab = 'home';
    dash.state.online = true;
    dash.state.status = 'ok';
    dash.state.azLoading = false;
    dash.state.analytics = {
      error: 'Authentication required (POST …/auth with a signed login envelope)'
    };
    assert.doesNotThrow(() => dash.render());
    assert.equal(dash.buildAnalyzeModel(), null);
    assert.match(textOf(dash.render()), /no activity history yet/);
  });
});

describe('Built dashboard bundle', () => {
  const htmlPath = path.join(__dirname, '../../assets/index.html');
  const built = fs.existsSync(htmlPath);

  it('inlines Discord chat insight styles and copy', { skip: !built }, () => {
    const html = fs.readFileSync(htmlPath, 'utf8');
    for (const needle of [
      'chat-plat',
      'GoonCitizen',
      'Search local data',
      'When you fly',
      'chat.catalog',
      'wpage-hero',
      'Advanced constructor',
      'Public shoutbox',
      'gpage-hero',
      'Apply to join',
      'mmap-hero',
      'lpage-hero',
      '--chrome-bottom',
      'var(--chrome-inset'
    ]) {
      assert.ok(html.includes(needle), 'bundle missing ' + needle);
    }
    assert.ok(/Bot settings|Discord bot/.test(html), 'bundle missing Discord bot copy');
  });
});
