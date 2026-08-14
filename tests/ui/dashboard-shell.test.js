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
  });
});

describe('Built dashboard bundle', () => {
  const htmlPath = path.join(__dirname, '../../assets/index.html');
  const built = fs.existsSync(htmlPath);

  it('inlines Discord chat insight styles and copy', { skip: !built }, () => {
    const html = fs.readFileSync(htmlPath, 'utf8');
    assert.match(html, /chat-plat/);
    assert.match(html, /Bot settings|Discord bot/);
    assert.match(html, /GoonCitizen/);
    assert.match(html, /Search local data/);
    assert.match(html, /Share when I play/);
    assert.match(html, /chat\.catalog/);
  });
});
