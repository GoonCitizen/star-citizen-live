'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert');

require('../helpers/installReactStub');
const { textOf, findType, findByClass, classList } = require('../helpers/reactTree');
const Dashboard = require('../../components/Dashboard');
const ActiveVoicePanel = require('../../components/ActiveVoicePanel');
const Settings = require('../../components/Settings');
const VoiceSettingsPanel = require('../../components/VoiceSettingsPanel');
const Chat = require('../../components/Chat');
const MissionBroadcastBanner = require('../../components/MissionBroadcastBanner');

describe('Active voice chrome', () => {
  it('mounts the panel on every dashboard tab', () => {
    const dash = new Dashboard({});
    dash.state.online = true;
    dash.state.status = 'ok';
    dash.state.tab = 'home';
    assert.strictEqual(findType(dash.render(), ActiveVoicePanel).length, 1);
    dash.state.tab = 'chat';
    assert.strictEqual(findType(dash.render(), ActiveVoicePanel).length, 1);
  });

  it('hides the bar until a room is joined', () => {
    const panel = new ActiveVoicePanel({});
    assert.strictEqual(panel.render(), null);
    panel.state.voice = {
      joined: true,
      groupId: 'g1',
      groupName: 'Salvage Wing',
      cap: 8,
      members: [{ pubkey: '02aa', webrtcPeerId: 'gv-a', speaking: true }],
      settings: { mode: 'ptt', pttKey: { shift: true, code: 'Backquote' } }
    };
    const text = textOf(panel.render());
    assert.match(text, /Salvage Wing/);
    assert.match(text, /Mute/);
    assert.match(text, /Shift\+Backtick/);
    assert.match(text, /Leave/);
    const dots = findByClass(panel.render(), 'avp-dot');
    assert.ok(dots.some((n) => classList(n).includes('on')));
  });

  it('offers Join voice on a group chat header', () => {
    const chat = new Chat({ identityPubkey: '02aa', nickname: 'Neorion', groupId: 'group-1' });
    chat.state.loading = false;
    chat.state.page = 'messages';
    chat.state.channels = [{ key: 'group:group-1', label: 'Salvage', kind: 'group', groupId: 'group-1' }];
    chat.state.channel = 'group:group-1';
    const tree = chat.render();
    const join = findType(tree, ActiveVoicePanel.JoinVoiceButton);
    assert.ok(join.length >= 1);
    assert.strictEqual(join[0].props.groupId, 'group-1');
    const btn = new ActiveVoicePanel.JoinVoiceButton(join[0].props);
    assert.match(textOf(btn.render()), /Join voice/);
  });

  it('does not offer Join voice on a group channel the viewer is not in', () => {
    const chat = new Chat({ identityPubkey: '02' + 'aa'.repeat(32) });
    chat.state.loading = false;
    chat.state.page = 'messages';
    chat.state.channels = [{
      key: 'group:group-1',
      label: 'Salvage',
      kind: 'group',
      groupId: 'group-1',
      creator: '02' + 'bb'.repeat(32),
      members: ['02' + 'bb'.repeat(32)]
    }];
    chat.state.channel = 'group:group-1';
    assert.strictEqual(findType(chat.render(), ActiveVoicePanel.JoinVoiceButton).length, 0);
  });

  it('does not offer Join voice on the public shoutbox', () => {
    const chat = new Chat({ identityPubkey: '02aa' });
    chat.state.loading = false;
    chat.state.page = 'messages';
    chat.state.channels = [{ key: 'global', label: 'Global', kind: 'global' }];
    chat.state.channel = 'global';
    assert.strictEqual(findType(chat.render(), ActiveVoicePanel.JoinVoiceButton).length, 0);
  });

  it('raises mission banners above the voice bar', () => {
    assert.match(MissionBroadcastBanner.CSS, /mbb-stack\.raised/);
    assert.match(ActiveVoicePanel.CSS, /bottom:\s*var\(--chrome-inset/);
  });
});

describe('Settings voice', () => {
  it('defaults to push-to-talk', () => {
    const page = new Settings({});
    page.state.loading = false;
    page.state.editable = true;
    const tree = page.renderVoice();
    const nested = findType(tree, VoiceSettingsPanel);
    assert.strictEqual(nested.length, 1);
    const inner = new VoiceSettingsPanel(nested[0].props);
    const text = textOf(tree) + ' ' + textOf(inner.render());
    assert.match(text, /Push-to-talk/);
    assert.match(text, /Shift\+Tab/);
    assert.match(text, /Rebind/);
    assert.match(text, /hub\.fabric\.pub/);
  });
});
