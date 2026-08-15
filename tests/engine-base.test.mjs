// The normative rules `EngineSDKBase` / `EnginePlayBase` implement on behalf of every
// engine that extends them. Each one used to be a sentence in a spec that each engine
// re-derived; now there is one implementation, so there can be one test.

import test from 'node:test';
import assert from 'node:assert/strict';
import { EnginePlayBase, EngineSDKBase } from '../dist/engine-specs.js';

const spec = {
  config: {
    region: { default: 'us', enum: ['us', 'eu', 'jp'], description: 'Region', live: false },
    scanlines: { default: false, live: true },
  },
  options: {
    player: { default: 'sonic', live: true },
    slot: { default: 0, live: true },
  },
  // No `default`: unset is the honest answer for an asset nobody handed over.
  assets: { pack: { allowedTypes: ['.bin'], live: false } },
  storage: { namespace: { default: 'base-test', live: false } },
};

/** Records what the base asked of it, so the hooks can be asserted rather than assumed. */
class Play extends EnginePlayBase {
  opened = [];
  closed = 0;
  patches = [];
  mounts = [];
  failOpen = false;

  constructor(init, events) {
    super(spec, init, events);
  }
  open(options) {
    if (this.failOpen) throw new Error('cartridge is upside down');
    this.opened.push(options);
  }
  close() {
    this.closed += 1;
  }
  mounted(target) {
    this.mounts.push(target);
  }
  patched(kind, patch) {
    this.patches.push([kind, patch]);
  }
}

class SDK extends EngineSDKBase {
  play;
  createPlay(init, events) {
    return (this.play = new Play(init, events));
  }
}

// ---- Descriptors and state ----

test('state is seeded from the spec defaults, so `default` has one home', async () => {
  const config = await new SDK().config();

  assert.equal(config.region.value, 'us', 'the value came from the default');
  assert.equal(config.region.default, 'us');
  assert.deepEqual(config.region.enum, ['us', 'eu', 'jp']);
  assert.equal(config.region.description, 'Region');
  assert.equal(config.region.live, false);
});

test('a key with no default reads back unset rather than invented', async () => {
  const assets = await new SDK().assets();
  assert.equal(assets.pack.value, undefined);
  assert.deepEqual(assets.pack.allowedTypes, ['.bin']);
});

test('every declared key is present in the getter, and only those', async () => {
  const options = await new SDK().options();
  assert.deepEqual(Object.keys(options).sort(), ['player', 'slot']);
});

test('the getter never hands back the descriptor the setter would reject', async () => {
  const sdk = new SDK().config({ region: 'eu' });
  const config = await sdk.config();
  assert.equal(config.region.value, 'eu');
  // The value sits inside a descriptor; it is not the descriptor.
  assert.notDeepEqual(config.region, 'eu');
});

// ---- The cumulative payload ----

test('patches merge flat and cumulatively, one level', async () => {
  const sdk = new SDK().config({ region: 'eu' }).config({ scanlines: true });
  const config = await sdk.config();

  assert.equal(config.region.value, 'eu', 'the earlier patch survived the later one');
  assert.equal(config.scanlines.value, true);
});

test('the constructor and the chain are the same call', async () => {
  const viaInit = await new SDK({ config: { region: 'jp' } }).config();
  const viaChain = await new SDK().config({ region: 'jp' }).config();
  assert.deepEqual(viaInit, viaChain);
});

test('a write to a live engine reaches it, and the factory does not lie about it', async () => {
  const sdk = new SDK();
  const play = await sdk.start();

  sdk.config({ region: 'eu' });
  assert.deepEqual(await play.config().then((c) => c.region.value), 'eu');
  assert.deepEqual(await sdk.config().then((c) => c.region.value), 'eu');
  assert.deepEqual(sdk.play.patches, [['config', { region: 'eu' }]]);
});

// ---- Lifecycle ----

test('start opens a session with the options as they stand, merged over the defaults', async () => {
  const sdk = new SDK({ options: { player: 'tails' } });
  await sdk.start({ slot: 4 });
  assert.deepEqual(sdk.play.opened, [{ player: 'tails', slot: 4 }]);
});

test('a factory governs at most one engine: start twice reopens, never rebuilds', async () => {
  const sdk = new SDK();
  const first = await sdk.start({ slot: 1 });
  const second = await sdk.start({ slot: 2 });

  assert.equal(first, second, 'the same engine');
  assert.deepEqual(sdk.play.opened, [{ player: 'sonic', slot: 1 }, { player: 'sonic', slot: 2 }]);
});

test('mount records the element and tells the engine, and reparenting is legal', async () => {
  const first = { nodeName: 'DIV' };
  const second = { nodeName: 'SECTION' };
  const play = await new SDK().start();

  await play.mount(first);
  await play.mount(second);
  assert.deepEqual(play.mounts, [first, second]);
});

// The rule the contract states for the whole surface, here for the one member that
// cannot simply forward: a target given to the constructor is applied when the engine
// exists, not dropped, and not applied so early that the subclass is half-built.
test('mount in the constructor and mount by chaining are the same call', async () => {
  const stage = { nodeName: 'DIV' };

  const viaInit = await new SDK({ mount: stage }).start();
  const viaChain = await new SDK().mount(stage).start();

  assert.deepEqual(viaInit.mounts, [stage]);
  assert.deepEqual(viaChain.mounts, viaInit.mounts);
});

test('the engine is told where it is before the session opens, not after', async () => {
  const stage = { nodeName: 'DIV' };
  const order = [];

  class Ordered extends Play {
    mounted(target) {
      order.push(['mounted', target]);
    }
    open() {
      order.push(['open']);
    }
  }
  class OrderedSDK extends SDK {
    createPlay(init, events) {
      return new Ordered(init, events);
    }
  }

  await new OrderedSDK({ mount: stage }).start();
  assert.deepEqual(order, [['mounted', stage], ['open']]);
});

test('re-mounting the same element does not tell the engine twice', async () => {
  const stage = { nodeName: 'DIV' };
  const play = await new SDK({ mount: stage }).start();

  await play.mount(stage);
  await play.restart();
  assert.deepEqual(play.mounts, [stage], 'once, not three times');
});

// `protected` is a compile-time guard in TypeScript and nothing more — it is erased at
// runtime. Pinned here so it is never mistaken for a capability boundary: only the
// `#private` state and channel are actually unreachable.
test('protected members are still reachable from plain JavaScript', async () => {
  const stage = { nodeName: 'DIV' };
  const play = await new SDK({ mount: stage }).start();
  assert.equal(play.target, stage);
  assert.equal(typeof play.emit, 'function');
});

test('destroy closes once and emits exit', async () => {
  const seen = [];
  const sdk = new SDK({ on: { exit: (event) => seen.push(event.type) } });
  const play = await sdk.start();

  await play.destroy();
  assert.equal(play.closed, 1);
  assert.deepEqual(seen, ['exit']);
});

// ---- Errors reach a host both ways ----

test('a throwing hook rejects the chain AND emits error', async () => {
  const seen = [];
  const sdk = new SDK({ on: { error: (event) => seen.push(event.detail) } });
  const play = await sdk.start();
  play.failOpen = true;

  await assert.rejects(() => play.restart({ slot: 9 }), /cartridge is upside down/);
  assert.equal(seen.length, 1, 'the same failure also arrived as an event');
  assert.match(seen[0].message, /cartridge is upside down/);
});

test('start is not emitted when opening the session failed', async () => {
  const started = [];
  const sdk = new SDK({ on: { start: () => started.push(1), error: () => {} } });
  const play = await sdk.start();
  started.length = 0;

  play.failOpen = true;
  await play.restart().catch(() => {});
  assert.deepEqual(started, [], 'a session that did not open did not announce that it had');
});

test('a non-Error throw is still delivered as an Error', async () => {
  const seen = [];
  const sdk = new SDK({ on: { error: (event) => seen.push(event.detail) } });
  const play = await sdk.start();

  play.open = () => {
    throw 'a string, as careless code throws';
  };
  await play.restart().catch(() => {});

  assert.ok(seen[0] instanceof Error);
  assert.match(seen[0].message, /a string, as careless code throws/);
});
