'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert');

require('../helpers/installReactStub');
const { textOf, findByClass } = require('../helpers/reactTree');
const Chat = require('../../components/Chat');

describe('Chat message pins', () => {
  it('renders a pin control on each message and marks pinned rows', () => {
    const chat = new Chat({ identityPubkey: '02aa', nickname: 'Neorion' });
    chat.state.loading = false;
    chat.state.page = 'messages';
    chat.state.channels = [{ key: 'global', label: 'Global', kind: 'global' }];
    chat.state.channel = 'global';
    chat.state.messages = [
      {
        id: 'deadbeefcafebabe',
        author: '02aa',
        handle: 'Neorion',
        body: 'stand by',
        ts: '2026-08-13T12:00:00.000Z'
      },
      {
        id: 'cafebabedeadbeef',
        author: '02bb',
        handle: 'Wing',
        body: 'pinned brief',
        ts: '2026-08-13T12:01:00.000Z',
        pinned: true
      }
    ];
    const tree = chat.render();
    const pins = findByClass(tree, 'chat-msg-pin');
    assert.strictEqual(pins.length, 2);
    assert.strictEqual(pins[0].props['aria-pressed'], false);
    assert.strictEqual(pins[1].props['aria-pressed'], true);
    assert.ok(pins[1].props.className.includes('on'));
    const pinned = findByClass(tree, 'pinned');
    assert.ok(pinned.some((n) => (n.props.className || '').split(/\s+/).includes('chat-msg')));
    assert.ok(textOf(tree).includes('pinned brief'));
  });

  it('disables pin without an identity', () => {
    const chat = new Chat({});
    chat.state.loading = false;
    chat.state.page = 'messages';
    chat.state.channels = [{ key: 'global', label: 'Global', kind: 'global' }];
    chat.state.channel = 'global';
    chat.state.messages = [{
      id: 'deadbeefcafebabe',
      author: '02aa',
      body: 'hello',
      ts: '2026-08-13T12:00:00.000Z'
    }];
    const tree = chat.render();
    const pin = findByClass(tree, 'chat-msg-pin')[0];
    assert.ok(pin);
    assert.strictEqual(pin.props.disabled, true);
  });

  it('opens a pinned-messages drawer from the header control left of settings', () => {
    const chat = new Chat({ identityPubkey: '02aa', nickname: 'Neorion' });
    chat.state.loading = false;
    chat.state.page = 'messages';
    chat.state.channels = [{ key: 'global', label: 'Global', kind: 'global' }];
    chat.state.channel = 'global';
    chat.state.messages = [
      {
        id: 'deadbeefcafebabe',
        author: '02aa',
        handle: 'Neorion',
        body: 'stand by',
        ts: '2026-08-13T12:00:00.000Z'
      },
      {
        id: 'cafebabedeadbeef',
        author: '02bb',
        handle: 'Wing',
        body: 'pinned brief',
        ts: '2026-08-13T12:01:00.000Z',
        pinned: true
      }
    ];
    let tree = chat.render();
    const btn = findByClass(tree, 'chat-pins-btn')[0];
    assert.ok(btn);
    assert.strictEqual(btn.props['aria-pressed'], false);
    assert.ok(!findByClass(tree, 'chat-pins-drawer').length);

    chat.state.pinsOpen = true;
    tree = chat.render();
    const drawer = findByClass(tree, 'chat-pins-drawer')[0];
    assert.ok(drawer);
    const drawerText = textOf(drawer);
    assert.ok(drawerText.includes('pinned brief'));
    assert.ok(!drawerText.includes('stand by'));
    const rows = findByClass(tree, 'chat-pins-row');
    assert.strictEqual(rows.length, 1);
  });
});
