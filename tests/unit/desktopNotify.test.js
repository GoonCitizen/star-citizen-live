'use strict';

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const {
  showDesktopNotification,
  ensureNotifyPermission
} = require('../../functions/desktopNotify');

describe('desktopNotify', () => {
  let prevWindow;
  let prevNotification;

  beforeEach(() => {
    prevWindow = global.window;
    prevNotification = global.Notification;
  });

  afterEach(() => {
    if (prevWindow === undefined) delete global.window;
    else global.window = prevWindow;
    if (prevNotification === undefined) delete global.Notification;
    else global.Notification = prevNotification;
  });

  it('no-ops in Node without Notification', async () => {
    delete global.window;
    delete global.Notification;
    assert.equal(await showDesktopNotification({ title: 'x' }), false);
    assert.equal(await ensureNotifyPermission(), 'unsupported');
  });

  it('prefers electronAPI.notify and maps action buttons', async () => {
    let payload = null;
    global.window = {
      electronAPI: {
        async notify (opts) {
          payload = opts;
          return { ok: true };
        }
      }
    };
    assert.equal(await ensureNotifyPermission(), 'granted');
    const shown = await showDesktopNotification({
      title: 'Inbox',
      body: 'Apply?',
      id: 'n1',
      kind: 'MissionBroadcast',
      actions: [{ text: 'Accept' }, { id: 'ignore' }]
    });
    assert.equal(shown, true);
    assert.equal(payload.title, 'Inbox');
    assert.equal(payload.body, 'Apply?');
    assert.equal(payload.id, 'n1');
    assert.equal(payload.kind, 'MissionBroadcast');
    assert.deepEqual(payload.actions, [
      { id: 'Accept', text: 'Accept' },
      { id: 'ignore', text: 'ignore' }
    ]);
  });

  it('falls through to Notification when electron notify throws', async () => {
    const made = [];
    function FakeNotification (title, opts) {
      made.push({ title, opts });
    }
    FakeNotification.permission = 'granted';
    global.Notification = FakeNotification;
    global.window = {
      electronAPI: {
        async notify () { throw new Error('ipc down'); }
      },
      focus () {}
    };
    assert.equal(await showDesktopNotification({ title: 'Hi', body: 'there' }), true);
    assert.equal(made.length, 1);
    assert.equal(made[0].title, 'Hi');
    assert.equal(made[0].opts.body, 'there');
  });

  it('requests browser permission when default and wires onClick', async () => {
    let requested = false;
    let clicked = false;
    function FakeNotification (title, opts) {
      this.title = title;
      this.opts = opts;
      this.onclick = null;
      FakeNotification.last = this;
    }
    FakeNotification.permission = 'default';
    FakeNotification.requestPermission = async () => {
      requested = true;
      FakeNotification.permission = 'granted';
      return 'granted';
    };
    global.Notification = FakeNotification;
    global.window = { focus () {} };
    const shown = await showDesktopNotification({
      title: 'Ping',
      onClick: () => { clicked = true; }
    });
    assert.equal(requested, true);
    assert.equal(shown, true);
    FakeNotification.last.onclick();
    assert.equal(clicked, true);
  });

  it('returns false when permission is denied or Notification throws', async () => {
    function Denied () {}
    Denied.permission = 'denied';
    global.Notification = Denied;
    global.window = {};
    assert.equal(await showDesktopNotification({ title: 'x' }), false);
    assert.equal(await ensureNotifyPermission(), 'denied');

    function Boom () { throw new Error('blocked'); }
    Boom.permission = 'granted';
    global.Notification = Boom;
    assert.equal(await showDesktopNotification({ title: 'x' }), false);
  });

  it('ensureNotifyPermission requests when default and maps request failures to denied', async () => {
    function FakeNotification () {}
    FakeNotification.permission = 'default';
    FakeNotification.requestPermission = async () => 'granted';
    global.Notification = FakeNotification;
    global.window = {};
    assert.equal(await ensureNotifyPermission(), 'granted');

    FakeNotification.requestPermission = async () => { throw new Error('no'); };
    FakeNotification.permission = 'default';
    assert.equal(await ensureNotifyPermission(), 'denied');
  });

  it('defaults the title to GoonCitizen', async () => {
    const made = [];
    function FakeNotification (title) { made.push(title); }
    FakeNotification.permission = 'granted';
    global.Notification = FakeNotification;
    global.window = {};
    await showDesktopNotification({});
    assert.equal(made[0], 'GoonCitizen');
  });
});
