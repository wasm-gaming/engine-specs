# @wasm-gaming/wasm-specs

The **engine contract** for the wasm-gaming ecosystem: the single shared interface
that every WASM game/emulator engine and the host app conform to. Define it once
here, depend on it everywhere, and engines can't drift.

TypeScript is the source of truth ([src/](src/)); a JSON Schema
([schema/engine-manifest.schema.json](schema/engine-manifest.schema.json)) mirrors
the manifest for non-TS consumers; a zero-dependency validator lets any CI fail on
drift.

## Two layers

**Layer A — declarative ([src/manifest.ts](src/manifest.ts))**
`EngineManifest` describes what an engine ships and needs: artifacts (`wasm`/`js`),
runtime `assets` (each with a VFS `mountPath` + optional `validate`), the `input`
preset, `video` geometry, engine-specific `options` (a JSON Schema), and
`capabilities`. Everything that differs between engines lives here as data.

**Layer B — imperative ([src/engine.ts](src/engine.ts))**
Every engine package default-exports an `EngineSDK` = `{ manifest, load }`.
`load(config)` boots the engine and returns an `EngineInstance`
(`start`/`pause`/`resume`/`reset`/`setInput`/`destroy`, plus capability-gated
`saveState`/`loadState`/`screenshot`). The host drives all engines identically.

## Usage

An engine implements the contract:

```ts
import type { EngineSDK, EngineManifest } from '@wasm-gaming/wasm-specs';

export const manifest: EngineManifest = { /* ... */ };
export async function load(config) { /* ... */ }

// Compile-time conformance:
const _sdk: EngineSDK = { manifest, load };
```

CI (or the host) validates a manifest at runtime:

```ts
import { validateManifest, assertManifest } from '@wasm-gaming/wasm-specs';

const { valid, errors } = validateManifest(json);
// or: assertManifest(json)  // throws with a readable error list
```

## Build

```bash
npm install
npm run build      # tsc → dist/ (.js + .d.ts)
npm run typecheck  # no emit
```

## Consuming

Depend on it by version (published npm) or by git ref. Engines list it as a
(dev/peer) dependency and import only `type`s at compile time — the SDK itself
carries no runtime dependency on this package.

## Versioning

`CONTRACT_VERSION` tracks the shape of the interfaces. Breaking changes bump the
major; engines declare which contract version they target via their own SemVer.

## License

MIT.
