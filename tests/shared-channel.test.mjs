// The rule types cannot check: `on` registers synchronously on a channel the factory
// owns, so a listener is live before the engine it listens to exists.
//
// This used to drive a hand-copied replica of the pattern. It now drives the shipped
// base classes, so what is asserted is the code twelve engines will actually inherit.

import test from 'node:test';
import assert from 'node:assert/strict';
import { EnginePlayBase, EngineSDKBase } from '../dist/engine-specs.js';

const spec = {
  config: { region: { default: 'us' } },
  options: { slot: { default: 0 } },
  assets: { pack: {} },
  storage: { namespace: { default: 'test' } },
};

class Play extends EnginePlayBase {
  constructor(init, events) {
    super(spec, init, events);
  }
  open() {}
  close() {}
}

class SDK extends EngineSDKBase {
  createPlay(init, events) {
    return new Play(init, events);
  }
  /** Only for the counterfactual below — `events` is `protected` for a reason. */
  get channel() {
    return this.events;
  }
}

test('a listener given to the constructor hears the engine the factory opens later', async () => {
  const seen = [];
  const sdk = new SDK({ on: { start: (event) => seen.push(event.detail) } });

  // Nothing was constructed when the listener was registered; the play that emits is
  // built inside `start()`. One channel is what carries it across.
  await sdk.start({ slot: 3 });
  assert.deepEqual(seen, [{ slot: 3 }]);
});

test('subscribing on the returned promise catches the event that opening it emits', async () => {
  const sdk = new SDK();
  const seen = [];

  // `start()` has already been called, and its `start` event fires in a microtask.
  // Registration happens now, so the listener is there in time.
  await sdk.start({ slot: 1 }).on('start', (event) => seen.push(event.detail));
  assert.deepEqual(seen, [{ slot: 1 }], 'synchronous registration caught it');
});

test('the same subscription routed through the chain misses it — which is why it is not', async () => {
  const sdk = new SDK();
  const missed = [];

  // What `on` would do if it were chained like `mount`: registered once the promise
  // settles, which is after the session opened.
  const promise = sdk.start({ slot: 1 });
  await promise.then(() => sdk.channel.on('start', (event) => missed.push(event.detail)));

  assert.deepEqual(missed, [], 'a chained registration binds after the session opened');
});

test('handlers survive across sessions: restart emits start again', async () => {
  const seen = [];
  const sdk = new SDK({ on: { start: (event) => seen.push(event.detail) } });

  const play = await sdk.start({ slot: 0 });
  await play.restart({ slot: 1 });
  await play.restart({ slot: 2 });
  assert.deepEqual(seen, [{ slot: 0 }, { slot: 1 }, { slot: 2 }]);
});

test('off on the factory stops an engine that is already running', async () => {
  const seen = [];
  const listener = (event) => seen.push(event.detail);
  const sdk = new SDK().on('start', listener);

  const play = await sdk.start({ slot: 0 });
  sdk.off('start', listener);
  await play.restart({ slot: 1 });

  assert.deepEqual(seen, [{ slot: 0 }], 'unsubscribing on the factory reaches the live engine');
});

test('exit reaches a listener that subscribed before the engine existed', async () => {
  let exited = 0;
  const sdk = new SDK({ on: { exit: () => (exited += 1) } });

  const play = await sdk.start();
  await play.destroy();
  assert.equal(exited, 1);
});
