'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const LiveRelay = require('../../services/LiveRelay');

async function startRelay (logfile) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sc-live-poll-'));
  const svc = new LiveRelay({
    port: 0,
    listen: false,
    mode: 'relay',
    settingsDir: dir,
    logfile: logfile || null,
    fabric: { enable: false, listen: false, port: 0, peers: [] },
    missions: { enable: false },
    discord: { enable: false }
  });
  await svc.start();
  if (svc._pollTimer) {
    clearTimeout(svc._pollTimer);
    svc._pollTimer = null;
  }
  return { svc, dir };
}

function waitCycle (svc) {
  return new Promise((resolve) => {
    const orig = svc._scheduleNextPoll.bind(svc);
    svc._scheduleNextPoll = function () {
      svc._scheduleNextPoll = orig;
      orig();
      if (svc._pollTimer) {
        clearTimeout(svc._pollTimer);
        svc._pollTimer = null;
      }
      resolve();
    };
    svc._poll();
  });
}

describe('LiveRelay Game.log poller', () => {
  it('returns immediately when stopped or logfile is unset', async () => {
    const { svc, dir } = await startRelay(null);
    try {
      svc.settings.logfile = null;
      svc._poll();
      svc.state.status = 'STOPPED';
      svc.settings.logfile = '/tmp/does-not-matter.log';
      svc._poll();
      assert.equal(svc._pollTimer, null);
    } finally {
      svc.state.status = 'STARTED';
      await svc.stop();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('retries when the log is missing, then consumes new lines', async () => {
    const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'sc-live-log-'));
    const logfile = path.join(parent, 'Game.log');
    const { svc, dir } = await startRelay(null);
    try {
      svc.settings.logfile = logfile;
      svc._pos = 0;
      svc._ino = null;
      await waitCycle(svc);

      fs.writeFileSync(logfile, '<2026-08-12T12:00:00.000Z> [Notice] <UnknownTag> first line\n');
      svc._pos = 0;
      await waitCycle(svc);
      assert.ok(svc._pos > 0);

      const restarts = [];
      svc.on('session:restart', (ev) => restarts.push(ev));
      fs.writeFileSync(logfile, 'short\n');
      await waitCycle(svc);
      assert.equal(restarts.length, 1);
    } finally {
      await svc.stop();
      fs.rmSync(dir, { recursive: true, force: true });
      fs.rmSync(parent, { recursive: true, force: true });
    }
  });
});
