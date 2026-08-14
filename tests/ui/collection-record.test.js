'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert');

require('../helpers/installReactStub');
const { textOf } = require('../helpers/reactTree');
const CollectionRecord = require('../../components/CollectionRecord');

describe('CollectionRecord page', () => {
  it('renders a search hit as a dedicated collection entity', () => {
    const page = new CollectionRecord({ kind: 'note', recordId: 'n1' });
    page.state.loading = false;
    page.state.error = null;
    page.state.detail = {
      kind: 'note',
      id: 'n1',
      title: 'Nights-only gunner',
      subtitle: 'Note on Cara',
      href: '/collections/note/n1',
      record: { id: 'n1', subject: 'discord:u1', body: 'Nights-only gunner' },
      links: [{ rel: 'profile', href: '/profiles/discord%3Au1', title: 'Cara' }],
      actions: [{ rel: 'chat', title: 'Open in Chat', hash: 'chat', peopleQuery: 'Cara' }]
    };
    const text = textOf(page.render());
    assert.match(text, /Nights-only gunner/);
    assert.match(text, /Note/);
    assert.match(text, /Open in Chat/);
    assert.match(text, /Cara/);
  });
});
