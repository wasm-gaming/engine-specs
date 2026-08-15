# @wasm-gaming/engine-specs

The **engine contract** for the wasm-gaming ecosystem: one shared JS API that every
WASM game/emulator engine implements and every host drives. Define it once here,
depend on it everywhere, and engines can't drift.

The types, plus the contract implemented once so twelve engines inherit it instead of
re-deriving it — [src/engine-specs.ts](src/engine-specs.ts) is the whole package. No
runtime dependencies, because twelve engines depend on this.

## The shape

An engine exports a class. Its **identity is static**, so a launcher can list engines
without constructing one:

```ts
import type { EngineSDKConstructor, EnginePayloads } from '@wasm-gaming/engine-specs';

interface Rsdkv4Payloads extends EnginePayloads {
  config: { region: 'us' | 'eu' | 'jp' };
  options: { player: 'sonic' | 'tails'; slot: number };
  assets: { pack: Uint8Array };
  storage: { namespace: string };
}

// The one line that belongs in an engine's CI: does the class satisfy the contract?
const _contract: EngineSDKConstructor<Rsdkv4Payloads> = Rsdkv4SDK;
```

A host configures by chaining, and gets the live engine back:

```js
const play = await new Rsdkv4SDK({ config: { region: 'eu' } })
  .assets({ pack })
  .mount(document.querySelector('#stage'))
  .start({ player: 'tails', slot: 0 });

await play.restart({ slot: 3 });
await play.destroy();
```

## Read and write are different shapes

`config`, `options`, `assets` and `storage` are each one method with two overloads.
Called with a patch it writes and keeps the chain; called with nothing it reads:

```js
sdk.config({ region: 'eu' })        // writes, chains
await sdk.config()                  // reads
// → { region: { value: 'eu', default: 'us', enum: [...], description: '…', live: false } }
```

The getter returns a **descriptor per key** — enough to paint a settings screen
without asking the engine anything, and without the host knowing a single key name.
`live` says whether a property can be changed on a running engine or needs a
`restart()`. The descriptor shape is never accepted on write: that asymmetry is what
keeps a write unambiguous the day a value is itself an object.

## Listening

`on` and `off` are on the same fluent surface, so they chain wherever the setters do —
and **registration is synchronous on every carrier**, including the promise `start()`
returns. The chain is what the return value continues, never what the subscription
waits for; otherwise `start().on('error', …)` would bind after the session opened and
miss an error thrown while it was opening.

A listener receives an **event**, not the payload: what it carries is `detail`, as
`CustomEvent` does it. The envelope is what lets an event grow a field without every
listener signature changing — and what survives `postMessage` intact when the engine
lives in a worker, which is where this ecosystem is going.

```js
const play = await new Rsdkv4SDK({ on: { error: report } })   // in the constructor
  .on('start', (event) => console.log('session', event.detail))
  .assets({ pack })
  .start();
```

It is deliberately **not** a DOM event: two members, frozen, no bubbling, no
`preventDefault()`, no `target`. Half-implementing a familiar interface is worse than
offering a different one.

The factory and the engine it opens are **one channel**, so subscribing before there is
an engine is the normal way to do it. Every engine emits `start`, `error`, `exit`,
`pause` and `resume`; an engine that has more of its own declares them in its payload
bundle and they type-check alongside the core set:

```ts
interface Rsdkv4Payloads extends EnginePayloads {
  // …the four payloads
  events: { levelLoaded: { zone: string } };   // optional; omit it for the core set alone
}
```

`error` is emitted **and** the promise rejects — both, always — so a host that does not
`await` is not left blind, and one that does is not forced to subscribe.

## Writing an engine

None of the above has to be implemented by hand. `EnginePlayBase` and `EngineSDKBase`
carry the state, the descriptors, the cumulative merge, the chainable promise and the
channel; an engine declares its properties as data and fills in what only it knows.

```js
import { EnginePlayBase, EngineSDKBase } from '@wasm-gaming/engine-specs';

const spec = {
  config: { region: { default: 'us', enum: ['us', 'eu', 'jp'], live: false } },
  options: { slot: { default: 0, live: true } },
  assets: { pack: { allowedTypes: ['.bin'], live: false } },
  storage: { namespace: { default: 'rsdkv4', live: false } },
};

class Rsdkv4Play extends EnginePlayBase {
  constructor(init, events) { super(spec, init, events); }
  async open(options) { /* start or reopen a session */ }
  async close() { /* stop and release */ }
  mounted(target) { /* the picture goes here */ }
}

export class Rsdkv4SDK extends EngineSDKBase {
  static id = 'rsdkv4';
  static version = '1.0.0';
  createPlay(init, events) { return new Rsdkv4Play(init, events); }
}
```

`default` is declared in the spec and **nowhere else** — the base seeds its starting
state from it, so the initial value and the advertised default cannot drift apart.
`start`, `exit` and `error` are emitted for you, including the rule that a failing hook
both rejects the chain and emits `error`; `this.emit(…)` is for the engine's own
events.

Adoption is optional: the contract is structural, so an engine with its own emitter and
its own state satisfies `EngineSDK` without extending anything. `EventEmitter` and
`hydratePlay` are exported for engines that want the pieces rather than the whole.

## Closing the types

One type parameter carries all four payloads, so there is no order to get wrong:

```ts
type Sdk = EngineSDK<Rsdkv4Payloads>;
```

Leave it off and the payloads stay open (`Record<string, unknown>`), which compiles
but gives up the checking that is the point.

## Build

```bash
npm install
make build            # tsc → dist/ (cleans first)
make typecheck        # the contract
make typecheck-tests  # the compile-time conformance suite
make typecheck-demo   # the demo engine, held to the same contract
make test             # all of the above + the package integrity tests
make docs             # typedoc → site/
make site             # reference at /, demo at /demo/
make preview          # serve site/ on :8020 (PORT= to change it)
```

## Conformance

Two engines implement the contract in this repo, and both are type-checked in CI:
[tests/engine.conformance.ts](tests/engine.conformance.ts), the reference engine, and
[demo/demo.sdk.js](demo/demo.sdk.js), which drives the [demo
page](https://wasm-gaming.github.io/engine-specs/demo/). Between them they cover both
branches of the event map — the reference engine declares one of its own, the demo
omits `events` and gets the core set alone. The negative cases live in
[tests/types.test-d.ts](tests/types.test-d.ts), guarded by `@ts-expect-error` — which
fails if a rejection ever stops happening.

The emitter is the one part with behaviour to run rather than compile, so it has
tests that run: [tests/event-emitter.test.mjs](tests/event-emitter.test.mjs).

## License

MIT.
