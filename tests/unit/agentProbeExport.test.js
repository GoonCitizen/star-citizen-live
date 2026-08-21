'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  writeAgentProbe,
  redactSecrets,
  publishAgentProbes,
  sanitizeProbeName
} = require('../../functions/agentProbeExport');

describe('agentProbeExport', () => {
  it('redacts token-like keys', () => {
    const out = redactSecrets({ token: 'abc', nested: { botToken: 'x', ok: 1 } });
    assert.strictEqual(out.token, '[redacted]');
    assert.strictEqual(out.nested.botToken, '[redacted]');
    assert.strictEqual(out.nested.ok, 1);
  });

  it('writes probe + index under a temp dir', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'probes-'));
    const { localPath, indexPath } = writeAgentProbe('discord-scheduled-events', {
      title: 'Discord events',
      guildId: 'g1',
      count: 1
    }, { env: { SC_AGENT_PROBE_DIR: dir } });
    assert.ok(fs.existsSync(localPath));
    assert.ok(fs.existsSync(indexPath));
    const body = JSON.parse(fs.readFileSync(localPath, 'utf8'));
    assert.strictEqual(body['@type'], 'GoonCitizenAgentProbe');
    assert.strictEqual(body.guildId, 'g1');
    const index = JSON.parse(fs.readFileSync(indexPath, 'utf8'));
    assert.strictEqual(index.count, 1);
    assert.strictEqual(index.probes[0].name, 'discord-scheduled-events');
  });

  it('publishes into SC_AGENT_STATIC_ROOT/probes', () => {
    const local = fs.mkdtempSync(path.join(os.tmpdir(), 'probes-local-'));
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'probes-www-'));
    writeAgentProbe('adversary-local-probe', { findings: [] }, {
      env: { SC_AGENT_PROBE_DIR: local }
    });
    const result = publishAgentProbes({
      env: {
        SC_AGENT_PROBE_DIR: local,
        SC_AGENT_STATIC_ROOT: root
      }
    });
    assert.ok(result.publishDir);
    assert.ok(fs.existsSync(path.join(root, 'probes', 'adversary-local-probe.json')));
    assert.ok(fs.existsSync(path.join(root, 'probes', 'index.json')));
  });

  it('rejects empty probe names', () => {
    assert.throws(() => sanitizeProbeName('***'));
  });
});
