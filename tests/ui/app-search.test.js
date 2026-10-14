'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert');

require('../helpers/installReactStub');
const { textOf, findType, collect } = require('../helpers/reactTree');
const Dashboard = require('../../components/Dashboard');
const AppSearch = require('../../components/AppSearch');

describe('Dashboard application search', () => {
  it('places Search local data on the tabs row under the identity chip', () => {
    assert.match(Dashboard.CSS, /\.header-nav/);
    assert.match(Dashboard.CSS, /\.app-search/);

    const dash = new Dashboard({});
    dash.state.tab = 'home';
    dash.state.online = true;
    dash.state.status = 'ok';
    const tree = dash.render();
    assert.strictEqual(findType(tree, AppSearch).length, 1);
    const search = new AppSearch(findType(tree, AppSearch)[0].props);
    assert.ok(textOf(search.render()).includes('Search local data'));
    assert.ok(textOf(tree).includes('Chat'));
  });

  it('collapses to a search icon when startCollapsed is set', () => {
    assert.match(AppSearch.CSS, /\.app-search\.collapsed/);
    assert.match(AppSearch.CSS, /max-width:\s*720px/);
    const search = new AppSearch({ startCollapsed: true });
    const tree = search.render();
    assert.ok(String(tree.props.className).includes('collapsed'));
    assert.ok(textOf(tree).includes('Search local data'));
    const hasInput = (tree.children || []).some((n) => n && n.props && n.props.type === 'search');
    assert.strictEqual(hasInput, false);
    search.setState({ collapsed: false });
    const open = search.render();
    assert.ok(String(open.props.className).includes('expanded'));
    assert.ok((open.children || []).some((n) => n && n.props && n.props.className === 'app-search-field'));
  });

  it('renders pack hits in the dropdown', () => {
    const search = new AppSearch({});
    search.state.query = 'cara';
    search.state.open = true;
    search.state.loading = false;
    search.state.hits = [{
      kind: 'person',
      label: 'Person',
      id: 'discord:u1',
      title: 'Cara',
      subtitle: 'Fleet Ops',
      href: '/profiles/' + encodeURIComponent('discord:u1')
    }];
    const tree = search.render();
    const text = textOf(tree);
    assert.ok(text.includes('Cara'));
    assert.ok(text.includes('Person'));
    assert.ok(text.includes('Fleet Ops'));
    const links = collect(tree, (n) => n && n.$$typeof === 'element' && n.type === 'a');
    assert.ok(links.some((n) => String(n.props.href).includes('/profiles/')));
    assert.ok(links.every((n) => String(n.props.className || '').includes('app-search-hit')));
  });

  it('shows an empty-query hint and no-match copy', () => {
    assert.match(AppSearch.CSS, /text-decoration:\s*none/);
    const search = new AppSearch({});
    search.state.query = '';
    search.state.open = true;
    assert.match(textOf(search.render()), /Search people, notes, Discord servers/);

    search.state.query = 'zzz-no-hit';
    search.state.loading = false;
    search.state.hits = [];
    search.state.error = null;
    assert.match(textOf(search.render()), /No local matches/);
  });
});
