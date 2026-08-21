'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const groupVoiceSettings = require('../../functions/groupVoiceSettings');
const groupVoice = require('../../functions/groupVoice');

describe('groupVoiceSettings', () => {
  it('defaults to push-to-talk on Shift+Tab', () => {
    const v = groupVoiceSettings.defaultVoiceSettings();
    assert.equal(v.mode, 'ptt');
    assert.equal(v.pttKey.code, 'Tab');
    assert.equal(v.pttKey.shift, true);
    assert.equal(groupVoiceSettings.pttBindLabel(v.pttKey), 'Shift+Tab');
    assert.equal(groupVoiceSettings.electronAccelerator(v.pttKey), 'Shift+Tab');
  });

  it('matches a Shift+Tab keyboard event', () => {
    assert.equal(groupVoiceSettings.matchesPttKey({
      shiftKey: true, altKey: false, ctrlKey: false, metaKey: false, code: 'Tab', key: 'Tab'
    }), true);
    assert.equal(groupVoiceSettings.matchesPttKey({
      shiftKey: false, altKey: false, ctrlKey: false, metaKey: false, code: 'Tab', key: 'Tab'
    }), false);
  });

  it('still matches a stored Shift+Backquote bind', () => {
    const bind = { shift: true, alt: false, ctrl: false, meta: false, code: 'Backquote' };
    assert.equal(groupVoiceSettings.matchesPttKey({
      shiftKey: true, altKey: false, ctrlKey: false, metaKey: false, code: 'Backquote', key: '~'
    }, bind), true);
  });

  it('builds a bind from a capture event', () => {
    const bind = groupVoiceSettings.bindFromKeyboardEvent({
      shiftKey: true, altKey: false, ctrlKey: false, metaKey: false, code: 'KeyV', key: 'V'
    });
    assert.equal(bind.code, 'KeyV');
    assert.equal(bind.shift, true);
    assert.equal(groupVoiceSettings.pttBindLabel(bind), 'Shift+V');
  });
});

describe('voice PTT OS keys', () => {
  const { pollSpec } = require('../../functions/voicePttOsKeys');
  it('maps Shift+Tab for macOS and Windows pollers', () => {
    const spec = pollSpec({ shift: true, alt: false, ctrl: false, meta: false, code: 'Tab' });
    assert.equal(spec.darwin.main, 48);
    assert.deepEqual(spec.darwin.shift, [56, 60]);
    assert.equal(spec.win32.main, 0x09);
    assert.deepEqual(spec.win32.shift, [0x10]);
  });
});

describe('groupVoice presence', () => {
  const me = '02' + 'ab'.repeat(32);
  const other = '03' + 'cd'.repeat(32);
  const stranger = '02' + 'ef'.repeat(32);
  const group = { id: 'g1', members: [me, other], includes (pk) { return this.members.includes(pk); } };

  it('gates join on membership and caps the room', () => {
    const state = groupVoice.emptyRooms();
    const denied = groupVoice.applyJoin(state, { groupId: 'g1', pubkey: stranger, group });
    assert.equal(denied.ok, false);
    const ok = groupVoice.applyJoin(state, { groupId: 'g1', pubkey: me, group });
    assert.equal(ok.ok, true);
    assert.equal(ok.member.webrtcPeerId.startsWith('gv-'), true);
    const full = groupVoice.emptyRooms();
    for (let i = 0; i < groupVoice.ROOM_CAP; i++) {
      const pk = '02' + String(i).padStart(2, '0').repeat(32);
      groupVoice.applyJoin(full, { groupId: 'g1', pubkey: pk });
    }
    const overflow = groupVoice.applyJoin(full, { groupId: 'g1', pubkey: me });
    assert.equal(overflow.ok, false);
    assert.match(overflow.error, /full/);
  });

  it('resolves the roster key among local identity candidates', () => {
    const wallet = '02' + '11'.repeat(32);
    const publisher = '03' + '22'.repeat(32);
    const g = {
      id: 'g1',
      creator: wallet,
      members: [wallet],
      includes (pk) { return this.members.includes(pk); }
    };
    assert.equal(groupVoice.resolveVoiceActor(g, [publisher]), null);
    assert.equal(groupVoice.resolveVoiceActor(g, [publisher, wallet]), wallet);
    const linked = (a, b) => (a === wallet && b === publisher) || (a === publisher && b === wallet);
    assert.equal(groupVoice.resolveVoiceActor(g, [publisher], linked), wallet);
  });

  it('drops non-member Join frames', () => {
    const state = groupVoice.emptyRooms();
    const out = groupVoice.ingestFrame(state, groupVoice.JOIN, {
      groupId: 'g1',
      webrtcPeerId: 'gv-nope'
    }, stranger, { group });
    assert.equal(out.ok, false);
  });

  it('lets the earlier joiner offer', () => {
    assert.equal(groupVoice.shouldOffer(
      { webrtcPeerId: 'gv-a', joinedAt: 1 },
      { webrtcPeerId: 'gv-b', joinedAt: 2 }
    ), true);
    assert.equal(groupVoice.shouldOffer(
      { webrtcPeerId: 'gv-b', joinedAt: 2 },
      { webrtcPeerId: 'gv-a', joinedAt: 1 }
    ), false);
  });
});
