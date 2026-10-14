'use strict';

/**
 * Boot-time Fabric listen port and peer seeds from env + settings/local.js.
 * FABRIC_PORT wins. Used by scripts/node.js for both SC_MODE=server and local
 * relay so a public seed can stay on :7777 and seed Hub without self-dial.
 */

function fabricListenPort (opts = {}) {
  const env = opts.env || process.env;
  const local = opts.localSettings || {};
  const fromEnv = Number(env.FABRIC_PORT);
  if (Number.isFinite(fromEnv) && fromEnv > 0) return fromEnv;
  const fromLocal = Number(local.fabric && local.fabric.port);
  if (Number.isFinite(fromLocal) && fromLocal > 0) return fromLocal;
  return 7777;
}

/**
 * Constructor peer roster from `settings/local.js` `fabric.peers`.
 * `undefined` leaves LiveRelay on DEFAULT_PEERS (first boot). An explicit
 * array (including empty) is passed through so a relay can seed Hub only.
 * @returns {Array|undefined}
 */
function fabricPeerSeeds (opts = {}) {
  const local = opts.localSettings || {};
  const raw = local.fabric && local.fabric.peers;
  if (!Array.isArray(raw)) return undefined;
  return raw.map((row) => (
    typeof row === 'string' ? { address: row, enabled: true } : row
  ));
}

function fabricBootBlock (opts = {}) {
  const env = opts.env || process.env;
  const local = opts.localSettings || {};
  const enable = env.SC_FABRIC === '0' ? false : true;
  const peers = fabricPeerSeeds(opts);
  const block = {
    enable,
    listen: opts.listen != null ? !!opts.listen : enable,
    port: fabricListenPort(opts),
    interface: opts.resolveInterface
      ? opts.resolveInterface({
        interface: local.fabric && local.fabric.interface,
        env
      })
      : (local.fabric && local.fabric.interface) || undefined
  };
  if (peers !== undefined) block.peers = peers;
  return block;
}

module.exports = {
  fabricListenPort,
  fabricPeerSeeds,
  fabricBootBlock
};
