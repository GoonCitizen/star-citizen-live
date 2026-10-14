'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const EventEmitter = require('../../functions/browserEvents');

describe('browserEvents', () => {
  it('is a constructable EventEmitter (Identity extends require(events))', () => {
    assert.equal(typeof EventEmitter, 'function');
    class Sub extends EventEmitter {}
    const s = new Sub();
    let n = 0;
    s.on('tick', () => { n += 1; });
    s.emit('tick');
    assert.equal(n, 1);
    assert.equal(EventEmitter.EventEmitter, EventEmitter);
  });
});
