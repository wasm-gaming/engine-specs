// The first executable code this package has ever shipped, so the first tests that
// run rather than compile.
//
// Every case here is a claim the tsdoc makes. A comment saying "iterates a copy" is
// worth nothing to twelve engines; a test that fails when it stops being true is.
//
// It imports `dist/`, not `src/`, because what engines get is the built artifact —
// which is also why `make test` builds first.

import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from '../dist/engine-specs.js';

test('emits to every listener, with the payload under detail', () => {
  const events = new EventEmitter();
  const seen = [];
  events.on('start', (event) => seen.push(['a', event]));
  events.on('start', (event) => seen.push(['b', event]));
  events.emit('start', { slot: 1 });

  assert.deepEqual(seen, [
    ['a', { type: 'start', detail: { slot: 1 } }],
    ['b', { type: 'start', detail: { slot: 1 } }],
  ]);
});

test('the detail is the payload itself, identically — not a copy', () => {
  const events = new EventEmitter();
  const payload = { slot: 1 };
  let seen;
  events.on('start', (event) => (seen = event.detail));
  events.emit('start', payload);
  assert.equal(seen, payload);
});

test('an event with no detail still arrives as an envelope', () => {
  const events = new EventEmitter();
  const seen = [];
  events.on('exit', (event) => seen.push(event));
  events.emit('exit');
  assert.deepEqual(seen, [{ type: 'exit', detail: undefined }]);
});

// The event is handed to every listener in turn, so a mutable one would let the first
// rewrite what the rest read.
test('the event is frozen, and the same object reaches every listener', () => {
  const events = new EventEmitter();
  const seen = [];

  events.on('start', (event) => {
    assert.ok(Object.isFrozen(event));
    assert.throws(() => {
      'use strict';
      event.detail = { slot: 99 };
    }, TypeError);
    seen.push(event);
  });
  events.on('start', (event) => seen.push(event));
  events.emit('start', { slot: 1 });

  assert.equal(seen.length, 2);
  assert.equal(seen[0], seen[1], 'one object, not one per listener');
  assert.deepEqual(seen[0].detail, { slot: 1 }, 'unchanged by the first listener');
});

test('the same listener registered twice is registered once', () => {
  const events = new EventEmitter();
  let calls = 0;
  const listener = () => (calls += 1);
  events.on('exit', listener).on('exit', listener);
  events.emit('exit');
  assert.equal(calls, 1);
});

test('off takes the listener, and leaves the others alone', () => {
  const events = new EventEmitter();
  const seen = [];
  const first = () => seen.push('first');
  const second = () => seen.push('second');
  events.on('exit', first).on('exit', second).off('exit', first);
  events.emit('exit');
  assert.deepEqual(seen, ['second']);
});

test('off with a listener that was never registered is a no-op', () => {
  const events = new EventEmitter();
  let calls = 0;
  events.on('exit', () => (calls += 1));
  events.off('exit', () => {});
  events.off('never-used', () => {});
  events.emit('exit');
  assert.equal(calls, 1);
});

// The reason `emit` iterates a copy. Mutating a Set while `for…of` walks it is
// exactly how a listener that unsubscribes itself silences the next one.
test('a listener may unsubscribe during emit without disturbing the rest', () => {
  const events = new EventEmitter();
  const seen = [];
  const first = () => {
    seen.push('first');
    events.off('exit', first);
    events.off('exit', third);
  };
  const second = () => seen.push('second');
  const third = () => seen.push('third');
  events.on('exit', first).on('exit', second).on('exit', third);

  events.emit('exit');
  assert.deepEqual(seen, ['first', 'second', 'third'], 'this emit still sees every listener');

  events.emit('exit');
  assert.deepEqual(seen, ['first', 'second', 'third', 'second'], 'the next one sees the removals');
});

test('a listener added during emit does not run in that same emit', () => {
  const events = new EventEmitter();
  const seen = [];
  events.on('exit', () => {
    seen.push('first');
    events.on('exit', () => seen.push('late'));
  });
  events.emit('exit');
  assert.deepEqual(seen, ['first']);
  events.emit('exit');
  assert.deepEqual(seen, ['first', 'first', 'late']);
});

// One bad listener must neither silence the rest nor vanish. Both halves are
// asserted: the survivors run, and the throw reaches the host's global handler.
test('a throwing listener does not silence the others, and is rethrown globally', async () => {
  const events = new EventEmitter();
  const seen = [];
  const boom = new Error('listener blew up');

  const caught = [];
  const original = process.listeners('uncaughtException');
  for (const listener of original) process.off('uncaughtException', listener);
  process.on('uncaughtException', (error) => caught.push(error));

  try {
    events.on('exit', () => seen.push('before'));
    events.on('exit', () => {
      throw boom;
    });
    events.on('exit', () => seen.push('after'));
    events.emit('exit');

    assert.deepEqual(seen, ['before', 'after'], 'the listeners around it still ran');

    // Rethrown on a fresh task, so it surfaces with its stack instead of being
    // swallowed — one turn of the loop is enough for the microtask to land.
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.deepEqual(caught, [boom]);
  } finally {
    process.removeAllListeners('uncaughtException');
    for (const listener of original) process.on('uncaughtException', listener);
  }
});

test('the constructor registers a map of listeners, as EngineInit.on carries it', () => {
  const seen = [];
  const events = new EventEmitter({
    start: (event) => seen.push(['start', event.detail]),
    exit: (event) => seen.push([event.type]),
  });

  events.emit('start', { slot: 2 });
  events.emit('exit');
  assert.deepEqual(seen, [['start', { slot: 2 }], ['exit']]);
});

test('emitting an event nobody listens to is harmless', () => {
  const events = new EventEmitter();
  assert.doesNotThrow(() => events.emit('exit'));
  assert.doesNotThrow(() => events.emit('start', { slot: 0 }));
});
