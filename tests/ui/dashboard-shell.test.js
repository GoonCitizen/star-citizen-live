'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

require('../helpers/installReactStub');
const { textOf, findType } = require('../helpers/reactTree');
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

  it('keeps the header from overflowing on narrow screens', () => {
    assert.match(Dashboard.CSS, /@media\(max-width:720px\)/);
    assert.match(Dashboard.CSS, /\.ctrl\{[^}]*flex-wrap:wrap/);
    assert.match(Dashboard.CSS, /\.header-nav \.row\.tabs\{[^}]*min-width:0/);
    assert.match(Dashboard.CSS, /\.gear\{/);
    assert.match(Dashboard.CSS, /\.qrscan\{/);
    assert.match(Dashboard.CSS, /\.syncstat\{/);
  });

  it('puts My logs and Filters on the Home title row', () => {
    const dash = new Dashboard({});
    dash.state.tab = 'home';
    dash.state.online = true;
    dash.state.status = 'ok';
    const tree = dash.render();
    const text = textOf(tree);
    assert.match(text, /cumulative history from your logs/);
    assert.match(text, /My logs/);
    assert.match(text, /Filters/);
    assert.match(Dashboard.CSS, /\.panel h2 \.home-tools/);
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
      'Share when I play',
      'chat.catalog',
      'wpage-hero',
      'Advanced constructor',
      'Public shoutbox',
      'gpage-hero',
      'Apply to join',
      'mmap-hero',
      'lpage-hero'
    ]) {
      assert.ok(html.includes(needle), 'bundle missing ' + needle);
    }
    assert.ok(/Bot settings|Discord bot/.test(html), 'bundle missing Discord bot copy');
  });
});
