'use strict';

/**
 * Agent probe JSON exports — local `reports/probes/` plus optional publish into
 * the live-network static root (relay.goon.vc `/probes/` via nginx/Caddy
 * document root, often `/var/www/goon.vc/html/probes`).
 *
 * Future agents: fetch https://relay.goon.vc/probes/index.json then the named
 * probe files. Never put tokens, seeds, or discord.secrets in these dumps.
 */

const fs = require('fs');
const path = require('path');

const DEFAULT_REL_DIR = path.join('reports', 'probes');

/**
 * @param {object} [opts]
 * @param {string} [opts.cwd]
 * @param {NodeJS.ProcessEnv} [opts.env]
 * @returns {string}
 */
function resolveProbeDir (opts = {}) {
  const env = opts.env || process.env;
  if (env.SC_AGENT_PROBE_DIR) return path.resolve(env.SC_AGENT_PROBE_DIR);
  const cwd = opts.cwd || process.cwd();
  return path.resolve(cwd, DEFAULT_REL_DIR);
}

/**
 * Live static document root for relay.goon.vc agent files (optional).
 * @param {object} [opts]
 * @returns {string|null}
 */
function resolvePublishRoot (opts = {}) {
  const env = opts.env || process.env;
  const raw = env.SC_AGENT_STATIC_ROOT || env.AGENT_PROBE_PUBLISH_ROOT || '';
  if (!String(raw).trim()) return null;
  return path.resolve(String(raw).trim());
}

/**
 * @param {string} name probe basename without .json
 * @returns {string}
 */
function sanitizeProbeName (name) {
  const s = String(name || '').trim().toLowerCase()
    .replace(/\.json$/i, '')
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '');
  if (!s || s === '.' || s === '..') throw new Error('invalid probe name');
  return s;
}

/**
 * Strip obvious secret-shaped fields before write.
 * @param {*} value
 * @param {number} [depth]
 * @returns {*}
 */
function redactSecrets (value, depth = 0) {
  if (depth > 12) return null;
  if (value == null) return value;
  if (Array.isArray(value)) return value.map((v) => redactSecrets(v, depth + 1));
  if (typeof value !== 'object') return value;
  const out = {};
  for (const [k, v] of Object.entries(value)) {
    if (/token|secret|password|mnemonic|xprv|seed|authorization|cookie/i.test(k)) {
      out[k] = typeof v === 'string' && v ? '[redacted]' : null;
      continue;
    }
    if (typeof v === 'string' && /^(xprv|xpub)[a-zA-Z0-9]+$/.test(v)) {
      out[k] = '[redacted]';
      continue;
    }
    out[k] = redactSecrets(v, depth + 1);
  }
  return out;
}

/**
 * Write one probe JSON + refresh index.json in the probe dir (and publish root).
 *
 * @param {string} name
 * @param {object} payload
 * @param {object} [opts]
 * @returns {{ localPath: string, publishPath: string|null, indexPath: string }}
 */
function writeAgentProbe (name, payload, opts = {}) {
  const probeName = sanitizeProbeName(name);
  const dir = resolveProbeDir(opts);
  fs.mkdirSync(dir, { recursive: true });

  const body = Object.assign(
    {
      '@type': 'GoonCitizenAgentProbe',
      name: probeName,
      generatedAt: new Date().toISOString()
    },
    redactSecrets(payload && typeof payload === 'object' ? payload : { value: payload })
  );
  if (!body.generatedAt) body.generatedAt = new Date().toISOString();
  body['@type'] = 'GoonCitizenAgentProbe';
  body.name = probeName;

  const localPath = path.join(dir, probeName + '.json');
  fs.writeFileSync(localPath, JSON.stringify(body, null, 2) + '\n');

  const indexPath = writeProbeIndex(dir);
  let publishPath = null;
  const publishRoot = resolvePublishRoot(opts);
  if (publishRoot) {
    const pubDir = path.join(publishRoot, 'probes');
    fs.mkdirSync(pubDir, { recursive: true });
    publishPath = path.join(pubDir, probeName + '.json');
    fs.writeFileSync(publishPath, fs.readFileSync(localPath));
    writeProbeIndex(pubDir, {
      publicBase: opts.publicBase || process.env.SC_AGENT_PROBE_PUBLIC_BASE ||
        'https://relay.goon.vc/probes'
    });
  }
  return { localPath, publishPath, indexPath };
}

/**
 * @param {string} dir
 * @param {object} [meta]
 * @returns {string} index path
 */
function writeProbeIndex (dir, meta = {}) {
  fs.mkdirSync(dir, { recursive: true });
  const files = fs.readdirSync(dir)
    .filter((f) => f.endsWith('.json') && f !== 'index.json')
    .sort();
  const probes = files.map((f) => {
    const full = path.join(dir, f);
    let generatedAt = null;
    let title = f.replace(/\.json$/i, '');
    try {
      const j = JSON.parse(fs.readFileSync(full, 'utf8'));
      generatedAt = j.generatedAt || j.at || j.fetchedAt || null;
      if (j.title) title = String(j.title);
      else if (j.name) title = String(j.name);
    } catch (_) { /* ignore */ }
    const st = fs.statSync(full);
    return {
      file: f,
      name: f.replace(/\.json$/i, ''),
      title,
      generatedAt,
      bytes: st.size,
      mtime: st.mtime.toISOString()
    };
  });
  const index = {
    '@type': 'GoonCitizenAgentProbeIndex',
    generatedAt: new Date().toISOString(),
    publicBase: meta.publicBase || null,
    count: probes.length,
    probes
  };
  const indexPath = path.join(dir, 'index.json');
  fs.writeFileSync(indexPath, JSON.stringify(index, null, 2) + '\n');
  return indexPath;
}

/**
 * Copy every probe JSON from local dir into publishRoot/probes/.
 * @param {object} [opts]
 * @returns {{ copied: string[], publishDir: string|null }}
 */
function publishAgentProbes (opts = {}) {
  const dir = resolveProbeDir(opts);
  const publishRoot = resolvePublishRoot(opts);
  if (!publishRoot) {
    return { copied: [], publishDir: null, error: 'SC_AGENT_STATIC_ROOT unset' };
  }
  const pubDir = path.join(publishRoot, 'probes');
  fs.mkdirSync(pubDir, { recursive: true });
  const copied = [];
  if (fs.existsSync(dir)) {
    for (const f of fs.readdirSync(dir)) {
      if (!f.endsWith('.json')) continue;
      fs.copyFileSync(path.join(dir, f), path.join(pubDir, f));
      copied.push(f);
    }
  }
  writeProbeIndex(pubDir, {
    publicBase: opts.publicBase || process.env.SC_AGENT_PROBE_PUBLIC_BASE ||
      'https://relay.goon.vc/probes'
  });
  return { copied, publishDir: pubDir };
}

module.exports = {
  DEFAULT_REL_DIR,
  resolveProbeDir,
  resolvePublishRoot,
  sanitizeProbeName,
  redactSecrets,
  writeAgentProbe,
  writeProbeIndex,
  publishAgentProbes
};
