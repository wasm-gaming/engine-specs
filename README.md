# @wasm-gaming/engine-specs

The **engine contract** for the wasm-gaming ecosystem: one shared JS API that every
WASM game/emulator engine implements and every host drives. Define it once here,
depend on it everywhere, and engines can't drift.

TypeScript types and nothing else — [src/engine-specs.ts](src/engine-specs.ts) is the
whole package. No runtime dependencies, because twelve engines depend on this.

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
page](https://wasm-gaming.github.io/engine-specs/demo/). The negative cases live in
[tests/types.test-d.ts](tests/types.test-d.ts), guarded by `@ts-expect-error` — which
fails if a rejection ever stops happening.

## License

MIT.
