'use strict';

/**
 * Keyless delegation hosting (`@fabric/core` docs/DELEGATION.md): the
 * pairing rendezvous (`/delegations`) and the mailbox
 * (`/services/delegation/mailbox`). Both carry signed frames only and check
 * them in `@fabric/http`; they hold no key and need no unlocked identity, so
 * `relay.goon.vc` serves them like a Hub does.
 *
 * Frames posted for this app's own player go straight to its participant
 * (`deliver`) instead of waiting in the queue.
 */

/** @private */
function load () {
  try {
    return {
      rendezvous: require('@fabric/http/functions/fabricDelegationHttp'),
      mailbox: require('@fabric/http/functions/fabricDelegationMailbox')
    };
  } catch (_) {
    return null;
  }
}

/**
 * @param {Object} [options]
 * @param {string[]} [options.origins] Public origins the rendezvous answers for (any when empty).
 * @param {boolean} [options.trustProxy] Behind Caddy / Nginx: rate-limit by the last forwarded hop.
 * @param {Object} [options.store] `{ get, set }` so queued mail survives a restart.
 * @param {Function} [options.deliver] `(to, buffer) => boolean`; true takes the frame.
 * @param {Function} [options.now]
 * @returns {{ available: boolean, handle: function(object, object): Promise<boolean> }}
 */
function createDelegationHost (options = {}) {
  const mods = load();
  if (!mods) return { available: false, handle: async () => false };
  const origins = (options.origins || []).filter(Boolean);
  const rendezvous = mods.rendezvous.createDelegationRendezvous({
    origins: origins.length ? origins : undefined,
    trustProxy: !!options.trustProxy,
    now: options.now
  });
  const mailbox = mods.mailbox.createDelegationMailbox({
    store: options.store,
    trustProxy: !!options.trustProxy,
    now: options.now,
    deliver: (to, buffer) => (typeof options.deliver === 'function' ? options.deliver(to, buffer) : false)
  });
  if (options.store) mailbox.load().catch(() => {});
  return {
    available: true,
    async handle (req, res) {
      if (await rendezvous.handle(req, res)) return true;
      return mailbox.handle(req, res);
    }
  };
}

module.exports = { createDelegationHost };
